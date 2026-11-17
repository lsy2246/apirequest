<template>
  <FormFrame
    :embedded="embedded"
    :title="
      plan
        ? `${t('workbench_schedule.settings')} · ${plan.name}`
        : t('workbench_schedule.new')
    "
    @close="!saving && emit('close')"
  >
    <template #body>
      <form
        id="workbench-automation-schedule"
        ref="form"
        class="space-y-4"
        :inert="saving"
        :aria-busy="saving"
        @submit.prevent="save()"
      >
        <fieldset class="min-w-0 space-y-1">
          <legend>{{ t("workbench_schedule.target") }}</legend>
          <ul
            v-if="visibleRows.length"
            class="max-h-56 overflow-y-auto rounded border border-divider py-1"
          >
            <li
              v-for="row in visibleRows"
              :key="row.key"
              class="flex items-center gap-1 pr-1"
              :style="{
                paddingInlineStart: `${Math.min(row.parents.length, 8) * 0.75}rem`,
              }"
            >
              <button
                v-if="row.expandable"
                type="button"
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-secondaryLight hover:bg-primaryLight"
                :aria-label="row.name"
                :aria-expanded="expanded.has(row.key)"
                @click="toggleGroup(row.key)"
              >
                <IconChevronRight
                  class="svg-icons transition-transform"
                  :class="{ 'rotate-90': expanded.has(row.key) }"
                  aria-hidden="true"
                />
              </button>
              <span v-else class="w-7 shrink-0" aria-hidden="true" />

              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-primaryLight disabled:opacity-50"
                :class="{ 'bg-accent/10 text-accent': selectedKey === row.key }"
                :aria-pressed="selectedKey === row.key"
                :disabled="!row.id || !row.collectionID"
                :title="row.path"
                @click="selectedKey = row.key"
              >
                <component
                  :is="expanded.has(row.key) ? IconFolderOpen : IconFolder"
                  v-if="row.kind === 'group'"
                  class="svg-icons shrink-0"
                  aria-hidden="true"
                />
                <span
                  v-else-if="row.method"
                  class="shrink-0 font-mono text-tiny font-semibold"
                  :style="{ color: getMethodLabelColor(row.method) }"
                >
                  {{ row.method }}
                </span>
                <IconGraphql
                  v-else
                  class="svg-icons shrink-0 text-accent"
                  aria-hidden="true"
                />
                <span class="min-w-0 flex-1 truncate">{{ row.name }}</span>
                <IconCheck
                  v-if="selectedKey === row.key"
                  class="svg-icons shrink-0"
                  aria-hidden="true"
                />
              </button>
            </li>
          </ul>
          <p
            v-else
            class="rounded border border-divider p-2 text-xs text-secondaryLight"
          >
            {{ t("documentation.no_requests_or_folders") }}
          </p>
          <p
            v-if="selectedTarget"
            aria-live="polite"
            class="pt-1 text-xs text-secondaryLight [overflow-wrap:anywhere]"
          >
            {{ selectedTarget.path }}
          </p>
        </fieldset>
        <p v-if="plan && !selectedTarget" role="alert" class="text-red-500">
          {{ t("workbench_schedule.target_missing") }}
        </p>
        <label class="block space-y-1">
          <span>{{ t("workbench_schedule.environment") }}</span>
          <WorkbenchSelect
            v-model="environmentID"
            :label="t('workbench_schedule.environment')"
            :options="environmentOptions"
          />
        </label>
        <p
          v-if="schedulingAvailable && type !== 'off' && environmentID"
          class="text-xs text-secondaryLight"
        >
          {{ t("workbench_schedule.values_notice") }}
        </p>
        <fieldset class="space-y-3 border-t border-divider pt-4">
          <legend class="font-semibold">
            {{ t("collection_runner.run_config") }}
          </legend>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="block space-y-1">
              <span>{{ t("collection_runner.iterations") }}</span>
              <input
                v-model.number="config.iterations"
                name="iterations"
                type="number"
                class="input w-full"
                min="1"
                max="1000"
                step="1"
                required
              />
            </label>
            <label class="block space-y-1">
              <span>{{ t("collection_runner.delay") }} · ms</span>
              <input
                v-model.number="config.delay"
                name="delay"
                type="number"
                class="input w-full"
                min="0"
                max="60000"
                step="1"
                required
              />
            </label>
          </div>
          <div class="flex flex-col items-start gap-3">
            <WorkbenchToggle v-model="config.stopOnError">{{
              t("collection_runner.stop_on_error")
            }}</WorkbenchToggle>
            <WorkbenchToggle v-model="config.persistResponses">{{
              t("collection_runner.persist_responses")
            }}</WorkbenchToggle>
            <WorkbenchToggle v-model="config.executeScripts">{{
              t("collection_runner.execute_scripts")
            }}</WorkbenchToggle>
            <WorkbenchToggle v-model="config.keepVariableValues">{{
              t("workbench_schedule.keep_variable_values")
            }}</WorkbenchToggle>
          </div>
          <p class="text-xs text-secondaryLight">
            {{ t("workbench_schedule.keep_variable_values_notice") }}
          </p>
        </fieldset>
        <h4
          v-if="schedulingAvailable"
          class="border-t border-divider pt-4 font-semibold"
        >
          {{ t("workbench_schedule.title") }}
        </h4>
        <label v-if="schedulingAvailable" class="block space-y-1">
          <span>{{ t("workbench_schedule.rule") }}</span>
          <WorkbenchSelect
            v-model="type"
            :label="t('workbench_schedule.rule')"
            :options="ruleOptions"
          />
        </label>
        <label
          v-if="schedulingAvailable && type === 'interval'"
          class="block space-y-1"
        >
          <span>{{ t("workbench_schedule.minutes") }}</span>
          <input
            v-model.number="minutes"
            type="number"
            class="input w-full"
            min="1"
            max="10080"
            required
          />
        </label>
        <div
          v-else-if="schedulingAvailable && type !== 'off'"
          class="space-y-3"
        >
          <label v-if="type === 'weekly'" class="block space-y-1">
            <span>{{ t("workbench_schedule.weekday") }}</span>
            <WorkbenchSelect
              :model-value="String(weekday)"
              :label="t('workbench_schedule.weekday')"
              :options="
                weekdays.map((day) => ({
                  value: String(day.value),
                  label: day.label,
                }))
              "
              @update:model-value="weekday = Number($event)"
            />
          </label>
          <label class="block space-y-1">
            <span>{{ t("workbench_schedule.time") }} · {{ timezone }}</span>
            <input v-model="time" type="time" class="input w-full" required />
          </label>
        </div>
        <p v-if="error" role="alert" class="text-red-500">{{ error }}</p>
      </form>
    </template>
    <template #footer>
      <HoppButtonPrimary
        :label="plan ? t('action.save') : t('action.create')"
        type="submit"
        form="workbench-automation-schedule"
        :loading="saving"
        :disabled="saving || !selectedTarget"
      />
      <HoppButtonSecondary
        :label="t('action.cancel')"
        :disabled="saving"
        @click="emit('close')"
      />
    </template>
  </FormFrame>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"
import FormFrame from "./FormFrame.vue"
import WorkbenchSelect from "./Select.vue"
import WorkbenchToggle from "./Toggle.vue"
import {
  AutomationConfigSchema,
  getAutomationConfig,
  isGQLRequest,
  type HoppCollection,
} from "@apirequest/data"
import IconCheck from "~icons/lucide/check"
import IconChevronRight from "~icons/lucide/chevron-right"
import IconFolder from "~icons/lucide/folder"
import IconFolderOpen from "~icons/lucide/folder-open"
import IconGraphql from "~icons/hopp/graphql"
import { useService } from "dioc/vue"
import { useI18n } from "~/composables/i18n"
import { useReadonlyStream } from "~/composables/stream"
import { useWorkbenchCollections } from "~/composables/workbenchCollections"
import {
  workbenchMcpAPI,
  workbenchSchedulesAvailable,
  type AutomationSchedule,
  type AutomationScheduleRule,
  type SavedWorkbenchPlan,
} from "~/helpers/workbench-mcp"
import { environments$ } from "~/newstore/environments"
import { isRootRequestCollection } from "~/newstore/collections"
import { getMethodLabelColor } from "~/helpers/rest/labelColoring"
import { CurrentValueService } from "~/services/current-environment-value.service"
import { SecretEnvironmentService } from "~/services/secret-environment.service"

const props = defineProps<{
  plan?: SavedWorkbenchPlan
  schedule?: AutomationSchedule
  embedded?: boolean
}>()
const emit = defineEmits<{ (e: "close"): void; (e: "saved"): void }>()
const t = useI18n()
const schedulingAvailable = workbenchSchedulesAvailable()
type TargetRow = {
  key: string
  kind: "group" | "request"
  id?: string
  collectionID?: string
  name: string
  path: string
  parents: string[]
  expandable?: boolean
  method?: string
}

const { collections } = useWorkbenchCollections()
const expanded = ref(new Set<string>())
const selectedKey = ref(
  props.plan?.requestID
    ? `request:${props.plan.requestID}`
    : props.plan?.collectionID
      ? `group:${props.plan.collectionID}`
      : ""
)
const rows = computed(() => {
  const result: TargetRow[] = []
  const append = (
    collection: HoppCollection,
    position: string,
    parents: string[],
    parentPath: string
  ) => {
    const rootRequests =
      parents.length === 0 && isRootRequestCollection(collection)
    const collectionID =
      collection.id ?? (!schedulingAvailable ? collection._ref_id : undefined)
    const key = `group:${collectionID ?? position}`
    const path = parentPath
      ? `${parentPath} / ${collection.name}`
      : collection.name
    if (!rootRequests) {
      result.push({
        key,
        kind: "group",
        id: collectionID,
        collectionID,
        name: collection.name,
        path,
        parents,
        expandable:
          collection.folders.length > 0 ||
          collection.requests.some(
            (request) => request.id || (!schedulingAvailable && request._ref_id)
          ),
      })
    }

    const childParents = rootRequests ? parents : [...parents, key]
    const childPath = rootRequests ? parentPath : path
    collection.folders.forEach((folder, index) =>
      append(folder, `${position}/${index}`, childParents, childPath)
    )
    for (const request of collection.requests) {
      const requestID =
        request.id ?? (!schedulingAvailable ? request._ref_id : undefined)
      if (!requestID) continue
      result.push({
        key: `request:${requestID}`,
        kind: "request",
        id: requestID,
        collectionID,
        name: request.name,
        path: childPath ? `${childPath} / ${request.name}` : request.name,
        parents: childParents,
        method: isGQLRequest(request) ? undefined : request.method,
      })
    }
  }

  // 接口管理把根目录请求放在分组之后，保持相同的显示层级。
  const roots = collections.value
  for (const [index, collection] of roots.entries()) {
    if (!isRootRequestCollection(collection))
      append(collection, String(index), [], "")
  }
  for (const [index, collection] of roots.entries()) {
    if (isRootRequestCollection(collection))
      append(collection, String(index), [], "")
  }
  return result
})
const visibleRows = computed(() =>
  rows.value.filter((row) =>
    row.parents.every((key) => expanded.value.has(key))
  )
)
const selectedTarget = computed(() =>
  rows.value.find(
    (row) => row.key === selectedKey.value && row.id && row.collectionID
  )
)
watch(
  selectedTarget,
  (target) => {
    if (target) expanded.value = new Set([...expanded.value, ...target.parents])
  },
  { immediate: true }
)

const toggleGroup = (key: string) => {
  if (!expanded.value.delete(key)) expanded.value.add(key)
}

const environments = useReadonlyStream(environments$, [])
const currentValues = useService(CurrentValueService)
const secretValues = useService(SecretEnvironmentService)
const rule = props.schedule?.rule ?? props.schedule?.draftRule
const type = ref<"off" | AutomationScheduleRule["type"]>(
  props.schedule?.rule?.type ?? "off"
)
const draftType = ref<AutomationScheduleRule["type"]>(rule?.type ?? "interval")
watch(
  type,
  (value) => {
    if (value !== "off") draftType.value = value
  },
  { flush: "sync" }
)
const config = ref(
  getAutomationConfig(
    props.plan?.config,
    props.plan && !schedulingAvailable
      ? { delay: 500, keepVariableValues: true }
      : {}
  )
)
const minutes = ref(rule?.type === "interval" ? rule.minutes : 30)
const time = ref(rule && rule.type !== "interval" ? rule.time : "09:00")
const weekday = ref(rule?.type === "weekly" ? rule.weekday : 1)
const timezone =
  rule && rule.type !== "interval"
    ? rule.timezone
    : Intl.DateTimeFormat().resolvedOptions().timeZone
const draftRule = computed<AutomationScheduleRule | null>(() => {
  if (draftType.value === "interval") {
    return Number.isSafeInteger(minutes.value) &&
      minutes.value >= 1 &&
      minutes.value <= 10080
      ? { type: "interval", minutes: minutes.value }
      : (rule ?? null)
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time.value)) return rule ?? null
  return draftType.value === "weekly"
    ? { type: "weekly", time: time.value, weekday: weekday.value, timezone }
    : { type: "daily", time: time.value, timezone }
})
const weekdays = Array.from({ length: 7 }, (_, day) => ({
  value: day,
  label: new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, 0, 4 + day))),
}))
const environmentID = ref(
  props.schedule
    ? (props.schedule.environmentID ?? "")
    : (props.plan?.environmentID ?? "")
)
const saving = ref(false)
const ruleOptions = computed(() => [
  { value: "off" as const, label: t("workbench_schedule.off") },
  ...(["interval", "daily", "weekly"] as const).map((value) => ({
    value,
    label: t(`workbench_schedule.${value}`),
  })),
])
const environmentOptions = computed(() => [
  { value: "", label: t("environment.no_environment") },
  ...(environmentID.value &&
  !environments.value.some(({ id }) => id === environmentID.value)
    ? [
        {
          value: environmentID.value,
          label: t("workbench_mcp.environment_missing"),
        },
      ]
    : []),
  ...environments.value.map((environment) => ({
    value: environment.id,
    label: environment.name,
  })),
])
const error = ref("")
const form = ref<HTMLFormElement>()

const save = async () => {
  const target = selectedTarget.value
  if (saving.value || !target || !form.value?.reportValidity()) return false
  const parsed = AutomationConfigSchema.safeParse(config.value)
  if (!parsed.success) {
    error.value = t("workbench_schedule.invalid_config")
    return false
  }
  saving.value = true
  error.value = ""
  try {
    const rule: AutomationScheduleRule | null =
      !schedulingAvailable || type.value === "off" ? null : draftRule.value
    const environment = environments.value.find(
      ({ id }) => id === environmentID.value
    )
    // 仅复制选中环境的本机当前值到该计划，后台不会写回调试环境。
    const overrides = rule
      ? environment?.variables.flatMap((variable, index) => {
          const secret = variable.secret
            ? secretValues.getSecretEnvironmentVariableValue(
                environment.id,
                index
              )
            : null
          const value = variable.secret
            ? secret?.value || secret?.initialValue
            : currentValues.getEnvironmentVariableValue(environment.id, index)
          return variable.key && value
            ? [{ key: variable.key, secret: variable.secret, value }]
            : []
        })
      : undefined
    if (!schedulingAvailable) {
      await workbenchMcpAPI(
        props.plan
          ? `configs/automation/${encodeURIComponent(props.plan.id)}`
          : "configs/automation",
        {
          collectionID: target.collectionID,
          requestID: target.kind === "request" ? target.id : null,
          environmentID: environmentID.value || undefined,
          config: parsed.data,
        }
      )
    } else
      await workbenchMcpAPI(
        props.plan
          ? `automation/schedules/${encodeURIComponent(props.plan.id)}`
          : "automation/schedules",
        {
          ...(target?.kind === "request" ? { requestID: target.id } : {}),
          ...(target?.kind === "group" ? { collectionID: target.id } : {}),
          environmentID: environmentID.value || null,
          rule,
          draftRule: draftRule.value,
          overrides,
          config: parsed.data,
        }
      )
    emit("saved")
    return true
  } catch (e) {
    error.value = (e as Error).message
    return false
  } finally {
    saving.value = false
  }
}
defineExpose({ save })
</script>
