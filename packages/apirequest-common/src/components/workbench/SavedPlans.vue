<template>
  <section class="workbench-panel mb-6 p-5">
    <div
      v-if="!hideHeading || managePlans"
      class="mb-3 flex flex-wrap items-center gap-3"
      :class="{ 'justify-end': hideHeading }"
    >
      <h2 v-if="!hideHeading" class="mr-auto font-semibold text-secondaryDark">
        {{ t("workbench_mcp.saved_plans") }} ·
        {{ t(`workbench_mcp.entities.${kind}`) }}
      </h2>
      <HoppButtonSecondary
        v-if="managePlans"
        :label="t('workbench_schedule.new')"
        :disabled="
          loading ||
          !entries.some(
            ({ collection }) =>
              collection.id ||
              (!automationScheduling && collection._ref_id) ||
              collection.requests.some(({ id }) => id)
          )
        "
        @click="scheduleEditor = {}"
      />
    </div>
    <WorkbenchState
      v-if="loading && !plans.length"
      kind="loading"
      :title="t('state.loading')"
    />
    <WorkbenchState
      v-else-if="error && !plans.length"
      kind="error"
      :title="t('workbench.load_failed')"
      :description="t('workbench.load_failed_description')"
      :detail="error"
    >
      <HoppButtonSecondary
        :label="t('action.retry')"
        outline
        @click="refresh"
      />
    </WorkbenchState>
    <WorkbenchState
      v-else-if="!plans.length"
      :title="t('workbench_mcp.no_plans')"
      :icon="IconWorkflow"
    />
    <p v-else-if="error" role="alert" class="mb-3 text-red-500">
      {{ t("workbench.refresh_failed") }}
    </p>
    <div
      v-for="plan in plans"
      :key="plan.id"
      class="flex flex-col items-stretch gap-3 border-t border-dividerLight py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div class="min-w-0 flex-1">
        <h3 class="truncate font-medium text-secondaryDark">{{ plan.name }}</h3>
        <p
          v-if="schedules[plan.id]?.nextRunAt"
          class="mt-1 text-tiny text-secondaryLight"
        >
          {{
            t("workbench_schedule.next_run", {
              time: new Date(schedules[plan.id].nextRunAt!).toLocaleString(),
            })
          }}
          · {{ scheduleEnvironment(schedules[plan.id].environmentID) }}
        </p>
        <p v-else class="mt-1 break-words text-xs text-secondaryLight">
          {{
            kind === "automation" && plan.config?.requestCases
              ? t("automation_cases.summary", {
                  count: Object.values(plan.config.requestCases)
                    .flat()
                    .filter(
                      (entry) =>
                        !plan.config?.selectedCaseIDs ||
                        plan.config.selectedCaseIDs.includes(entry.id)
                    ).length,
                  iterations: plan.config.iterations ?? 1,
                })
              : kind === "automation"
                ? t("ui_detail.plan_summary", {
                    iterations: plan.config?.iterations ?? 1,
                    delay: plan.config?.delay ?? 0,
                  })
                : (plan.url ?? plan.name)
          }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <HoppButtonSecondary
          :label="
            kind === 'automation'
              ? t('workbench_schedule.settings')
              : kind === 'load_test'
                ? t('workbench.open_load_test')
                : t('workbench.open_websocket')
          "
          :disabled="loading"
          outline
          @click="load(plan)"
        />
        <HoppButtonPrimary
          v-if="kind === 'automation'"
          :label="t('test.run')"
          :disabled="loading"
          :loading="loading && runImmediately"
          @click="load(plan, true)"
        />
        <HoppButtonSecondary
          v-if="scheduling"
          :label="t('action.delete')"
          :disabled="loading"
          @click="deleteTarget = plan"
        />
      </div>
    </div>
    <HoppSmartConfirmModal
      :show="!!deleteTarget"
      :title="
        t('workbench_schedule.delete_confirm', { name: deleteTarget?.name })
      "
      @hide-modal="deleteTarget = undefined"
      @resolve="deletePlan"
    />
    <AutomationScheduleEditor
      v-if="scheduleEditor"
      :plan="scheduleEditor.plan"
      :schedule="
        scheduleEditor.plan ? schedules[scheduleEditor.plan.id] : undefined
      "
      @close="scheduleEditor = undefined"
      @saved="scheduleSaved"
    />
    <HttpTestRunnerModal
      v-if="runner && selected"
      :collection-runner-data="runner"
      :run-name="selected?.name"
      :prev-config="selected.config"
      :initial-selection="runnerSelection"
      :auto-run="runImmediately"
      @hide-modal="closeRunner"
    />
    <HoppSmartModal
      v-if="request && selected"
      dialog
      :title="selected.name"
      styles="sm:max-w-4xl"
      @close="request = undefined"
    >
      <template #body
        ><WorkbenchLoadTestPanel
          :request="request"
          :inherited="inherited"
          :initial-config="selected.config"
      /></template>
    </HoppSmartModal>
  </section>
</template>
<script setup lang="ts">
import { useWorkbenchLiveQuery } from "~/composables/workbenchLive"
import WorkbenchState from "~/components/workbench/State.vue"
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue"
import { useService } from "dioc/vue"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import IconWorkflow from "~icons/lucide/workflow"
import { useRouter } from "vue-router"
import { getAutomationConfig, type HoppRESTRequest } from "@apirequest/data"
import { useI18n } from "~/composables/i18n"
import { useWorkbenchCollections } from "~/composables/workbenchCollections"
import {
  listWorkbenchConfigs, workbenchMcpAPI,
  workbenchSchedulesAvailable,
  type AutomationSchedule,
  type SavedWorkbenchPlan,
} from "~/helpers/workbench-mcp"
import { getRequestSelectionID } from "~/helpers/runner/selection"
import { cascadeParentCollectionForProperties } from "~/newstore/collections"
import {
  environmentsStore,
  setSelectedEnvironmentIndex,
} from "~/newstore/environments"
import type { HoppInheritedProperty } from "~/helpers/types/HoppInheritedProperties"
import AutomationScheduleEditor from "./AutomationSchedule.vue"
import WorkbenchLoadTestPanel from "./LoadTestPanel.vue"
import HttpTestRunnerModal from "~/components/http/test/RunnerModal.vue"
const props = defineProps<{
  kind: "automation" | "load_test" | "websocket"
  revision?: string
  allowScheduling?: boolean
  hideHeading?: boolean
}>()
const t = useI18n(),
  router = useRouter()
const { entries } = useWorkbenchCollections()
const tabs = useService(WorkspaceTabsService)
const closeRunner = async () => {
  runner.value = undefined
  runnerSelection.value = undefined
  // 运行器负责跳转到自动化结果页。
}
const plans = ref<SavedWorkbenchPlan[]>([]),
  selected = ref<SavedWorkbenchPlan>()
const automationScheduling =
  props.kind === "automation" && workbenchSchedulesAvailable()
const scheduling = automationScheduling && props.allowScheduling
const managePlans = props.kind === "automation" && props.allowScheduling
const schedules = ref<Record<string, AutomationSchedule>>({})
const scheduleEditor = ref<{ plan?: SavedWorkbenchPlan }>()
const deleteTarget = ref<SavedWorkbenchPlan>()
const runnerSelection = ref<string[]>()
const runImmediately = ref(false)
const loading = ref(false),
  error = ref("")
const request = shallowRef<HoppRESTRequest>(),
  inherited = shallowRef<HoppInheritedProperty>()
const runner = ref<{
  type: "my-collections"
  collectionID: string
  collectionIndex: string
}>()
const controller = new AbortController()
let alive = true
const scheduleEnvironment = (id: string | null) =>
  id
    ? (environmentsStore.value.environments.find((env) => env.id === id)
        ?.name ?? t("workbench_mcp.environment_missing"))
    : t("environment.no_environment")

const refreshSchedules = async () => {
  const rows = await workbenchMcpAPI<AutomationSchedule[]>(
    "automation/schedules",
    undefined,
    controller.signal
  )
  if (alive)
    schedules.value = Object.fromEntries(rows.map((row) => [row.planID, row]))
}

const refresh = async () => {
  loading.value = true
  try {
    const result = await listWorkbenchConfigs<SavedWorkbenchPlan>(
      props.kind, controller.signal
    )
    if (alive) {
      plans.value = result
      error.value = ""
    }
    if (automationScheduling) await refreshSchedules()
  } catch (e) {
    if (alive) error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
const deletePlan = async () => {
  const plan = deleteTarget.value
  if (!plan || loading.value) return
  deleteTarget.value = undefined
  loading.value = true
  try {
    await workbenchMcpAPI(
      `automation/plans/${encodeURIComponent(plan.id)}/delete`,
      {},
      controller.signal
    )
    await refresh()
  } catch (e) {
    if (alive) error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
const load = async (plan: SavedWorkbenchPlan, immediately = false) => {
  if (loading.value) return
  runImmediately.value = immediately
  loading.value = true
  error.value = ""
  try {
    // 按稳定的服务器 ID 重新读取配置，避免加载列表查询后已被删除或修改的旧计划。
    const current = await workbenchMcpAPI<SavedWorkbenchPlan>(
      `configs/${props.kind}/${encodeURIComponent(plan.id)}`,
      undefined,
      controller.signal
    )
    if (!alive) return
    if (props.kind === "automation" && !immediately) {
      if (automationScheduling) await refreshSchedules()
      if (alive) scheduleEditor.value = { plan: current }
      return
    }
    if (current.environmentID) {
      const index = environmentsStore.value.environments.findIndex(
        (env) => env.id === current.environmentID
      )
      if (index < 0) throw new Error(t("workbench_mcp.environment_missing"))
      setSelectedEnvironmentIndex({ type: "MY_ENV", index })
    } else if (props.kind === "automation") {
      setSelectedEnvironmentIndex({ type: "NO_ENV_SELECTED" })
    }
    selected.value =
      props.kind === "automation"
        ? {
            ...current,
            config: getAutomationConfig(
              current.config,
              automationScheduling
                ? {}
                : { delay: 500, keepVariableValues: true }
            ),
          }
        : current
    if (props.kind === "automation") {
      const entry = entries.value.find(({ collection }) =>
        current.config?.selectedRequestIDs
          ? collection.requests.some(({ id, _ref_id }) =>
              current.config!.selectedRequestIDs!.includes(id ?? _ref_id ?? "")
            )
          : current.requestID
            ? collection.requests.some(
                ({ id, _ref_id }) => (id ?? _ref_id) === current.requestID
              )
            : (collection.id ?? collection._ref_id) === current.collectionID
      )
      if (current.requestID && !current.config?.selectedRequestIDs) {
        const index =
          entry?.collection.requests.findIndex(
            ({ id, _ref_id }) => (id ?? _ref_id) === current.requestID
          ) ?? -1
        if (!entry || index < 0)
          throw new Error(t("workbench_schedule.request_missing"))
        runnerSelection.value = [
          getRequestSelectionID(entry.collection.requests[index], [index]),
        ]
      } else {
        runnerSelection.value = undefined
      }
      if (!entry?.collection._ref_id)
        throw new Error(t("workbench_mcp.collection_missing"))
      runner.value = {
        type: "my-collections",
        collectionID: entry.collection._ref_id,
        collectionIndex: entry.path,
      }
    } else if (props.kind === "load_test") {
      const saved = await workbenchMcpAPI<{
        request: HoppRESTRequest
        collectionID: string
      }>(
        `configs/request/${encodeURIComponent(current.requestID!)}`,
        undefined,
        controller.signal
      )
      if (!alive) return
      const entry = entries.value.find(
        (entry) =>
          (entry.collection.id ?? entry.collection._ref_id) ===
          saved.collectionID
      )
      inherited.value = entry
        ? cascadeParentCollectionForProperties(entry.path, "rest", true)
        : undefined
      request.value = saved.request
    } else {
      await tabs.openWebSocketTab(
        {
          endpoint: current.url!,
          protocols: (current.protocols ?? []).map((value) => ({
            value,
            active: true,
          })),
        },
        current.name
      )
      await router.push("/")
    }
  } catch (e) {
    if (alive) error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
watch(() => props.revision, refresh)
const scheduleSaved = () => {
  scheduleEditor.value = undefined
  void refresh()
}
useWorkbenchLiveQuery(["plans", "automation"], refresh, {
  blocked: computed(() => !!runner.value || !!scheduleEditor.value),
})
onBeforeUnmount(() => {
  alive = false
  controller.abort()
})
</script>
