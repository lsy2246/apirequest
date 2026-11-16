<template>
  <div class="flex h-full min-h-0 flex-col bg-primary">
    <form
      v-if="authenticationRequired"
      class="m-auto w-full max-w-sm space-y-4 p-6"
      @submit.prevent="login"
    >
      <h1 class="text-xl font-semibold text-secondaryDark">
        {{ t("workbench_capture.title") }}
      </h1>
      <p class="text-secondaryLight">
        {{ t("workbench_capture.owner_login") }}
      </p>
      <input
        v-model="password"
        type="password"
        autocomplete="current-password"
        :aria-label="t('workbench_capture.owner_secret')"
        class="w-full rounded border border-divider bg-primaryLight p-3"
      />
      <p v-if="error" role="alert" class="text-red-500">
        {{ t(`workbench_capture.${error}`) }}
      </p>
      <HoppButtonPrimary
        type="submit"
        :disabled="loading || !password"
        :label="t('workbench_capture.unlock')"
      />
    </form>
    <WorkbenchPage v-else-if="!ready">
      <header class="workbench-page-header">
        <h1>{{ t("workbench_capture.title") }}</h1>
      </header>
      <section class="workbench-panel">
        <WorkbenchState
          :kind="error ? 'error' : 'loading'"
          :title="t(`workbench_capture.${error || 'system_loading'}`)"
        >
          <HoppButtonSecondary
            v-if="error"
            :label="t('action.retry')"
            :disabled="loading"
            outline
            @click="refresh"
          />
        </WorkbenchState>
      </section>
    </WorkbenchPage>
    <CaptureWorkbench v-else>
      <template #access>
        <HoppButtonSecondary
          v-if="!localAccess"
          :label="t('workbench_capture.lock')"
          @click="logout"
        />
      </template>
    </CaptureWorkbench>
  </div>
</template>
<script setup lang="ts">
import WorkbenchPage from "~/components/workbench/Page.vue";
import WorkbenchState from "~/components/workbench/State.vue";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { provideWorkbenchLive } from "~/composables/workbenchLive";
import { captureAuthenticationRequired } from "~/services/workbench-realtime.service";
import { useI18n } from "~/composables/i18n";
import CaptureWorkbench from "~/components/capture/Workbench.vue";
provideWorkbenchLive("capture")
const t = useI18n()
const ready = ref(false)
const error = ref(""),
  loading = ref(false),
  password = ref("")
const authenticationRequired = ref(false),
  localAccess = ref(true)
const controller = new AbortController()
async function auth(method = "GET", body?: object) {
  const response = await fetch("/__workbench_capture/auth", {
    method,
    cache: "no-store",
    headers: {
      "X-Workbench-Capture": "1",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: controller.signal,
  })
  const result = await response.json().catch(() => null)
  if (!result) throw Error("engine_unavailable")
  if (!response.ok) throw Error(result.error || "authentication_required")
  authenticationRequired.value = !result.authenticated
  captureAuthenticationRequired.value = !result.authenticated
  localAccess.value = !!result.local
}
async function refresh() {
  if (loading.value) return
  loading.value = true
  try {
    if (!import.meta.env.VITE_WORKBENCH_NATIVE) await auth()
    if (authenticationRequired.value) {
      ready.value = false
      return
    }
    ready.value = true
    error.value = ""
  } catch (failure) {
    if (!controller.signal.aborted) error.value = (failure as Error).message
  } finally {
    loading.value = false
  }
}
async function login() {
  try {
    await auth("POST", { password: password.value })
    password.value = ""
    await refresh()
  } catch (failure) {
    error.value = (failure as Error).message
  }
}
async function logout() {
  await auth("DELETE")
  ready.value = false
}
watch(captureAuthenticationRequired, (required) => {
  if (required) {
    authenticationRequired.value = true
    ready.value = false
  }
})
onMounted(() => void refresh())
onBeforeUnmount(() => {
  controller.abort()
})
</script>
