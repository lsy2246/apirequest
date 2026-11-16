<template>
  <div class="workbench-response-meta sticky top-0 z-10 bg-primary">
    <div v-if="pending" class="response-state" aria-busy="true">
      <span class="response-state-icon"><HoppSmartSpinner /></span>
      <strong role="status">{{
        t(
          packet
            ? "workbench.running_request_scripts"
            : "workbench.request_pending"
        )
      }}</strong>
      <span class="response-state-description">
        {{ t("workbench.request_pending_description") }}
      </span>
      <span class="response-elapsed">{{ (elapsed / 1000).toFixed(1) }} s</span>
    </div>

    <div v-else-if="isCancelled" class="response-state">
      <span class="response-state-icon"><IconCircleStop /></span>
      <strong role="status">{{ t("workbench.request_cancelled") }}</strong>
      <span class="response-state-description">{{
        t("workbench.request_cancelled_description")
      }}</span>
      <HoppButtonSecondary
        v-if="canRetry"
        :label="t('action.send')"
        :icon="IconSend"
        outline
        @click="$emit('retry')"
      />
    </div>

    <div v-else-if="response == null && !isEmbed" class="response-state">
      <span class="response-state-icon"><IconSend /></span>
      <strong>{{ t("workbench.response_empty") }}</strong>
      <span class="response-state-description">{{
        t("workbench.response_waiting")
      }}</span>
    </div>

    <component
      :is="response.component"
      v-else-if="response?.type === 'extension_error'"
      class="flex-1"
    />

    <div v-else-if="failure" class="response-failure" role="alert">
      <IconCircleAlert class="response-failure-icon" />
      <div class="min-w-0 flex-1">
        <strong>{{ failure.heading }}</strong>
        <p>{{ failure.description }}</p>
        <div class="flex flex-wrap items-start gap-3">
          <HoppButtonSecondary
            v-if="canRetry"
            :label="t('workbench.retry_request')"
            :icon="IconRotateCw"
            outline
            @click="$emit('retry')"
          />
          <details v-if="failure.detail" class="response-error-details">
            <summary>{{ t("workbench.error_details") }}</summary>
            <div class="mt-2 flex items-start gap-2">
              <pre>{{ failure.detail }}</pre>
              <HoppButtonSecondary
                :icon="copyIcon"
                :aria-label="t('action.copy')"
                @click="copyResponse"
              />
            </div>
          </details>
        </div>
      </div>
    </div>

    <div v-else-if="packet" class="response-metrics">
      <span :class="statusCategory.className" class="response-status-code">
        {{ packet.statusCode }}
        {{ getStatusCodeReasonPhrase(packet.statusCode, packet.statusText) }}
      </span>
      <span
        ><span class="text-secondaryLight">{{ t("response.time") }}</span>
        {{ packet.meta.responseDuration }} ms</span
      >
      <span :title="`${packet.meta.responseSize} B`"
        ><span class="text-secondaryLight">{{ t("response.size") }}</span>
        {{ readableResponseSize }}</span
      >
    </div>

    <AppInspection
      v-if="!pending && showInspections"
      :inspection-results="tabResults"
      class="absolute right-3 top-3"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, watch, ref } from "vue"
import { useService } from "dioc/vue"
import findStatusGroup from "@helpers/findStatusGroup"
import type { HoppRESTResponse } from "~/helpers/types/HoppRESTResponse"
import { useI18n } from "@composables/i18n"
import { useCopyResponse } from "@composables/lens-actions"
import { getStatusCodeReasonPhrase } from "~/helpers/utils/statusCodes"
import { requestErrorFeedback } from "~/helpers/request-feedback"
import { InspectionService } from "~/services/inspection"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import IconSend from "~icons/lucide/send"
import IconCircleAlert from "~icons/lucide/circle-alert"
import IconCircleStop from "~icons/lucide/circle-stop"
import IconRotateCw from "~icons/lucide/rotate-cw"

const props = withDefaults(
  defineProps<{
    response: HoppRESTResponse | null | undefined
    isEmbed?: boolean
    isLoading?: boolean
    cancelled?: boolean
    showInspections?: boolean
    canRetry?: boolean
  }>(),
  { isLoading: false, cancelled: false, canRetry: false, showInspections: true }
)
defineEmits<{ retry: [] }>()
const t = useI18n()
const tabs = useService(WorkspaceTabsService)
const inspectionService = useService(InspectionService)
const tabResults = inspectionService.getResultViewFor(
  tabs.currentTabID.value,
  (result) => result.locations.type === "response"
)
const pending = computed(
  () => props.response?.type === "loading" || props.isLoading
)
const packet = computed(() =>
  props.response?.type === "success" || props.response?.type === "fail"
    ? props.response
    : null
)
const transportError = computed(() => {
  const response = props.response
  return response?.type === "network_fail" ||
    response?.type === "interceptor_error"
    ? requestErrorFeedback(response.error)
    : null
})
const isCancelled = computed(
  () => props.cancelled || transportError.value?.kind === "cancelled"
)
const elapsed = ref(0)
watch(
  pending,
  (active, _, onCleanup) => {
    if (!active) return
    elapsed.value = 0
    const started = Date.now()
    const timer = setInterval(() => {
      elapsed.value = Date.now() - started
    }, 250)
    onCleanup(() => clearInterval(timer))
  },
  { immediate: true }
)
const failure = computed(() => {
  const response = props.response
  if (response?.type === "script_fail") {
    const { name, message, stack } = response.error
    const detail = stack || `${name}: ${message}`
    return {
      heading: t("error.script_fail"),
      description: t("helpers.script_fail"),
      detail,
    }
  }
  const transport = transportError.value
  if (!transport || transport.kind === "cancelled") return null
  if (transport.kind === "timeout")
    return {
      heading: t("workbench.request_timeout"),
      description: t("workbench.request_timeout_description"),
      detail: transport.detail,
    }
  const human =
    response?.type === "interceptor_error" && response.error !== "cancellation"
      ? response.error.humanMessage
      : undefined
  return {
    heading: human?.heading(t) || t("error.network_fail"),
    description:
      human?.description(t) || t("workbench.request_network_description"),
    detail: transport.detail,
  }
})
const errorText = computed(() => failure.value?.detail ?? "")
const { copyIcon, copyResponse } = useCopyResponse(errorText)
const statusCategory = computed(() =>
  packet.value ? findStatusGroup(packet.value.statusCode) : { className: "" }
)
const readableResponseSize = computed(() => {
  const size = packet.value?.meta.responseSize ?? 0
  if (size >= 1000000) return `${(size / 1000000).toFixed(2)} MB`
  if (size >= 1000) return `${(size / 1000).toFixed(2)} KB`
  return `${size} B`
})
</script>

<style scoped>
.workbench-response-meta {
  border-bottom: 1px solid var(--divider-light-color);
}
.response-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 11px;
  padding: 42px 24px;
  text-align: center;
}
.response-state-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin-bottom: 3px;
  border-radius: 13px;
  background: var(--primary-light-color);
  color: var(--secondary-light-color);
}
.response-state-icon > svg {
  width: 23px;
  height: 23px;
}
.response-state strong {
  color: var(--secondary-dark-color);
  font-weight: 500;
}
.response-state-description {
  max-width: 30rem;
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  line-height: 1.7;
}
.response-elapsed {
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
  font-variant-numeric: tabular-nums;
}
.response-metrics {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 24px;
  padding: 15px 48px 15px 18px;
  font-size: var(--font-size-tiny);
  font-variant-numeric: tabular-nums;
}
.response-metrics > span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.response-status-code {
  font-weight: 600;
}
.response-failure {
  display: flex;
  align-items: flex-start;
  gap: 13px;
  margin: 18px;
  padding: 18px;
  border: 1px solid var(--divider-color);
  border-radius: 10px;
  background: var(--primary-light-color);
}
.response-failure-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  color: var(--status-critical-error-color);
}
.response-failure strong {
  color: var(--secondary-dark-color);
  font-weight: 500;
}
.response-failure p {
  margin: 6px 0 14px;
  color: var(--secondary-color);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.7;
}
.response-error-details {
  min-width: 0;
  flex: 1;
  padding-top: 8px;
}
.response-error-details summary {
  width: fit-content;
  cursor: pointer;
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
}
.response-error-details pre {
  flex: 1;
  min-width: 0;
  user-select: text;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: var(--font-size-tiny);
  line-height: 1.7;
  color: var(--secondary-dark-color);
}
</style>
