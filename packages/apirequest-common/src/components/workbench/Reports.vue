<template>
  <section class="workbench-panel">
    <h3
      class="border-b border-divider px-5 py-3 font-semibold text-secondaryDark"
    >
      {{ t("workbench.all_reports") }}
    </h3>
    <p v-if="storageError" role="alert" class="px-5 py-3 text-red-500">
      {{ t("workbench.report_save_failed") }} · {{ storageError }}
    </p>
    <p v-if="deleteError" role="alert" class="px-5 py-3 text-red-500">
      {{ deleteError }}
    </p>
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
            v-if="report.notification"
            :class="
              ['failed', 'partial'].includes(report.notification.status)
                ? 'text-red-500'
                : 'text-secondaryLight'
            "
            >{{ t(`automation_webhook.${report.notification.status}`) }}</span
          >
          <span
            v-if="report.kind === 'automation'"
            :class="operationStatusClass(report.automation?.status ?? '')"
            >{{ reportStatusLabel(report) }}</span
          >
          <span
            >{{ report.summary.completed
            }}<template
              v-if="
                ['running', 'pausing', 'paused'].includes(
                  report.automation?.status ?? ''
                )
              "
            >
              / {{ report.automation?.totalRequests || "—" }}</template
            >
            {{ t("workbench.requests") }}</span
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
      <div class="flex items-center gap-2">
        <AutomationRunControls :report="report" />
        <HoppButtonSecondary
          class="report-export"
          :icon="IconDownload"
          :title="t('workbench.export_report')"
          :aria-label="t('workbench.export_report')"
          @click="downloadWorkbenchReport(report)"
        />
        <HoppButtonSecondary
          class="report-delete"
          :icon="IconTrash"
          :title="
            t(
              isActive(report)
                ? 'workbench.report_delete_active'
                : 'workbench.delete_report'
            )
          "
          :aria-label="t('workbench.delete_report')"
          :disabled="isActive(report) || deleting"
          @click="requestDelete(report)"
        />
      </div>
      <details
        v-if="report.notification?.channels?.length"
        class="col-span-full text-xs text-secondaryLight"
      >
        <summary class="cursor-pointer">
          {{ t("automation_webhook.delivery_details") }}
        </summary>
        <ul class="mt-2 space-y-2">
          <li
            v-for="delivery in report.notification.channels"
            :key="delivery.channelID"
            :class="delivery.status === 'failed' ? 'text-red-500' : ''"
          >
            {{ delivery.name }} ·
            {{ t(`automation_webhook.${delivery.status}`) }} ·
            {{ t("automation_webhook.attempts") }} {{ delivery.attempts }}
            <span v-if="delivery.error" class="block break-words">{{
              delivery.error
            }}</span>
          </li>
        </ul>
      </details>
    </div>
    <WorkbenchReportDetails
      v-if="selectedReport"
      :report="selectedReport"
      @close="selectedReport = undefined"
      @download="downloadWorkbenchReport(selectedReport)"
    />
    <HoppSmartConfirmModal
      :show="!!deleteTarget"
      :title="
        t('workbench.report_delete_confirm', { name: deleteTarget?.name ?? '' })
      "
      @hide-modal="!deleting && (deleteTarget = undefined)"
      @resolve="deleteReport"
    />
  </section>
</template>
<script setup lang="ts">
import { operationStatusClass } from "~/helpers/ui-states"
import AutomationRunControls from "./AutomationRunControls.vue"
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
import IconTrash from "~icons/lucide/trash-2"
import IconChart from "~icons/lucide/chart-no-axes-combined"
const props = defineProps<{ kind?: "load" | "automation" }>()
const t = useI18n()
const router = useRouter()
const openReport = (report: WorkbenchReport) => {
  if (report.kind === "automation")
    void router.push({
      path: "/automation",
      query: { report: report.id },
    })
  else selectedReport.value = report
}
const { reports, storageError, remove } = useWorkbenchReports()
const isActive = (report: WorkbenchReport) =>
  ["running", "pausing"].includes(report.automation?.status ?? "")
const reportStatusLabel = (report: WorkbenchReport) => {
  const status = report.automation?.status ?? "completed"
  if (status === "interrupted" && !report.canResume && !report.recovery)
    return t("workbench.recovery_unavailable")
  if (
    (report.canResume || report.recovery) &&
    ["error", "timeout", "runner_error", "stopped"].includes(status)
  )
    return t("workbench_live.interrupted")
  if (["running", "pausing", "paused", "interrupted"].includes(status))
    return t(`workbench_live.${status}`)
  if (status === "stopped") return t("workbench.report_stopped")
  return t(
    report.summary.failed || report.errorDetails?.length
      ? "workbench_live.failed"
      : "workbench_live.completed"
  )
}
const selectedReport = ref<WorkbenchReport>()
const deleteTarget = ref<WorkbenchReport>()
const deleting = ref(false),
  deleteError = ref("")
const requestDelete = (report: WorkbenchReport) => {
  deleteError.value = ""
  deleteTarget.value = report
}
const deletedScheduledIDs = new Set<string>()
const scheduledReports = ref<WorkbenchReport[]>([])
const loading = ref(false)
const error = ref("")
const filtered = computed(() =>
  [
    ...new Map([
      ...scheduledReports.value.map((report) => [report.id, report] as const),
      ...reports.value.map((report) => {
        const remote = scheduledReports.value.find(
          (item) => item.id === report.id
        )
        return [
          report.id,
          remote
            ? {
                ...report,
                backendStored: true,
                notification: remote.notification,
              }
            : report,
        ] as const
      }),
    ]).values(),
  ]
    .filter((report) => !props.kind || report.kind === props.kind)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
)
const controller = new AbortController()
const deleteReport = async () => {
  const report = deleteTarget.value
  if (!report || deleting.value || isActive(report)) return
  deleting.value = true
  deleteError.value = ""
  try {
    if (report.trigger === "schedule" || report.backendStored) {
      await workbenchMcpAPI(
        `automation/reports/${encodeURIComponent(report.id)}/delete`,
        {}
      )
      deletedScheduledIDs.add(report.id)
      scheduledReports.value = scheduledReports.value.filter(
        (item) => item.id !== report.id
      )
      await remove(report.id)
    } else {
      await remove(report.id)
      if (report.runTabID && report.automation?.status === "paused") {
        const [{ getService }, { TestRunnerService }] = await Promise.all([
          import("~/modules/dioc"),
          import("~/services/test-runner/test-runner.service"),
        ])
        getService(TestRunnerService).discardPausedRun(report.runTabID)
      }
    }
    if (selectedReport.value?.id === report.id) selectedReport.value = undefined
    deleteTarget.value = undefined
  } catch (failure) {
    deleteError.value = `${t("workbench.report_delete_failed")} · ${(failure as Error).message}`
  } finally {
    deleting.value = false
  }
}
const refreshScheduled = async () => {
  if (loading.value || controller.signal.aborted) return
  loading.value = true
  try {
    scheduledReports.value = (
      await workbenchMcpAPI<WorkbenchReport[]>(
        "automation/reports",
        undefined,
        controller.signal
      )
    ).filter((report) => !deletedScheduledIDs.has(report.id))
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
