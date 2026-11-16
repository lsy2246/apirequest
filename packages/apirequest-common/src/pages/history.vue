<template>
  <WorkbenchPage>
    <header class="workbench-page-header">
      <h1 class="text-xl font-semibold text-secondaryDark">
        {{ t("tab.history") }}
      </h1>
    </header>
    <section class="workbench-panel workbench-history-panel">
      <div
        class="flex items-start justify-between gap-4 border-b border-divider px-6 py-3"
      >
        <HistoryRecordingSettings />
        <HistoryResultSettings
          v-if="
            nativeWorkspace ||
            platform.auth.localSessionState?.value === 'ready'
          "
        />
      </div>
      <HistoryPanel />
    </section>
  </WorkbenchPage>
</template>
<script setup lang="ts">
import WorkbenchPage from "~/components/workbench/Page.vue"
import HistoryResultSettings from "~/components/history/ResultSettings.vue"
import HistoryRecordingSettings from "~/components/history/RecordingSettings.vue"
import { platform } from "~/platform"
import HistoryPanel from "~/components/history/index.vue"
import { useI18n } from "~/composables/i18n"
const t = useI18n()
const nativeWorkspace = window.__APIREQUEST_NATIVE__ === true
</script>
