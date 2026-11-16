<!-- eslint-disable prettier/prettier -->
<template>
  <HoppSmartModal
    v-if="show"
    dialog
    :title="`${t('collection.save_as')}`"
    @close="hideModal"
  >
    <template #body>
      <div class="flex flex-col">
        <div class="flex gap-1">
          <HoppSmartInput
            v-model="requestName"
            class="flex-grow"
            styles="relative flex"
            placeholder=" "
            :label="t('request.name')"
            input-styles="floating-input"
            @submit="saveRequestAs"
          />
          <HoppButtonSecondary
            v-if="canDoRequestNameGeneration"
            v-tippy="{ theme: 'tooltip' }"
            :icon="IconSparkle"
            :disabled="isGenerateRequestNamePending"
            class="rounded-md"
            :class="{
              'animate-pulse': isGenerateRequestNamePending,
            }"
            :title="t('ai_experiments.generate_request_name')"
            @click="
              async () => {
                await generateRequestName(requestContext)
                submittedFeedback = false
              }
            "
          />
        </div>

        <label class="p-4">
          {{ t("collection.select_location") }}
        </label>
        <button
          v-if="canSaveAtRoot"
          type="button"
          class="flex items-center gap-2 rounded px-3 py-2 text-left hover:bg-primaryLight"
          :class="
            !picked
              ? 'bg-primaryLight font-semibold text-accent'
              : 'text-secondary'
          "
          :aria-pressed="!picked"
          @click="onSelect(null)"
        >
          <IconFolderRoot class="svg-icons" />
          {{ t("workbench.root_directory") }}
        </button>
        <Collections
          :picked="picked"
          :save-request="true"
          @select="onSelect"
          @update-collection-type="updateCollectionType"
        />
      </div>
    </template>
    <template #footer>
      <div class="flex justify-between items-center w-full">
        <div class="flex space-x-2">
          <HoppButtonPrimary
            :label="`${t('action.save')}`"
            :loading="modalLoadingState"
            outline
            @click="saveRequestAs"
          />
          <HoppButtonSecondary
            :label="`${t('action.cancel')}`"
            outline
            filled
            @click="hideModal"
          />
        </div>

        <div
          v-if="lastTraceID && !submittedFeedback"
          class="flex items-center gap-2"
        >
          <p>{{ t("ai_experiments.feedback_cta_request_name") }}</p>
          <template v-if="!isSubmitFeedbackPending">
            <HoppButtonSecondary
              :icon="IconThumbsUp"
              outline
              @click="
                async () => {
                  if (lastTraceID) {
                    await submitFeedback('positive', lastTraceID)
                    submittedFeedback = true
                  }
                }
              "
            />
            <HoppButtonSecondary
              :icon="IconThumbsDown"
              outline
              @click="
                async () => {
                  if (lastTraceID) {
                    await submitFeedback('negative', lastTraceID)
                    submittedFeedback = true
                  }
                }
              "
            />
          </template>
          <template v-else>
            <HoppSmartSpinner />
          </template>
        </div>
        <div v-if="submittedFeedback">
          <p>{{ t("ai_experiments.feedback_thank_you") }}</p>
        </div>
      </div>
    </template>
  </HoppSmartModal>
</template>

<script setup lang="ts">
import IconFolderRoot from "~icons/lucide/folder-open";
import IconSparkle from "~icons/lucide/sparkles";
import IconThumbsDown from "~icons/lucide/thumbs-down";
import IconThumbsUp from "~icons/lucide/thumbs-up";
import { useI18n } from "@composables/i18n";
import { useToast } from "@composables/toast";
import { HoppGQLRequest, HoppRESTRequest, generateUniqueRefId, isGQLRequest } from "@apirequest/data";
import { computedWithControl } from "@vueuse/core";
import { useService } from "dioc/vue";
import { cloneDeep } from "lodash-es";
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useRequestNameGeneration, useSubmitFeedback } from "~/composables/ai-experiments";
import { requestWithLatestGQLResponse, requestWithLatestRESTResponse } from "~/helpers/tab/saved-response";
import { Picked } from "~/helpers/types/HoppPicked";
import { cascadeParentCollectionForProperties, editRESTRequest, navigateToFolderWithIndexPath, restCollectionStore, saveRESTRequestAs, saveRESTRequestAtRoot } from "~/newstore/collections";
import { platform } from "~/platform";
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs";

import { handleTokenValidation } from "~/helpers/handleTokenValidation";
const t = useI18n()
const toast = useToast()
const workspaceTabs = useService(WorkspaceTabsService)
type CollectionType = {
  type: "my-collections"
  selectedTeam: undefined
}
const props = withDefaults(
  defineProps<{
    show: boolean
    request?: HoppRESTRequest | HoppGQLRequest | null
  }>(),
  {
    show: false,
    request: null,
  }
)
const emit = defineEmits<{
  (
    event: "edit-request",
    payload: {
      folderPath: string
      requestIndex: string
      request: HoppRESTRequest
    }
  ): void
  (e: "hide-modal"): void
}>()
const workspaceRequestName = computedWithControl(
  () => workspaceTabs.currentActiveTab.value,
  () => {
    const doc = workspaceTabs.currentActiveTab.value?.document
    if (doc?.type === "request" || doc?.type === "gql-request")
      return doc.request.name
    return ""
  }
)
const reqName = computed(
  () => props.request?.name ?? workspaceRequestName.value
)
const requestContext = computed(() => {
  if (props.request) return props.request
  const doc = workspaceTabs.currentActiveTab.value?.document
  return doc?.type === "request" || doc?.type === "gql-request"
    ? doc.request
    : undefined
})
const requestName = ref(reqName.value)
const {
  canDoRequestNameGeneration,
  generateRequestName,
  isGenerateRequestNamePending,
  lastTraceID,
} = useRequestNameGeneration(requestName)
watch(
  () => props.show,
  (newVal) => {
    if (!newVal) {
      submittedFeedback.value = false
      lastTraceID.value = null
    }
  }
)
const submittedFeedback = ref(false)
const { submitFeedback, isSubmitFeedbackPending } = useSubmitFeedback()
watch(workspaceRequestName, (name) => {
  requestName.value = name
})
const requestData = reactive({
  name: requestName,
  collectionIndex: undefined as number | undefined,
  folderName: undefined as number | undefined,
  requestIndex: undefined as number | undefined,
})
const collectionsType = ref<CollectionType>({
  type: "my-collections",
  selectedTeam: undefined,
})
const picked = ref<Picked | null>(null)
const canSaveAtRoot = computed(
  () => collectionsType.value.type === "my-collections"
)
const modalLoadingState = ref(false)
// Resets
watch(
  () => requestData.collectionIndex,
  () => {
    requestData.folderName = undefined
    requestData.requestIndex = undefined
  }
)
watch(
  () => requestData.folderName,
  () => {
    requestData.requestIndex = undefined
  }
)
const updateCollectionType = (type: CollectionType["type"]) => {
  if (collectionsType.value.type !== type) picked.value = null
  collectionsType.value.type = type
}
const onSelect = (pickedVal: Picked | null) => {
  picked.value = pickedVal
}
const saveRequestAs = async () => {
  const isValidToken = await handleTokenValidation()
  if (!isValidToken) return
  const workspaceTab = workspaceTabs.currentActiveTab.value
  if (!workspaceTab) return
  if (!requestName.value) {
    toast.error(`${t("error.empty_req_name")}`)
    return
  }
  const doc = workspaceTab.document
  const requestUpdated =
    doc.type === "request"
      ? cloneDeep(requestWithLatestRESTResponse(doc))
      : doc.type === "gql-request"
        ? cloneDeep(requestWithLatestGQLResponse(doc))
        : null
  if (!requestUpdated) return
  requestUpdated.name = requestName.value
  // New entries need a fresh `_ref_id` and no `id`; otherwise sync would edit the original row instead of creating a new one.
  const destination = picked.value
  const isNewCollectionEntry =
    destination?.pickedType !== "my-request" &&
    destination?.pickedType !== "teams-request" &&
    destination?.pickedType !== "gql-my-request"
  if (isNewCollectionEntry) {
    requestUpdated._ref_id = generateUniqueRefId("req")
    delete requestUpdated.id
  } else if (!requestUpdated._ref_id) {
    requestUpdated._ref_id = generateUniqueRefId("req")
  }
  if (!destination || destination.pickedType === "my-collection") {
    const { folderPath, insertionIndex } = destination
      ? {
          folderPath: String(destination.collectionIndex),
          insertionIndex: saveRESTRequestAs(
            String(destination.collectionIndex),
            requestUpdated
          ),
        }
      : saveRESTRequestAtRoot(requestUpdated)
    if (isGQLRequest(requestUpdated)) {
      workspaceTab!.document = {
        ...workspaceTab!.document,
        type: "gql-request",
        request: requestUpdated as HoppGQLRequest,
        isDirty: false,
        cursorPosition: 0,
        saveContext: {
          originLocation: "user-collection",
          folderPath,
          requestIndex: insertionIndex,
          requestRefID: requestUpdated._ref_id ?? requestUpdated.id,
          exampleID: undefined,
        },
        inheritedProperties: cascadeParentCollectionForProperties(
          folderPath,
          "rest"
        ),
      }
    } else {
      if (workspaceTab!.document.type !== "request") return
      workspaceTab!.document = {
        ...workspaceTab!.document,
        request: requestUpdated as HoppRESTRequest,
        isDirty: false,
        type: "request",
        saveContext: {
          originLocation: "user-collection",
          folderPath,
          requestIndex: insertionIndex,
          requestRefID: requestUpdated._ref_id ?? requestUpdated.id,
          exampleID: undefined,
        },
      }
      workspaceTab!.document.inheritedProperties =
        cascadeParentCollectionForProperties(folderPath, "rest")
    }
    platform.analytics?.logEvent({
      type: "HOPP_SAVE_REQUEST",
      createdNow: true,
      platform: isGQLRequest(requestUpdated) ? "gql" : "rest",
      workspaceType: "personal",
    })
    requestSaved()
  } else if (destination.pickedType === "my-folder") {
    const insertionIndex = saveRESTRequestAs(
      destination.folderPath,
      requestUpdated
    )
    if (isGQLRequest(requestUpdated)) {
      workspaceTab!.document = {
        ...workspaceTab!.document,
        type: "gql-request",
        request: requestUpdated as HoppGQLRequest,
        isDirty: false,
        cursorPosition: 0,
        saveContext: {
          originLocation: "user-collection",
          folderPath: destination.folderPath,
          requestIndex: insertionIndex,
          requestRefID: requestUpdated._ref_id ?? requestUpdated.id,
        },
        inheritedProperties: cascadeParentCollectionForProperties(
          destination.folderPath,
          "rest"
        ),
      }
    } else {
      workspaceTab!.document = {
        ...workspaceTab!.document,
        request: requestUpdated as HoppRESTRequest,
        isDirty: false,
        type: "request",
        saveContext: {
          originLocation: "user-collection",
          folderPath: destination.folderPath,
          requestIndex: insertionIndex,
          requestRefID: requestUpdated._ref_id ?? requestUpdated.id,
        },
      }
      workspaceTab!.document.inheritedProperties =
        cascadeParentCollectionForProperties(destination.folderPath, "rest")
    }
    platform.analytics?.logEvent({
      type: "HOPP_SAVE_REQUEST",
      createdNow: true,
      platform: isGQLRequest(requestUpdated) ? "gql" : "rest",
      workspaceType: "personal",
    })
    requestSaved()
  } else if (destination.pickedType === "my-request") {
    // Overwriting replaces the target's content, not its identity — keep the
    // target's own `_ref_id` and backend `id` so its tabs stay bound to it and
    // the source doesn't share identity with the copy
    const targetRequest = navigateToFolderWithIndexPath(
      restCollectionStore.value.state,
      destination.folderPath.split("/").map((x) => parseInt(x))
    )?.requests[destination.requestIndex]
    // Delete rather than assign undefined — an explicit undefined key survives
    // into the store and not every sync backend tolerates it
    if (targetRequest && "_ref_id" in targetRequest && targetRequest._ref_id) {
      requestUpdated._ref_id = targetRequest._ref_id
    } else {
      delete requestUpdated._ref_id
    }
    if (targetRequest?.id) {
      requestUpdated.id = targetRequest.id
    } else {
      delete requestUpdated.id
    }
    editRESTRequest(
      destination.folderPath,
      destination.requestIndex,
      requestUpdated
    )
    if (isGQLRequest(requestUpdated)) {
      workspaceTab!.document = {
        ...workspaceTab!.document,
        type: "gql-request",
        request: requestUpdated as HoppGQLRequest,
        isDirty: false,
        cursorPosition: 0,
        saveContext: {
          originLocation: "user-collection",
          folderPath: destination.folderPath,
          requestIndex: destination.requestIndex,
          requestRefID: requestUpdated._ref_id ?? requestUpdated.id,
        },
        inheritedProperties: cascadeParentCollectionForProperties(
          destination.folderPath,
          "rest"
        ),
      }
    } else {
      workspaceTab!.document = {
        ...workspaceTab!.document,
        request: requestUpdated as HoppRESTRequest,
        isDirty: false,
        type: "request",
        saveContext: {
          originLocation: "user-collection",
          folderPath: destination.folderPath,
          requestIndex: destination.requestIndex,
          requestRefID: requestUpdated._ref_id ?? requestUpdated.id,
        },
      }
      workspaceTab!.document.inheritedProperties =
        cascadeParentCollectionForProperties(destination.folderPath, "rest")
    }
    platform.analytics?.logEvent({
      type: "HOPP_SAVE_REQUEST",
      createdNow: false,
      platform: isGQLRequest(requestUpdated) ? "gql" : "rest",
      workspaceType: "personal",
    })
    requestSaved()
  }
}
const requestSaved = () => {
  toast.success(`${t("request.added")}`)
  nextTick(() => {
    const tab = workspaceTabs.currentActiveTab.value
    if (tab) tab.document.isDirty = false
  })
  hideModal()
}
const hideModal = () => {
  picked.value = null
  emit("hide-modal")
}
</script>
