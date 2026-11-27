<template>
  <div class="relative flex flex-1 flex-col overflow-auto">
    <HttpResponseMeta
      :response="doc.response"
      :is-embed="isEmbed"
      :is-loading="loading"
      :cancelled="doc.requestCancelled"
      can-retry
      @retry="invokeAction('request.send-cancel')"
    />
    <LensesResponseBodyRenderer
      v-if="!loading && hasResponse"
      v-model:document="doc"
      :is-editable="false"
      :tab-id="tabId"
      @save-as-example="saveAsExample"
    />
  </div>
  <HttpSaveResponseName
    v-model:response-name="responseName"
    :has-same-name-response="hasSameNameResponse"
    :show="showSaveResponseName"
    @submit="onSaveAsExample"
    @hide-modal="showSaveResponseName = false"
  />
</template>

<script setup lang="ts">
import { useVModel } from "@vueuse/core"
import { computed, ref } from "vue"
import { HoppRequestDocument } from "~/helpers/tab/document"
import { makeRESTResponseExample } from "~/helpers/tab/saved-response"
import { editRESTRequest } from "~/newstore/collections"
import { useToast } from "@composables/toast"
import { useI18n } from "@composables/i18n"
import { invokeAction } from "~/helpers/actions"

const t = useI18n()
const toast = useToast()

const props = defineProps<{
  document: HoppRequestDocument
  tabId: string
  isEmbed: boolean
}>()

const emit = defineEmits<{
  (e: "update:document", val: HoppRequestDocument): void
}>()

const doc = useVModel(props, "document", emit)

const hasResponse = computed(
  () =>
    doc.value.response?.type === "success" ||
    doc.value.response?.type === "fail"
)

const responseName = ref("")
const showSaveResponseName = ref(false)

const hasSameNameResponse = computed(() => {
  return responseName.value
    ? responseName.value in doc.value.request.responses
    : false
})

const loading = computed(
  // Check both response type AND testResults to ensure we stay in loading state
  // during test execution (when testResults is null)
  () => doc.value.response?.type === "loading" || doc.value.testResults === null
)

const saveAsExample = () => {
  showSaveResponseName.value = true
  responseName.value = doc.value.request.name
}

const onSaveAsExample = () => {
  const response = doc.value.response
  const saveCtx = doc.value.saveContext
  if (!response || (response.type !== "success" && response.type !== "fail"))
    return

  const resName = responseName.value.trim()
  if (!resName) return

  try {
    if (!saveCtx || saveCtx.requestIndex === undefined) {
      throw new Error("Missing request save location")
    }
    const req = {
      ...doc.value.request,
      responses: {
        ...doc.value.request.responses,
        [resName]: makeRESTResponseExample(resName, response),
      },
    }
    editRESTRequest(saveCtx.folderPath, saveCtx.requestIndex, req)
    doc.value.request = req
    showSaveResponseName.value = false
    responseName.value = ""
    toast.success(t("response.saved"))
  } catch {
    toast.error(t("ui_detail.save_failed"))
  }
}
</script>
