<template>
  <section class="workbench-panel p-5 sm:p-8" data-testid="site-settings">
    <h3 class="heading">{{ t("site_settings.title") }}</h3>
    <p class="mt-2 text-secondaryLight">{{ t("site_settings.help") }}</p>
    <p v-if="loading" class="mt-4" role="status">{{ t("state.loading") }}</p>
    <form
      v-else-if="!loadFailed"
      class="mt-5 max-w-2xl space-y-4"
      @submit.prevent="save"
    >
      <label class="block space-y-2"
        ><span>{{ t("site_settings.url") }}</span
        ><input
          v-model.trim="siteURL"
          type="url"
          required
          class="input w-full"
          :disabled="saving"
      /></label>
      <p class="text-xs text-secondaryLight">
        {{ t("site_settings.url_help") }}
      </p>
      <HoppButtonPrimary
        type="submit"
        :label="t('action.save')"
        :loading="saving"
        :disabled="saving"
      />
    </form>
    <p v-if="error" role="alert" class="mt-4 text-red-500">{{ error }}</p>
    <HoppButtonSecondary
      v-if="loadFailed"
      :label="t('action.retry')"
      @click="load"
    />
    <p v-if="saved" class="mt-4 text-green-600" role="status">
      {{ t("site_settings.saved") }}
    </p>
  </section>
</template>
<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue"
import { useI18n } from "~/composables/i18n"
import { workbenchMcpAPI } from "~/helpers/workbench-mcp"
const t = useI18n(),
  siteURL = ref(""),
  loading = ref(true),
  saving = ref(false),
  loadFailed = ref(false),
  saved = ref(false),
  error = ref("")
const controller = new AbortController()
async function load() {
  loading.value = true
  loadFailed.value = false
  error.value = ""
  try {
    siteURL.value = (
      await workbenchMcpAPI<{ siteURL: string }>(
        "site-settings",
        undefined,
        controller.signal
      )
    ).siteURL
  } catch (failure) {
    if (!controller.signal.aborted) {
      error.value = (failure as Error).message
      loadFailed.value = true
    }
  } finally {
    loading.value = false
  }
}
async function save() {
  if (saving.value) return
  saving.value = true
  saved.value = false
  error.value = ""
  try {
    const result = await workbenchMcpAPI<{ siteURL: string }>(
      "site-settings",
      { siteURL: siteURL.value },
      controller.signal
    )
    siteURL.value = result.siteURL
    saved.value = true
  } catch (failure) {
    error.value = (failure as Error).message
  } finally {
    saving.value = false
  }
}
void load()
onBeforeUnmount(() => controller.abort())
</script>
