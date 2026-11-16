<template>
  <div class="min-w-0 flex-1">
    <WorkbenchToggle
      :on="recordHistory && isHistoryStoreEnabled"
      :disabled="
        busy ||
        isFetchingHistoryStoreStatus ||
        hasErrorFetchingHistoryStoreStatus
      "
      @change="setRecording"
    >
      {{ t("history.record_requests") }}
    </WorkbenchToggle>
    <p class="mt-2 text-tiny text-secondaryLight">
      {{ t("history.record_description") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue"
import WorkbenchToggle from "~/components/workbench/Toggle.vue"
import { useI18n } from "~/composables/i18n"
import { useSetting } from "~/composables/settings"
import { useToast } from "~/composables/toast"
import {
  ensureFullHistoryStorage,
  historyResultAPI,
} from "~/helpers/workbench-history-results"
import { refreshWebHistory } from "~/helpers/refresh-history"
import {
  isHistoryStoreEnabled,
  isFetchingHistoryStoreStatus,
  hasErrorFetchingHistoryStoreStatus,
} from "~/lib/sync/history/status"
import { platform } from "~/platform"

const t = useI18n()
const toast = useToast()
const recordHistory = useSetting("RECORD_HISTORY")
const busy = ref(false)

async function setRecording(enabled: boolean) {
  if (busy.value) return
  busy.value = true
  try {
    if (enabled) await ensureFullHistoryStorage()
    if (
      !import.meta.env.VITE_WORKBENCH_NATIVE &&
      enabled &&
      !isHistoryStoreEnabled.value &&
      !platform.localDesktop
    ) {
      await historyResultAPI("recording/enable", { method: "POST" })
      isHistoryStoreEnabled.value = true
      await refreshWebHistory?.()
    }
    recordHistory.value = enabled
  } catch {
    toast.error(t("history.record_failed"))
  } finally {
    busy.value = false
  }
}
</script>
