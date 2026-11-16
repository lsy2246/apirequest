<template>
  <div
    class="workbench-request-toolbar sticky top-0 z-20 flex-none flex-shrink-0 bg-primary p-4 sm:flex sm:flex-shrink-0"
  >
    <div
      class="workbench-request-address min-w-[12rem] flex flex-1 whitespace-nowrap rounded border border-divider"
    >
      <div class="relative flex">
        <label for="method">
          <tippy
            interactive
            trigger="click"
            theme="popover"
            :on-shown="() => methodTippyActions.focus()"
          >
            <HoppSmartSelectWrapper>
              <input
                id="method"
                class="flex w-26 cursor-pointer rounded-l bg-primaryLight px-4 py-2 font-semibold text-secondaryDark transition"
                :value="tab.document.request.method"
                :readonly="!isCustomMethod"
                :placeholder="`${t('request.method')}`"
                :style="{
                  color: getMethodLabelColor(tab.document.request.method),
                }"
                @input="onSelectMethod($event)"
              />
            </HoppSmartSelectWrapper>
            <template #content="{ hide }">
              <div
                ref="methodTippyActions"
                class="flex flex-col focus:outline-none"
                tabindex="0"
                @keyup.escape="hide()"
              >
                <HoppSmartItem
                  v-for="(method, index) in methods"
                  :key="`method-${index}`"
                  :label="method"
                  :style="{
                    color: getMethodLabelColor(method),
                  }"
                  @click="
                    () => {
                      updateMethod(method)
                      hide()
                    }
                  "
                />
              </div>
            </template>
          </tippy>
        </label>
      </div>
      <div
        class="flex flex-1 whitespace-nowrap rounded-r border-l border-divider bg-primaryLight transition"
      >
        <SmartEnvInput
          ref="urlInput"
          v-model="endpointInput"
          :placeholder="`${t('request.url_placeholder')}`"
          :auto-complete-source="userHistories"
          :auto-complete-env="true"
          :inspection-results="tabResults"
          @paste="onPasteUrl($event)"
          @enter="newSendRequest"
        />
      </div>
    </div>
    <div class="mt-2 flex sm:mt-0">
      <HoppButtonPrimary
        id="send"
        v-tippy="{ theme: 'tooltip', delay: [500, 20], allowHTML: true }"
        :title="`${t('action.send')} <kbd>${getSpecialKey()}</kbd><kbd>↩</kbd>`"
        :label="`${
          !isTabResponseLoading ? t('action.send') : t('action.cancel')
        }`"
        :icon="isTabResponseLoading ? IconSquare : IconSend"
        :aria-label="
          isTabResponseLoading ? t('action.cancel') : t('action.send')
        "
        :aria-busy="isTabResponseLoading"
        class="min-w-[5rem] flex-1"
        @click="!isTabResponseLoading ? newSendRequest() : cancelRequest()"
      />
    </div>
    <HttpImportCurl
      :text="curlText"
      :show="showCurlImportModal"
      @hide-modal="showCurlImportModal = false"
    />
    <HttpCodegenModal
      v-if="showCodegenModal"
      :show="showCodegenModal"
      curl-only
      @hide-modal="showCodegenModal = false"
    />
    <CollectionsSaveRequest
      v-if="showSaveRequestModal"
      mode="workspace"
      :show="showSaveRequestModal"
      :request="request"
      @hide-modal="showSaveRequestModal = false"
    />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "@composables/i18n";
import { useReadonlyStream, useStreamSubscriber } from "@composables/stream";
import { useToast } from "@composables/toast";
import { useVModel } from "@vueuse/core";
import * as E from "fp-ts/Either";
import { computed, nextTick, ref, onUnmounted, watch } from "vue";
import { defineActionHandler, invokeAction } from "~/helpers/actions";

import { getPlatformSpecialKey as getSpecialKey } from "~/helpers/platformutils";
import { runRESTRequest$ } from "~/helpers/RequestRunner";
import { HoppRESTResponse } from "~/helpers/types/HoppRESTResponse";
import { requestWithLatestRESTResponse } from "~/helpers/tab/saved-response";
import { editRESTRequest } from "~/newstore/collections";
import IconSend from "~icons/lucide/send";
import IconSquare from "~icons/lucide/square";
import { useSetting } from "~/composables/settings";
import { getDefaultRESTRequest } from "~/helpers/rest/default";
import { formatRequestQuery, splitRequestQuery } from "~/helpers/rest/request-query";
import { RESTHistoryEntry, restHistory$ } from "~/newstore/history";
import { platform } from "~/platform";
import { HoppRESTRequest } from "@apirequest/data";
import { useService } from "dioc/vue";
import { InspectionService } from "~/services/inspection";
import { HoppTab } from "~/services/tab";
import { HoppRequestDocument } from "~/helpers/tab/document";
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs";
import { getMethodLabelColor } from "~/helpers/rest/labelColoring";
import { WorkspaceService } from "~/services/workspace.service";
import { KernelInterceptorService } from "~/services/kernel-interceptor.service";
import { handleTokenValidation } from "~/helpers/handleTokenValidation";
const t = useI18n()
const interceptorService = useService(KernelInterceptorService)
const methods = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "CONNECT",
  "TRACE",
  "CUSTOM",
]
const toast = useToast()
const { subscribeToStream } = useStreamSubscriber()
const props = defineProps<{
  modelValue: HoppTab<HoppRequestDocument>
}>()
const emit = defineEmits(["update:modelValue"])
const tab = useVModel(props, "modelValue", emit)
const legacyEncoding = useSetting("ENCODE_MODE")
const formatURL = (request: HoppRESTRequest) =>
  formatRequestQuery({
    ...request,
    queryEncoding: request.queryEncoding ?? legacyEncoding.value !== "disable",
  })
// 保留正在输入的分隔符和编码，直到参数表或请求对象发生变更。
const urlDraft = ref<{
  text: string
  formatted: string
  request: HoppRESTRequest
}>()
const endpointInput = computed({
  get() {
    const request = tab.value.document.request
    const formatted = formatURL(request)
    return urlDraft.value?.request === request &&
      urlDraft.value.formatted === formatted
      ? urlDraft.value.text
      : formatted
  },
  set(text: string) {
    const request = tab.value.document.request
    // 切换编码只更新地址显示，不能把原参数值中的 & 再拆成新字段。
    if (text === formatURL(request)) return
    if (isCURL(text)) {
      urlDraft.value = { text, formatted: formatURL(request), request }
      return
    }
    const existing = [
      ...splitRequestQuery(request.endpoint).params,
      ...request.params,
    ]
    const active = existing.filter((param) => param.active)
    const { endpoint, params } = splitRequestQuery(text)
    request.endpoint = endpoint
    request.params = [
      ...params.map((param) => {
        const index = active.findIndex((previous) => previous.key === param.key)
        return index === -1
          ? param
          : { ...param, description: active.splice(index, 1)[0].description }
      }),
      ...existing.filter((param) => !param.active),
    ]
    urlDraft.value = { text, formatted: formatURL(request), request }
  },
})
const newEndpoint = computed(() => {
  return tab.value.document.request.endpoint
})
const newMethod = computed(() => {
  return tab.value.document.request.method
})
const curlText = ref("")
const loading = ref(false)
const isTabResponseLoading = computed(
  () => loading.value || tab.value.document.response?.type === "loading"
)
const showCurlImportModal = ref(false)
const showCodegenModal = ref(false)
const showSaveRequestModal = ref(false)
const saveInProgress = ref(false)
const methodTippyActions = ref<any | null>(null)
const urlInput = ref<{
  focus: () => void
} | null>(null)
const history = useReadonlyStream<RESTHistoryEntry[]>(restHistory$, [])
const userHistories = computed(() => {
  return history.value.map((history) => history.request.endpoint).slice(0, 10)
})
const inspectionService = useService(InspectionService)
const tabs = useService(WorkspaceTabsService)
const workspaceService = useService(WorkspaceService)
let requestSequence = 0
const newSendRequest = async () => {
  if (isTabResponseLoading.value) return
  if (newEndpoint.value === "" || /^\s+$/.test(newEndpoint.value)) {
    toast.error(`${t("empty.endpoint")}`)
    return
  }
  ensureMethodInEndpoint()
  const sequence = ++requestSequence
  tab.value.document.requestCancelled = false
  tab.value.document.response = {
    type: "loading",
    req: tab.value.document.request,
  }
  // Clear test results to ensure loading state persists until new results arrive
  // This prevents UI flicker where old results briefly appear before new ones
  tab.value.document.testResults = null
  loading.value = true
  platform.analytics?.logEvent({
    type: "HOPP_REQUEST_RUN",
    platform: "rest",
    strategy: interceptorService.current.value!.id,
    workspaceType: workspaceService.currentWorkspace.value.type,
  })
  const [cancel, streamPromise] = runRESTRequest$(tab)
  const streamResult = await streamPromise
  // A cancelled request may finish preparing after another run has started.
  if (sequence !== requestSequence) {
    cancel()
    return
  }
  tab.value.document.cancelFunction = cancel
  if (E.isRight(streamResult)) {
    subscribeToStream(
      streamResult.right,
      (responseState) => {
        if (loading.value && sequence === requestSequence) {
          updateRESTResponse(responseState)
          // Network/extension/interceptor errors don't run test scripts, set empty results to clear loading
          if (
            responseState.type === "network_fail" ||
            responseState.type === "extension_error" ||
            responseState.type === "interceptor_error"
          ) {
            tab.value.document.testResults = {
              description: "",
              expectResults: [],
              tests: [],
              envDiff: {
                global: { additions: [], deletions: [], updations: [] },
                selected: { additions: [], deletions: [], updations: [] },
              },
              scriptError: false,
              consoleEntries: [],
            }
          }
        }
      },
      (error: unknown) => {
        if (sequence !== requestSequence) return
        console.error("Stream error:", error)
        updateRESTResponse({
          type: "network_fail",
          req: tab.value.document.request,
          error,
        })
        // Set empty testResults to clear loading state
        if (tab.value.document.testResults === null) {
          tab.value.document.testResults = {
            description: "",
            expectResults: [],
            tests: [],
            envDiff: {
              global: { additions: [], deletions: [], updations: [] },
              selected: { additions: [], deletions: [], updations: [] },
            },
            scriptError: false,
            consoleEntries: [],
          }
        }
      },
      () => {}
    )
  } else {
    let error: Error
    if (typeof streamResult.left === "string") {
      error = { name: "RequestFailure", message: streamResult.left }
    } else {
      error = streamResult.left
    }
    updateRESTResponse({
      type: "script_fail",
      error,
    })
    tab.value.document.testResults = {
      description: "",
      expectResults: [],
      tests: [],
      envDiff: {
        global: { additions: [], deletions: [], updations: [] },
        selected: { additions: [], deletions: [], updations: [] },
      },
      scriptError: true,
      consoleEntries: [],
    }
  }
}
const ensureMethodInEndpoint = () => {
  const endpoint = newEndpoint.value.trim()
  tab.value.document.request.endpoint = endpoint
  if (!/^http[s]?:\/\//.test(endpoint) && !endpoint.startsWith("<<")) {
    const domain = endpoint.split(/[/:#?]+/)[0]
    if (domain === "localhost" || /([0-9]+\.)*[0-9]/.test(domain)) {
      tab.value.document.request.endpoint = "http://" + endpoint
    } else {
      tab.value.document.request.endpoint = "https://" + endpoint
    }
  }
}
const onPasteUrl = (e: { pastedValue: string; prevValue: string }) => {
  if (!e) return
  const pastedData = e.pastedValue
  if (isCURL(pastedData)) {
    showCurlImportModal.value = true
    curlText.value = pastedData
    const request = tab.value.document.request
    urlDraft.value = {
      text: e.prevValue,
      formatted: formatURL(request),
      request,
    }
  }
}
function isCURL(curl: string) {
  return /^\s*(?:\$\s+)?curl\s/i.test(curl)
}
const currentTabID = tabs.currentTabID.value
// Clear loading state when test results are set
watch(
  () => tab.value.document.testResults,
  (newTestResults, oldTestResults) => {
    if (oldTestResults === null && newTestResults !== null && loading.value) {
      loading.value = false
    }
  }
)
onUnmounted(() => {
  //check if current tab id exist in the current tab id lists
  const isCurrentTabRemoved = !tabs
    .getActiveTabs()
    .value.some((tab) => tab.id === currentTabID)
  if (isCurrentTabRemoved) cancelRequest()
})
const cancelRequest = () => {
  requestSequence++
  loading.value = false
  tab.value.document.cancelFunction?.()
  updateRESTResponse(null)
  tab.value.document.requestCancelled = true
  // Set empty testResults - watcher will clear loading
  // Only set if null to avoid overwriting existing test results
  if (tab.value.document.testResults === null) {
    tab.value.document.testResults = {
      description: "",
      expectResults: [],
      tests: [],
      envDiff: {
        global: { additions: [], deletions: [], updations: [] },
        selected: { additions: [], deletions: [], updations: [] },
      },
      scriptError: false,
      consoleEntries: [],
    }
  }
}
const updateMethod = (method: string) => {
  tab.value.document.request.method = method
}
const onSelectMethod = (e: Event | any) => {
  // type any because of value property not being recognized by TS in the event.target object. It is a valid property though.
  updateMethod(e.target.value)
}
const clearContent = () => {
  tab.value.document.request = getDefaultRESTRequest()
  tab.value.document.response = null
  tab.value.document.requestCancelled = false
}
const updateRESTResponse = (response: HoppRESTResponse | null) => {
  tab.value.document.response = response
}
const shareRequest = () => {
  invokeAction("share.request", {
    request: tab.value.document.request,
  })
}
const cycleUpMethod = () => {
  const currentIndex = methods.indexOf(newMethod.value)
  if (currentIndex === -1) {
    // Most probs we are in CUSTOM mode
    // Cycle up from CUSTOM is PATCH
    updateMethod("PATCH")
  } else if (currentIndex === 0) {
    updateMethod("CUSTOM")
  } else {
    updateMethod(methods[currentIndex - 1])
  }
}
const cycleDownMethod = () => {
  const currentIndex = methods.indexOf(newMethod.value)
  if (currentIndex === -1) {
    // Most probs we are in CUSTOM mode
    // Cycle down from CUSTOM is GET
    updateMethod("GET")
  } else if (currentIndex === methods.length - 1) {
    updateMethod("GET")
  } else {
    updateMethod(methods[currentIndex + 1])
  }
}
const saveRequest = async () => {
  if (saveInProgress.value) return
  saveInProgress.value = true
  try {
    await saveCurrentRequest()
  } finally {
    saveInProgress.value = false
  }
}
const saveCurrentRequest = async () => {
  const isValidToken = await handleTokenValidation()
  if (!isValidToken) return
  const document = tab.value.document
  const saveCtx = document.saveContext
  if (!saveCtx) {
    showSaveRequestModal.value = true
    return
  }
  if (saveCtx.originLocation === "user-collection") {
    const req = requestWithLatestRESTResponse(document)
    try {
      if (saveCtx.requestIndex === undefined) {
        // requestIndex missing; prompt user to resave properly
        showSaveRequestModal.value = true
        return
      }
      // Ensure requestRefID is set in save context for active indicator
      if (!saveCtx.requestRefID && req._ref_id) {
        saveCtx.requestRefID = req._ref_id
      }
      editRESTRequest(saveCtx.folderPath, saveCtx.requestIndex, req)
      document.request = req
      await nextTick()
      document.isDirty = false
      platform.analytics?.logEvent({
        type: "HOPP_SAVE_REQUEST",
        platform: "rest",
        createdNow: false,
        workspaceType: "personal",
      })
      toast.success(`${t("request.saved")}`)
    } catch (_e) {
      tab.value.document.saveContext = undefined
      showSaveRequestModal.value = true
    }
  }
}
const request = ref<HoppRESTRequest | null>(null)
defineActionHandler("request.send-cancel", () => {
  if (!loading.value) newSendRequest()
  else cancelRequest()
})
defineActionHandler("request.reset", clearContent)
defineActionHandler("request.share-request", shareRequest)
defineActionHandler("request.method.next", cycleDownMethod)
defineActionHandler("request.method.prev", cycleUpMethod)
defineActionHandler("request-response.save", saveRequest)
defineActionHandler("request.save-as", (req) => {
  showSaveRequestModal.value = true
  if (req?.requestType === "rest" && req.request) {
    request.value = req.request
  }
})
defineActionHandler("request.method.get", () => updateMethod("GET"))
defineActionHandler("request.method.post", () => updateMethod("POST"))
defineActionHandler("request.method.put", () => updateMethod("PUT"))
defineActionHandler("request.method.delete", () => updateMethod("DELETE"))
defineActionHandler("request.method.head", () => updateMethod("HEAD"))
defineActionHandler("request.import-curl", () => {
  showCurlImportModal.value = true
})
defineActionHandler("request.show-code", () => {
  showCodegenModal.value = true
})
defineActionHandler("request.focus-url", () => {
  urlInput.value?.focus()
})
const isCustomMethod = computed(() => {
  return (
    tab.value.document.request.method === "CUSTOM" ||
    !methods.includes(newMethod.value)
  )
})
const tabResults = inspectionService.getResultViewFor(tabs.currentTabID.value)
</script>
