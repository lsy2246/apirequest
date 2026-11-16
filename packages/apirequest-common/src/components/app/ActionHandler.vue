<template>
  <AppShortcuts :show="showShortcuts" @close="showShortcuts = false" />
  <HttpResponseInterface
    v-if="isDrawerOpen"
    :show="isDrawerOpen"
    @close="isDrawerOpen = false"
  />
</template>

<script setup lang="ts">
import { ref } from "vue";
import { defineActionHandler } from "~/helpers/actions";
import { platform } from "~/platform";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "~/composables/i18n";
import { useToast } from "~/composables/toast";
import { requestAsCurl } from "~/helpers/request-as-curl";
import { requestHasSharedSecrets } from "~/helpers/request-type";
import { copyToClipboard } from "~/helpers/utils/clipboard";

const t = useI18n()
const toast = useToast()

const showShortcuts = ref(false)
const isDrawerOpen = ref(false)

defineActionHandler("flyouts.keybinds.toggle", () => {
  showShortcuts.value = !showShortcuts.value
})

defineActionHandler("response.schema.toggle", () => {
  isDrawerOpen.value = !isDrawerOpen.value
})
defineActionHandler("workspace.reconnect", () => {
  void platform.auth.performAuthInit()
})

defineActionHandler("share.request", async ({ request }) => {
  try {
    const curl = await requestAsCurl(request)
    if (!curl) throw new Error("Cannot generate cURL")
    if (platform.localDesktop) {
      await invoke("workbench_copy_curl", { text: curl })
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(curl)
    } else {
      copyToClipboard(curl)
    }
    toast.success(t("state.copied_to_clipboard"))
    if (requestHasSharedSecrets(request))
      toast.info(t("shared_requests.auth_warning"))
  } catch {
    toast.error(t("error.copy_failed"))
  }
})
</script>
