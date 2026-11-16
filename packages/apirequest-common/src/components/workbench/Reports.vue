<template>
  <section class="workbench-panel">
    <h3
      class="border-b border-divider px-5 py-3 font-semibold text-secondaryDark"
    >
      {{ t("workbench.recent_reports") }}
    </h3>
    <WorkbenchState
      v-if="loading && !filtered.length"
      kind="loading"
      :title="t('state.loading')"
    />
    <WorkbenchState
      v-else-if="error && !filtered.length"
      kind="error"
      :title="t('workbench.load_failed')"
      :description="t('workbench.load_failed_description')"
      :detail="error"
    >
      <HoppButtonSecondary
        :label="t('action.retry')"
        outline
        @click="refreshScheduled"
      />
    </WorkbenchState>
    <WorkbenchState
      v-else-if="!filtered.length"
      :title="t('workbench.no_reports')"
      :icon="IconChart"
    />
    <p v-else-if="error" role="alert" class="px-5 py-3 text-secondary">
      {{ t("workbench.refresh_failed") }}
    </p>
    <div
      v-for="report in filtered"
      :key="report.id"
      class="workbench-report-row border-b border-dividerLight px-5 py-4 last:border-0"
    >
      <button
        type="button"
        class="report-open min-w-0 rounded text-left transition hover:bg-primaryLight focus-visible:outline focus-visible:outline-accent"
        :aria-label="`${t('workbench.view_report')}: ${report.name}, ${new Date(report.createdAt).toLocaleString()}`"
        @click="openReport(report)"
      >
        <span class="report-identity min-w-0"
          ><strong class="block truncate text-secondaryDark">{{
            report.name
          }}</strong
          ><span class="text-tiny text-secondaryLight"
            >{{ new Date(report.createdAt).toLocaleString()
            }}<template v-if="report.trigger === 'schedule'">
              · {{ t("workbench_schedule.run") }}</template
            ></span
          ></span
        >
        <span class="report-summary flex flex-wrap gap-4 text-tiny">
          <span
            >{{ report.summary.completed }} {{ t("workbench.requests") }}</span
          >
          <span
            :class="
              reportFailureCount(report) ? 'text-red-500' : 'text-green-600'
            "
            >{{ reportFailureCount(report) }} {{ t("workbench.failed") }}</span
          >
        </span>
        <span class="text-tiny text-accent">{{
          t("workbench.view_report")
        }}</span>
      </button>
      <HoppButtonSecondary
        class="report-export"
        :icon="IconDownload"
        :title="t('workbench.export_report')"
        :aria-label="t('workbench.export_report')"
        @click="downloadWorkbenchReport(report)"
      />
    </div>
    <WorkbenchReportDetails
      v-if="selectedReport"
      :report="selectedReport"
      @close="selectedReport = undefined"
      @download="downloadWorkbenchReport(selectedReport)"
    />
  </section>
</template>
<script setup lang="ts">
import { reportFailureCount } from "~/helpers/runner/outcome"
import { useWorkbenchLiveQuery } from "~/composables/workbenchLive"
import WorkbenchReportDetails from "./ReportDetails.vue"
import WorkbenchState from "~/components/workbench/State.vue"
import { useRouter } from "vue-router"
import { computed, onBeforeUnmount, ref } from "vue"
import { useI18n } from "~/composables/i18n"
import {
  downloadWorkbenchReport,
  useWorkbenchReports,
  type WorkbenchReport,
} from "~/composables/workbenchReports"
import {
  workbenchMcpAPI,
  workbenchSchedulesAvailable,
} from "~/helpers/workbench-mcp"
import IconDownload from "~icons/lucide/download"
import IconChart from "~icons/lucide/chart-no-axes-combined"
const props = defineProps<{ kind?: "load" | "automation" }>()
const t = useI18n()
const router = useRouter()
const openReport = (report: WorkbenchReport) => {
  if (report.kind === "automation")
    void router.push({ path: "/automation", query: { report: report.id } })
  else selectedReport.value = report
}
const { reports } = useWorkbenchReports()
const selectedReport = ref<WorkbenchReport>()
const scheduledReports = ref<WorkbenchReport[]>([])
const loading = ref(false)
const error = ref("")
const filtered = computed(() =>
  [...reports.value, ...scheduledReports.value]
    .filter((report) => !props.kind || report.kind === props.kind)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20)
)
const controller = new AbortController()
const refreshScheduled = async () => {
  if (loading.value || controller.signal.aborted) return
  loading.value = true
  try {
    scheduledReports.value = await workbenchMcpAPI<WorkbenchReport[]>(
      "automation/reports",
      undefined,
      controller.signal
    )
    error.value = ""
  } catch (failure) {
    if (!controller.signal.aborted) error.value = (failure as Error).message
  } finally {
    loading.value = false
  }
}
useWorkbenchLiveQuery(["automation"], refreshScheduled, {
  available: props.kind === "automation" && workbenchSchedulesAvailable(),
})
onBeforeUnmount(() => {
  controller.abort()
})
</script>

<style scoped>
.workbench-report-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
}
.report-open {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
}
@media (max-width: 640px) {
  .report-open {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .report-identity {
    grid-column: 1 / -1;
  }
}
</style>
