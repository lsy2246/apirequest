<template>
  <section class="flex flex-col gap-5 p-5">
    <header class="flex items-start justify-between gap-4">
      <div>
        <h2 class="font-semibold text-secondaryDark">
          {{ t("settings.request_sending") }}
        </h2>
        <p class="mt-2 text-tiny text-secondaryLight">
          {{ t("settings.request_sending_description") }}
        </p>
      </div>
    </header>
    <div class="space-y-2">
      <WorkbenchToggle
        :on="enabled"
        @change="request = { ...request, queryEncoding: $event }"
      >
        {{ t("settings.query_parameters_encoding") }}
      </WorkbenchToggle>
      <p class="text-tiny leading-relaxed text-secondaryLight">
        {{ t("request_case.encoding_hint") }}
      </p>
    </div>
    <HistoryResultSettings v-if="supportsHistoryResults" toggle-only />
    <section
      v-for="[id, settings] in kernelInterceptorsWithSettings"
      :key="id"
      class="space-y-3"
    >
      <component :is="settings.component" />
    </section>
  </section>
</template>
<script setup lang="ts">
import { computed } from "vue"
import { useService } from "dioc/vue"
import type { HoppRESTRequest } from "@apirequest/data"
import { useI18n } from "~/composables/i18n"
import { useSetting } from "~/composables/settings"
import WorkbenchToggle from "./Toggle.vue"
import HistoryResultSettings from "~/components/history/ResultSettings.vue"
import { platform } from "~/platform"
import { KernelInterceptorService } from "~/services/kernel-interceptor.service"
const request = defineModel<HoppRESTRequest>({ required: true })
const supportsHistoryResults = computed(
  () =>
    platform.localDesktop || platform.auth.localSessionState?.value === "ready"
)
const kernelInterceptorService = useService(KernelInterceptorService)
const kernelInterceptorsWithSettings = computed(() =>
  kernelInterceptorService.available.value.flatMap((interceptor) =>
    interceptor.settingsEntry
      ? [[interceptor.id, interceptor.settingsEntry] as const]
      : []
  )
)
const t = useI18n(),
  legacyMode = useSetting("ENCODE_MODE")
const enabled = computed(
  () => request.value.queryEncoding ?? legacyMode.value !== "disable"
)
</script>
