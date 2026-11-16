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
    <section v-if="activeRunTabs.length" class="workbench-panel mb-6">
      <h3
        class="border-b border-divider px-5 py-3 font-semibold text-secondaryDark"
      >
        {{ t("workbench.run_windows") }}
      </h3>
      <button
        v-for="run in activeRunTabs"
        :key="run.id"
        type="button"
        class="flex w-full items-center justify-between gap-4 border-b border-dividerLight px-5 py-3 text-left last:border-0 hover:bg-primaryLight"
        @click="router.push({ path: '/automation', query: { run: run.id } })"
      >
        <span class="truncate text-secondaryDark">{{
          run.document.collection.name
        }}</span
        ><span class="text-tiny text-secondaryLight">{{
          t("workbench.view_report")
        }}</span>
      </button>
    </section>
    <WorkbenchLiveRuns />
    <WorkbenchReports kind="automation" />
  </WorkbenchPage>
</template>

<script setup lang="ts">
import { provideWorkbenchLive } from "~/composables/workbenchLive"
import WorkbenchPage from "~/components/workbench/Page.vue"
import WorkbenchLiveRuns from "~/components/workbench/LiveRuns.vue"
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
const activeRunTabs = computed(() =>
  runTabs.value.filter(
    (tab) => tab.document.status === "running" || tab.document.status === "idle"
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
watch(
  reportID,
  async (id) => {
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    report.value = undefined
    archivedTab.value = undefined
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
      if (found) archivedTab.value = savedReportTab(found)
    } catch (failure) {
      if (!signal.aborted) error.value = (failure as Error).message
    } finally {
      if (!signal.aborted) loading.value = false
    }
  },
  { immediate: true }
)
onBeforeUnmount(() => controller?.abort())
</script>
