<template>
  <HoppSmartModal
    dialog
    :title="t('workbench.report_details')"
    styles="sm:max-w-4xl"
    @close="emit('close')"
  >
    <template #body>
      <div class="space-y-5" data-testid="report-details">
        <div>
          <h3 class="break-words text-lg font-semibold text-secondaryDark">
            {{ report.name }}
          </h3>
          <p class="mt-1 text-secondaryLight">
            {{ new Date(report.createdAt).toLocaleString() }}
          </p>
          <p
            class="mt-2 font-medium"
            :class="report.summary.failed ? 'text-red-500' : 'text-secondary'"
          >
            {{ outcome }}
          </p>
        </div>
        <dl
          class="grid grid-cols-2 gap-4 rounded-lg bg-primaryLight p-4 sm:grid-cols-3"
        >
          <div>
            <dt class="text-secondaryLight">
              {{ t("workbench.report_request_count") }}
            </dt>
            <dd class="mt-1 font-semibold text-secondaryDark">
              {{ report.summary.completed }}
            </dd>
          </div>
          <div>
            <dt class="text-secondaryLight">
              {{ t("workbench.report_failure") }}
            </dt>
            <dd
              class="mt-1 font-semibold"
              :class="
                report.summary.failed ? 'text-red-500' : 'text-secondaryDark'
              "
            >
              {{ report.summary.failed }}
            </dd>
          </div>
          <div>
            <dt class="text-secondaryLight">
              {{ t("workbench.report_duration") }}
            </dt>
            <dd class="mt-1 font-semibold text-secondaryDark">
              {{ duration(report.summary.elapsedMs) }}
            </dd>
          </div>
        </dl>
        <template v-if="report.load">
          <dl class="grid grid-cols-2 gap-4 text-secondary sm:grid-cols-3">
            <div>
              <dt>{{ t("workbench.report_rate") }}</dt>
              <dd>{{ report.load.requestsPerSecond.toFixed(2) }} req/s</dd>
            </div>
            <div>
              <dt>{{ t("workbench.report_average") }}</dt>
              <dd>{{ duration(report.load.averageMs) }}</dd>
            </div>
            <div>
              <dt>P95 / P99</dt>
              <dd>
                {{ duration(report.load.p95Ms) }} /
                {{ duration(report.load.p99Ms) }}
              </dd>
            </div>
          </dl>
          <div class="flex flex-wrap gap-4 text-secondary">
            <span v-for="(count, status) in report.load.statuses" :key="status"
              >HTTP {{ status }}: {{ count }}</span
            >
          </div>
        </template>
      </div>
    </template>
    <template #footer>
      <HoppButtonSecondary
        :label="t('workbench.export_report')"
        :aria-label="t('workbench.export_report')"
        outline
        @click="emit('download')"
      />
      <HoppButtonPrimary
        :label="t('action.close')"
        :aria-label="t('action.close')"
        @click="emit('close')"
      />
    </template>
  </HoppSmartModal>
</template>
<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "~/composables/i18n"
import type { WorkbenchReport } from "~/composables/workbenchReports"
const props = defineProps<{ report: WorkbenchReport }>()
const emit = defineEmits<{
  (event: "close"): void
  (event: "download"): void
}>()
const t = useI18n()
const outcome = computed(() =>
  t(
    props.report.load?.state === "stopped"
      ? "workbench.report_stopped"
      : props.report.summary.failed
        ? "workbench.report_failed"
        : "workbench.report_completed"
  )
)
const duration = (ms: number) =>
  ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`
</script>
