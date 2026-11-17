<template>
  <section
    v-if="detailID"
    class="flex min-h-0 flex-1 flex-col overflow-hidden bg-primary"
    data-testid="automation-result-page"
  >
    <header
      class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-divider px-5 py-3"
    >
      <HoppButtonSecondary
        :label="t('workbench.back_to_automation')"
        :aria-label="t('workbench.back_to_automation')"
        :icon="IconArrowLeft"
        @click="router.push('/automation')"
      />
      <span class="text-secondaryLight">{{
        report
          ? new Date(report.createdAt).toLocaleString()
          : t("workbench.automation")
      }}</span>
    </header>
    <details
      v-if="report?.events?.length"
      class="border-b border-divider px-5 py-2"
    >
      <summary>{{ t("workbench.recovery_events") }}</summary>
      <p
        v-for="(event, index) in report.events"
        :key="index"
        class="py-1 text-secondaryLight"
      >
        {{ new Date(event.at).toLocaleString() }} ·
        {{ t(`workbench.recovery_event_${event.action}`) }}
      </p>
    </details>
    <HttpTestRunner
      v-if="viewTab"
      :key="viewTab.id"
      :model-value="viewTab"
      :readonly="!!reportID"
      :report="report"
      @update:model-value="updateTab"
    />
    <WorkbenchState
      v-else-if="loading"
      kind="loading"
      :title="t('state.loading')"
    />
    <WorkbenchState
      v-else
      :title="t('workbench.report_unavailable')"
      :description="error || t('workbench.report_unavailable_description')"
    />
  </section>
  <WorkbenchPage v-else>
    <header class="workbench-page-header">
      <div>
        <h1 class="text-xl font-semibold text-secondaryDark">
          {{ t("workbench.automation") }}
        </h1>
        <p class="mt-2 text-secondaryLight">
          {{ t("workbench.tests_description") }}
        </p>
      </div>
    </header>
    <WorkbenchSavedPlans kind="automation" allow-scheduling hide-heading />
    <WorkbenchReports kind="automation" />
  </WorkbenchPage>
</template>

<script setup lang="ts">
import { useWorkbenchLiveQuery } from "~/composables/workbenchLive"
import { provideWorkbenchLive } from "~/composables/workbenchLive"
import WorkbenchPage from "~/components/workbench/Page.vue"
import WorkbenchReports from "~/components/workbench/Reports.vue"
import WorkbenchSavedPlans from "~/components/workbench/SavedPlans.vue"
import { computed, ref, watch, onBeforeUnmount } from "vue"
import { useRoute, useRouter } from "vue-router"
import { useService } from "dioc/vue"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import type { HoppTab } from "~/services/tab"
import type { HoppTestRunnerDocument } from "~/helpers/tab/document"
import {
  useWorkbenchReports,
  type WorkbenchReport,
} from "~/composables/workbenchReports"
import { savedReportTab } from "~/helpers/test-runner/saved-report"
import {
  workbenchMcpAPI,
  workbenchSchedulesAvailable,
} from "~/helpers/workbench-mcp"
import WorkbenchState from "~/components/workbench/State.vue"
import HttpTestRunner from "~/components/http/test/Runner.vue"
import IconArrowLeft from "~icons/lucide/arrow-left"
import { useI18n } from "~/composables/i18n"

provideWorkbenchLive()
const t = useI18n()
const route = useRoute(),
  router = useRouter(),
  tabs = useService(WorkspaceTabsService)
const { reports, ready } = useWorkbenchReports()
const runTabs = computed(() =>
  tabs
    .getActiveTabs()
    .value.filter(
      (tab): tab is HoppTab<HoppTestRunnerDocument> =>
        tab.document.type === "test-runner"
    )
)
const runID = computed(() =>
  typeof route.query.run === "string" ? route.query.run : ""
)
const reportID = computed(() =>
  typeof route.query.report === "string" ? route.query.report : ""
)
const detailID = computed(() => runID.value || reportID.value)
watch(
  [runID, runTabs],
  ([id, windows]) => {
    if (
      id &&
      windows.some((window) => window.id === id) &&
      tabs.currentTabID.value !== id
    )
      tabs.setActiveTab(id)
  },
  { immediate: true }
)
const report = ref<WorkbenchReport>(),
  archivedTab = ref<HoppTab<HoppTestRunnerDocument>>()
const loading = ref(false),
  error = ref("")
const viewTab = computed(() =>
  reportID.value
    ? archivedTab.value
    : runTabs.value.find((tab) => tab.id === runID.value)
)
const updateTab = (tab: HoppTab<HoppTestRunnerDocument>) => {
  if (reportID.value) archivedTab.value = tab
  else tabs.updateTab(tab)
}
let controller: AbortController | undefined
const refreshReport = async (id: string) => {
  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal
  const previous = report.value?.id === id ? archivedTab.value : undefined
  if (!previous) {
    report.value = undefined
    archivedTab.value = undefined
  }
  error.value = ""
  if (!id) return
  loading.value = true
  try {
    await ready
    let found = reports.value.find(
      (item) => item.id === id && item.kind === "automation"
    )
    if (!found && workbenchSchedulesAvailable())
      found = (
        await workbenchMcpAPI<WorkbenchReport[]>(
          "automation/reports",
          undefined,
          signal
        )
      ).find((item) => item.id === id && item.kind === "automation")
    if (signal.aborted) return
    report.value = found
    if (found) {
      const restored = savedReportTab(found)
      const selected = previous?.document.request?.runnerRequestID
      const request = selected
        ? restored.document.iterationResults
            ?.flatMap((iteration) => iteration.resultCollection?.requests ?? [])
            .find(
              (item) =>
                (
                  item as import("~/services/test-runner/test-runner.service").TestRunnerRequest
                ).runnerRequestID === selected
            )
        : undefined
      if (request && previous) {
        restored.document.request =
          request as import("~/services/test-runner/test-runner.service").TestRunnerRequest
        restored.document.selectedRequestPath =
          previous.document.selectedRequestPath
        restored.document.selectedIteration =
          previous.document.selectedIteration
      }
      archivedTab.value = restored
    }
  } catch (failure) {
    if (!signal.aborted) error.value = (failure as Error).message
  } finally {
    if (!signal.aborted) loading.value = false
  }
}
watch(
  [reportID, reports],
  ([id]) => {
    void refreshReport(id)
  },
  { immediate: true }
)
useWorkbenchLiveQuery(
  ["automation"],
  async () => {
    if (reportID.value) await refreshReport(reportID.value)
  },
  { available: workbenchSchedulesAvailable() }
)
onBeforeUnmount(() => controller?.abort())
</script>
