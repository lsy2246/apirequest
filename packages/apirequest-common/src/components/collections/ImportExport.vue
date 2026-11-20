<template>
  <HoppSmartModal
    dialog
    :title="t('modal.collections')"
    styles="sm:max-w-md"
    @close="emit('hide-modal')"
  >
    <template #body>
      <div class="border-b border-divider p-4">
        <p class="mb-4 text-secondaryLight">{{ t("workbench.curl_only") }}</p>
        <HoppButtonPrimary
          :icon="IconPlus"
          :label="t('workbench.new_curl')"
          @click="newCurl"
        />
      </div>
      <CollectionsExportFormatList
        :loading="loading"
        @export-apirequest="exportJSON"
        @export-openapi="exportOpenAPI"
      />
    </template>
  </HoppSmartModal>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import * as E from "fp-ts/Either";
import yaml from "js-yaml";
import { useI18n } from "~/composables/i18n";
import { useToast } from "~/composables/toast";
import { useReadonlyStream } from "~/composables/stream";
import { restCollections$ } from "~/newstore/collections";
import { initializeDownloadFile } from "~/helpers/import-export/export";
import { myCollectionsExporter } from "~/helpers/import-export/export/myCollections";
import { hoppCollectionsToOpenAPI } from "~/helpers/import-export/export/openapi";
import { openWorkbenchCurlImport } from "~/helpers/workbench";
import { platform } from "~/platform";
import IconPlus from "~icons/lucide/plus";
import { ensureAllRemoteCollections } from "~/helpers/remote-collections";
// 个人集合仍可导出备份及 OpenAPI 文档；接口导入统一使用 cURL。
defineProps<{ collectionsType?: unknown }>()
const emit = defineEmits<{ (event: "hide-modal"): void }>()
const t = useI18n()
const toast = useToast()
const router = useRouter()
const collections = useReadonlyStream(restCollections$, [])
const loading = ref(false)
const newCurl = () => {
  emit("hide-modal")
  return openWorkbenchCurlImport(router)
}
const hasCollections = () => {
  if (collections.value.length) return true
  toast.error(t("error.no_collections_to_export"))
  return false
}
const exportJSON = async () => {
  if (loading.value || !hasCollections()) return
  loading.value = true
  try {
    const result = await initializeDownloadFile(
      myCollectionsExporter(await ensureAllRemoteCollections()),
      "api-collections"
    )
    if (E.isRight(result)) {
      toast.success(t(result.right))
      emit("hide-modal")
    } else toast.error(t(result.left))
  } catch {
    toast.error(t("export.failed"))
  } finally {
    loading.value = false
  }
}
const exportOpenAPI = async (format: "json" | "yaml") => {
  if (loading.value || !hasCollections()) return
  loading.value = true
  try {
    const { doc } = hoppCollectionsToOpenAPI("Personal API", await ensureAllRemoteCollections())
    const result = await platform.kernelIO.saveFileWithDialog({
      data: format === "yaml" ? yaml.dump(doc) : JSON.stringify(doc, null, 2),
      contentType:
        format === "yaml" ? "application/x-yaml" : "application/json",
      suggestedFilename: `api-collections-openapi.${format}`,
      filters: [{ name: "OpenAPI", extensions: [format] }],
    })
    if (result.type === "saved" || result.type === "unknown") {
      toast.success(t("state.download_started"))
      emit("hide-modal")
    }
  } catch {
    toast.error(t("export.failed"))
  } finally {
    loading.value = false
  }
}
</script>
