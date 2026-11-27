<template>
  <div class="flex flex-col gap-5 p-5">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="font-semibold text-secondaryDark">
          {{ t("workbench.load_test") }}
        </h2>
        <p class="mt-2 text-tiny text-secondaryLight">
          {{ t("workbench.load_description") }}
        </p>
      </div>
      <HoppButtonSecondary
        v-if="report && !running"
        :icon="IconDownload"
        :label="t('workbench.export_report')"
        @click="downloadWorkbenchReport(report)"
      />
    </div>
    <div
      class="flex items-center gap-3 overflow-hidden rounded border border-divider bg-primaryLight px-4 py-3"
    >
      <strong :style="{ color: getMethodLabelColor(request.method) }">{{
        request.method
      }}</strong>
      <span class="truncate font-mono text-tiny text-secondaryDark">{{
        request.endpoint
      }}</span>
    </div>
    <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <label class="flex min-w-0 flex-col gap-2">
        <span>{{ t("workbench.load_mode") }}</span>
        <span class="relative block">
          <select
            v-model="config.mode"
            class="h-9 w-full cursor-pointer appearance-none rounded border border-divider bg-primary px-3 pr-8 text-secondaryDark hover:border-dividerDark focus-visible:border-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="running"
          >
            <option value="requests">{{ t("workbench.by_requests") }}</option>
            <option value="duration">{{ t("workbench.by_duration") }}</option>
          </select>
          <IconChevronDown
            class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondaryLight"
            aria-hidden="true"
          />
        </span>
      </label>
      <label class="flex flex-col gap-2"
        ><span>{{ t("workbench.concurrency") }}</span
        ><input
          v-model.number="config.concurrency"
          type="number"
          min="1"
          :max="LOAD_TEST_LIMITS.concurrency"
          class="h-9 min-w-0 rounded border border-divider bg-primary px-3"
          :disabled="running"
      /></label>
      <label class="flex flex-col gap-2"
        ><span>{{
          t(
            config.mode === "requests"
              ? "workbench.request_count"
              : "workbench.duration_seconds"
          )
        }}</span
        ><input
          v-if="config.mode === 'requests'"
          v-model.number="config.requests"
          type="number"
          min="1"
          :max="LOAD_TEST_LIMITS.requests"
          class="h-9 min-w-0 rounded border border-divider bg-primary px-3"
          :disabled="running" /><input
          v-else
          v-model.number="config.durationSeconds"
          type="number"
          min="1"
          :max="LOAD_TEST_LIMITS.durationSeconds"
          class="h-9 min-w-0 rounded border border-divider bg-primary px-3"
          :disabled="running"
      /></label>
      <label class="flex flex-col gap-2"
        ><span>{{ t("workbench.timeout_ms") }}</span
        ><input
          v-model.number="config.timeoutMs"
          type="number"
          min="1"
          :max="LOAD_TEST_LIMITS.timeoutMs"
          class="h-9 min-w-0 rounded border border-divider bg-primary px-3"
          :disabled="running"
      /></label>
    </div>
    <p class="text-tiny text-secondaryLight">
      {{ t("workbench.load_snapshot_notice") }}
    </p>
    <p v-if="error" role="alert" class="text-red-500">{{ error }}</p>
    <div class="flex gap-3">
      <HoppButtonPrimary
        v-if="!running"
        :icon="IconPlay"
        :label="t('workbench.start_load_test')"
        :disabled="preparing"
        :loading="preparing"
        @click="prepare"
      /><HoppButtonPrimary
        v-else
        :icon="IconSquare"
        :label="t('action.stop')"
        @click="runner?.stop()"
      />
    </div>
    <template v-if="report">
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div
          v-for="metric in metrics"
          :key="metric.label"
          class="rounded border border-divider bg-primary px-4 py-4"
        >
          <p class="text-tiny text-secondaryLight">{{ t(metric.label) }}</p>
          <strong class="mt-2 block text-xl font-semibold text-secondaryDark">{{
            metric.value
          }}</strong>
        </div>
      </div>
      <div class="rounded border border-divider p-4">
        <h3 class="mb-3 font-semibold">{{ t("workbench.throughput") }}</h3>
        <svg
          v-if="report.series.length"
          viewBox="0 0 800 120"
          class="h-32 w-full"
          role="img"
          :aria-label="t('workbench.throughput')"
        >
          <line
            x1="0"
            y1="115"
            x2="800"
            y2="115"
            stroke="var(--divider-color)"
          />
          <polyline
            :points="chartPoints"
            fill="none"
            stroke="var(--accent-color)"
            stroke-width="2.5"
          />
        </svg>
        <div class="flex flex-wrap gap-2">
          <span
            v-for="(count, status) in report.statuses"
            :key="status"
            class="rounded bg-primaryLight px-3 py-1 text-tiny"
            >{{ loadStatusLabel(status) }}: {{ count }}</span
          >
        </div>
      </div>
      <p v-if="report.state === 'stopped'" class="text-secondaryLight">
        {{ t("workbench.load_stopped") }} {{ report.cancelled }}
      </p>
      <p v-if="report.cleanupIncomplete" role="alert" class="text-red-500">
        {{ t("workbench.cleanup_incomplete") }}
      </p>
      <p v-if="report.state === 'limit'" class="text-secondaryLight">
        {{ t("workbench.load_limit") }}
      </p>
    </template>
    <HoppSmartConfirmModal
      :show="confirming"
      :title="
        t('workbench.confirm_load', {
          target: confirmedTarget,
          concurrency: confirmedConfig?.concurrency,
          amount:
            confirmedConfig?.mode === 'requests'
              ? confirmedConfig.requests
              : `${confirmedConfig?.durationSeconds}s`,
        })
      "
      @hide-modal="confirming = false"
      @resolve="start"
    />
  </div>
</template>
<script setup lang="ts">
import { getMethodLabelColor } from "~/helpers/rest/labelColoring"
import { computed, onBeforeUnmount, reactive, ref, shallowRef } from "vue"
import { useService } from "dioc/vue"
import type { HoppRESTRequest } from "@apirequest/data"
import { cloneDeep } from "lodash-es"
import { useI18n } from "~/composables/i18n"
import {
  downloadWorkbenchReport,
  useWorkbenchReports,
} from "~/composables/workbenchReports"
import { KernelInterceptorService } from "~/services/kernel-interceptor.service"
import type { HoppInheritedProperty } from "~/helpers/types/HoppInheritedProperties"
import {
  LOAD_TEST_LIMITS,
  LoadTestRunner,
  validateLoadTestConfig,
  type LoadTestConfig,
  type LoadTestReport,
} from "~/helpers/load-test/runner"
import { prepareLoadTest } from "~/helpers/load-test/prepare"
import IconChevronDown from "~icons/lucide/chevron-down"
import IconPlay from "~icons/lucide/play"
import IconSquare from "~icons/lucide/square"
import IconDownload from "~icons/lucide/download"
function loadStatusLabel(status: string) {
  if (status === "workbench-429") return "工作台频率超限 (429)"
  if (status === "workbench-503") return "工作台转发不可用 (503)"
  return status
}

const props = defineProps<{
  request: HoppRESTRequest
  inherited?: HoppInheritedProperty
  initialConfig?: Partial<LoadTestConfig>
}>()
const t = useI18n()
const interceptor = useService(KernelInterceptorService)
const { add } = useWorkbenchReports()
const config = reactive<LoadTestConfig>({
  mode: "requests",
  concurrency: 2,
  requests: 20,
  durationSeconds: 10,
  timeoutMs: 10000,
  ...props.initialConfig,
})
const running = ref(false)
const preparing = ref(false)
const confirming = ref(false)
const confirmedTarget = ref("")
const report = shallowRef<LoadTestReport>()
const runner = shallowRef<LoadTestRunner>()
const error = ref("")
let runName = ""
let confirmedConfig: LoadTestConfig | undefined
let alive = true
const prepare = async () => {
  if (running.value || preparing.value) return
  error.value = ""
  preparing.value = true
  try {
    confirmedConfig = { ...config }
    validateLoadTestConfig(confirmedConfig)
    runName = props.request.name
    const prepared = await prepareLoadTest(
      cloneDeep(props.request),
      props.inherited,
      interceptor
    )
    if (!alive) return
    runner.value = prepared.runner
    confirmedTarget.value = prepared.target
    confirming.value = true
  } catch {
    error.value = t("workbench.invalid_load_config")
  } finally {
    preparing.value = false
  }
}
const start = async () => {
  confirming.value = false
  if (!runner.value || !confirmedConfig || running.value) return
  running.value = true
  error.value = ""
  try {
    const result = await runner.value.run(confirmedConfig, (value) => {
      if (alive) report.value = value
    })
    await add({
      id: result.id,
      kind: "load",
      name: runName,
      createdAt: result.startedAt,
      summary: {
        completed: result.completed,
        failed: result.failed,
        elapsedMs: result.elapsedMs,
      },
      load: result,
    })
  } catch {
    if (alive) error.value = t("workbench.load_failed")
  } finally {
    if (alive) running.value = false
  }
}
onBeforeUnmount(() => {
  alive = false
  runner.value?.stop()
})
const metrics = computed(() => {
  const r = report.value
  if (!r) return []
  return [
    { label: "workbench.completed", value: String(r.completed) },
    {
      label: "workbench.requests_per_second",
      value: r.requestsPerSecond.toFixed(1),
    },
    {
      label: "workbench.error_rate",
      value: `${(r.completed ? (r.failed / r.completed) * 100 : 0).toFixed(1)}%`,
    },
    {
      label: "workbench.average_latency",
      value: `${r.averageMs.toFixed(1)} ms`,
    },
    { label: "workbench.p50", value: `${r.p50Ms.toFixed(1)} ms` },
    { label: "workbench.p95", value: `${r.p95Ms.toFixed(1)} ms` },
    { label: "workbench.p99", value: `${r.p99Ms.toFixed(1)} ms` },
    { label: "workbench.max_latency", value: `${r.maxMs.toFixed(1)} ms` },
  ]
})
const chartPoints = computed(() => {
  const points = report.value?.series ?? []
  const max = Math.max(
    1,
    ...points.map((point) => point.succeeded + point.failed)
  )
  return points
    .map(
      (point, index) =>
        `${points.length === 1 ? 400 : (index / (points.length - 1)) * 800},${115 - ((point.succeeded + point.failed) / max) * 100}`
    )
    .join(" ")
})
</script>
