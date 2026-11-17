<template>
  <HoppButtonSecondary
    v-if="visible"
    class="shrink-0"
    :filled="prominent"
    :outline="prominent"
    :icon="prominent ? (isRunning ? IconPause : IconPlay) : undefined"
    :label="
      t(
        report.automation?.status === 'running'
          ? 'workbench_live.pause'
          : report.automation?.status === 'pausing'
            ? 'workbench_live.pausing'
            : 'workbench_live.resume'
      )
    "
    :disabled="
      busy ||
      report.automation?.status === 'pausing' ||
      (!isRunning && !recoverable)
    "
    :title="
      !isRunning && !recoverable ? t('workbench.recovery_missing') : undefined
    "
    @click="requestControl"
  />
  <span v-if="error" role="alert" class="text-red-500">{{ error }}</span>
  <HoppSmartModal
    v-if="chooseUnknown"
    dialog
    :title="t('workbench.recovery_unknown_title')"
    @close="chooseUnknown = false"
  >
    <template #body
      ><p class="p-4">
        {{
          t("workbench.recovery_unknown_description", {
            name: unknown?.name ?? "",
          })
        }}
      </p></template
    >
    <template #footer>
      <HoppButtonPrimary
        :label="t('workbench.recovery_retry')"
        :disabled="busy"
        @click="control('retry')"
      />
      <HoppButtonSecondary
        :label="t('workbench.recovery_skip')"
        :disabled="busy"
        @click="control('skip')"
      />
      <HoppButtonSecondary
        :label="t('action.cancel')"
        :disabled="busy"
        @click="chooseUnknown = false"
      />
    </template>
  </HoppSmartModal>
</template>
<script setup lang="ts">
import { computed, ref } from "vue"
import type { WorkbenchReport } from "~/composables/workbenchReports"
import { useI18n } from "~/composables/i18n"
import { workbenchMcpAPI } from "~/helpers/workbench-mcp"
import IconPlay from "~icons/lucide/play"
import IconPause from "~icons/lucide/pause"
const props = defineProps<{ report: WorkbenchReport; prominent?: boolean }>()
const t = useI18n()
const busy = ref(false),
  error = ref(""),
  chooseUnknown = ref(false)
const isRunning = computed(() => props.report.automation?.status === "running")
const visible = computed(() =>
  [
    "running",
    "pausing",
    "paused",
    "interrupted",
    "stopped",
    "error",
    "timeout",
    "runner_error",
  ].includes(props.report.automation?.status ?? "")
)
const recoverable = computed(
  () => !!props.report.recovery || props.report.canResume === true
)
const unknown = computed(
  () => props.report.uncertainRequest ?? props.report.recovery?.inFlight
)
function requestControl() {
  if (!isRunning.value && unknown.value) chooseUnknown.value = true
  else void control()
}
async function control(choice?: "retry" | "skip") {
  busy.value = true
  error.value = ""
  const action = isRunning.value ? "pause" : "resume"
  try {
    if (props.report.trigger === "schedule") {
      await workbenchMcpAPI(
        `automation/runs/${encodeURIComponent(props.report.id)}/control`,
        { action, ...(choice ? { choice } : {}) }
      )
    } else {
      const [{ getService }, { TestRunnerService }, { resumeRecordedRun }] =
        await Promise.all([
          import("~/modules/dioc"),
          import("~/services/test-runner/test-runner.service"),
          import("~/helpers/test-runner/recorded-run"),
        ])
      const runner = getService(TestRunnerService)
      if (action === "pause") {
        if (!runner.pauseRun(props.report.runTabID ?? ""))
          throw new Error(t("workbench.report_unavailable"))
      } else resumeRecordedRun(props.report, choice)
    }
    chooseUnknown.value = false
  } catch (failure) {
    error.value = (failure as Error).message
  } finally {
    busy.value = false
  }
}
</script>
