<template>
  <div class="space-y-5">
    <p class="text-secondaryLight">
      {{ t("workbench_capture.single_host_help") }}
    </p>
    <form class="space-y-4" @submit.prevent="save">
      <label class="block space-y-1">
        <span>{{ t("workbench_capture.mode") }}</span>
        <WorkbenchSelect
          v-model="mode"
          :options="modes"
          :disabled="busy || state.recording"
          :label="t('workbench_capture.mode')"
        />
      </label>
      <p v-if="mode === 'local'" class="text-secondaryLight">
        {{ t("workbench_capture.local_help") }}
      </p>
      <template v-else>
        <WorkbenchToggle
          v-if="supported"
          class="flex items-center gap-2"
          v-model="systemProxy"
          :disabled="busy || state.recording"
          >{{ t("workbench_capture.capture_host_proxy") }}</WorkbenchToggle
        >
        <label v-if="systemProxy && services.length" class="block space-y-1">
          <span>{{ t("workbench_capture.network_service") }}</span>
          <WorkbenchSelect
            v-model="service"
            :options="serviceOptions"
            :disabled="busy || state.recording"
            :label="t('workbench_capture.network_service')"
          />
        </label>
        <p
          class="break-all rounded border border-divider bg-primaryLight p-2 font-mono text-tiny"
        >
          {{ state.proxy || "http://127.0.0.1:18888" }}
        </p>
      </template>
      <p v-if="state.recording" class="text-secondaryLight">
        {{ t("workbench_capture.pause_before_settings") }}
      </p>
      <p v-if="error" role="alert" class="text-red-500">
        {{ t(`workbench_capture.${error}`) }}
      </p>
      <HoppButtonPrimary
        type="submit"
        :label="t('action.save')"
        :loading="busy"
        :disabled="busy || state.recording"
      />
    </form>
    <section class="space-y-3 border-t border-divider pt-4">
      <h3 class="font-semibold text-secondaryDark">
        {{ t("workbench_capture.certificate_local") }}
      </h3>
      <p class="text-secondaryLight">
        {{ t("workbench_capture.single_certificate_help") }}
      </p>
      <p>
        {{
          t(
            trusted
              ? "workbench_capture.trusted"
              : "workbench_capture.untrusted"
          )
        }}
      </p>
      <div class="flex flex-wrap gap-2">
        <HoppButtonSecondary
          :label="t('workbench_capture.certificate')"
          outline
          :disabled="busy"
          @click="downloadCertificate"
        />
        <HoppButtonSecondary
          v-if="!state.server && supported"
          :label="
            t(
              trusted
                ? 'workbench_capture.remove_certificate'
                : 'workbench_capture.trust_certificate'
            )
          "
          outline
          :loading="busy"
          @click="trusted ? trust('remove') : (confirmTrust = true)"
        />
      </div>
    </section>
    <HoppSmartConfirmModal
      :show="confirmTrust"
      :title="t('workbench_capture.trust_confirm')"
      @hide-modal="confirmTrust = false"
      @resolve="trust('install')"
    />
  </div>
</template>
<script setup lang="ts">
import WorkbenchToggle from "~/components/workbench/Toggle.vue"
import { computed, onMounted, ref } from "vue";
import { captureAPI, captureControl, type CaptureMode, type CaptureState } from "~/helpers/workbench-capture";
import { useI18n } from "~/composables/i18n";
import WorkbenchSelect from "~/components/workbench/Select.vue";
const props = defineProps<{ state: CaptureState }>()
const emit = defineEmits<{ (event: "updated", state: CaptureState): void }>()
const t = useI18n()
const mode = ref<CaptureMode>(props.state.mode || "system")
const systemProxy = ref(props.state.systemProxy)
const service = ref(props.state.service || "")
const services = ref<string[]>([])
const supported = ref(true)
const trusted = ref(false),
  busy = ref(false),
  error = ref(""),
  confirmTrust = ref(false)
const modes = computed(() => [
  { value: "system", label: t("workbench_capture.mode_system") },
  ...(props.state.capabilities.local
    ? [{ value: "local", label: t("workbench_capture.mode_local") }]
    : []),
])
const serviceOptions = computed(() => [
  { value: "", label: t("workbench_capture.network_service_auto") },
  ...services.value.map((value) => ({ value, label: value })),
])
async function save() {
  if (busy.value || props.state.recording) return
  busy.value = true
  error.value = ""
  try {
    const result = await captureControl<CaptureState>("capture_settings", {
      revision: props.state.revision,
      mode: mode.value,
      systemProxy: systemProxy.value,
      service: service.value,
    })
    emit("updated", result)
  } catch (failure) {
    error.value = (failure as Error).message
  } finally {
    busy.value = false
  }
}
async function trust(action: "install" | "remove") {
  confirmTrust.value = false
  if (busy.value) return
  busy.value = true
  error.value = ""
  try {
    trusted.value = (
      await captureControl<{ trusted: boolean }>(`certificate_${action}`)
    ).trusted
  } catch (failure) {
    error.value = (failure as Error).message
  } finally {
    busy.value = false
  }
}
async function downloadCertificate() {
  if (busy.value) return
  busy.value = true
  error.value = ""
  try {
    const result = await captureAPI<{ pem: string }>("/certificate")
    const url = URL.createObjectURL(
      new Blob([result.pem], { type: "application/x-x509-ca-cert" })
    )
    const link = document.createElement("a")
    link.href = url
    link.download = "apirequest-capture-ca.crt"
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (failure) {
    error.value = (failure as Error).message
  } finally {
    busy.value = false
  }
}
onMounted(async () => {
  try {
    const status = await captureControl<{
      services: string[]
      supported: boolean
      certificateTrusted: boolean
    }>("system_status")
    supported.value = status.supported
    services.value = status.services
    trusted.value = status.certificateTrusted
  } catch (failure) {
    error.value = (failure as Error).message
  }
})
</script>
