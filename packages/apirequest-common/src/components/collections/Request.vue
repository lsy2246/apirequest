<template>
  <div class="flex flex-col">
    <div
      class="h-1 w-full transition"
      :class="[
        {
          'bg-accentDark': isReorderable,
        },
      ]"
      @drop="!partialFolder && updateRequestOrder($event)"
      @dragover.prevent="!partialFolder && (ordering = true)"
      @dragleave="resetDragState"
      @dragend="resetDragState"
    ></div>
    <div
      class="group flex items-center border-s-2"
      :class="{
        'border-accent collection-request-current': isActive && !saveRequest,
        'border-transparent': !isActive || saveRequest,
      }"
      :aria-current="isActive && !saveRequest ? 'true' : undefined"
      :draggable="!hasNoTeamAccess && !partialFolder"
      @drop="!partialFolder && handelDrop($event)"
      @dragstart="!partialFolder && dragStart($event)"
      @dragover="!partialFolder && handleDragOver($event)"
      @dragleave="resetDragState"
      @dragend="resetDragState"
      @contextmenu.prevent="!partialFolder && options?.tippy?.show()"
    >
      <div class="ms-1 w-3 flex items-center justify-end">
        <component
          :is="isResponseVisible ? IconArrowDown : IconArrowRight"
          v-if="
            !partialFolder &&
            ((isCollectionRequestSummary(request) && request.__hasResponses) ||
              (request.responses && Object.keys(request.responses).length > 0))
          "
          class="svg-icons w-3 cursor-pointer hover:bg-primaryDark transition rounded"
          @click="toggleRequestResponse()"
        />
      </div>
      <div
        class="pointer-events-auto flex min-w-0 flex-1 cursor-pointer items-center justify-center"
        @click="selectRequest()"
      >
        <span
          class="pointer-events-none flex w-8 items-center justify-start truncate px-0.5"
          :style="{
            color: isGQL
              ? undefined
              : getMethodLabelColorClassOf((request as HoppRESTRequest).method),
          }"
        >
          <component
            :is="IconCheckCircle"
            v-if="isSelected"
            class="svg-icons"
            :class="{ 'text-accent': isSelected }"
          />
          <HoppSmartSpinner v-else-if="isRequestLoading" />
          <component
            :is="IconGraphql"
            v-else-if="isGQL"
            class="svg-icons h-3.5 w-3.5 text-accent"
          />
          <span v-else class="truncate text-tiny font-semibold">
            {{ (request as HoppRESTRequest).method }}
          </span>
        </span>
        <span
          class="pointer-events-none flex min-w-0 flex-1 items-center py-2 pr-2 transition group-hover:text-secondaryDark"
        >
          <span
            class="truncate"
            :class="{
              'text-accent': isSelected || (isActive && !saveRequest),
              'font-medium': isActive && !saveRequest,
            }"
          >
            {{ request.name }}
          </span>
          <span
            v-if="isActive"
            v-tippy="{ theme: 'tooltip' }"
            class="relative mx-3 flex h-1.5 w-1.5 flex-shrink-0"
            :title="`${t('collection.request_in_use')}`"
          >
            <span
              class="absolute inline-flex h-full w-full flex-shrink-0 animate-ping rounded-full bg-green-500 opacity-75"
            >
            </span>
            <span
              class="relative inline-flex h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-500"
            ></span>
          </span>
        </span>
      </div>
      <div v-if="!partialFolder" class="flex">
        <HoppButtonSecondary
          v-if="!saveRequest && !hasNoTeamAccess"
          v-tippy="{ theme: 'tooltip' }"
          :icon="IconRotateCCW"
          :title="t('action.restore')"
          class="hidden group-hover:inline-flex group-focus-within:inline-flex"
          @click="selectRequest()"
        />
        <span>
          <tippy
            ref="options"
            interactive
            trigger="click"
            theme="popover"
            :on-shown="() => tippyActions!.focus()"
          >
            <HoppButtonSecondary
              v-tippy="{ theme: 'tooltip' }"
              data-testid="request-more"
              :title="t('action.more')"
              :icon="IconMoreVertical"
            />
            <template #content="{ hide }">
              <div
                ref="tippyActions"
                class="flex flex-col focus:outline-none"
                tabindex="0"
                @keyup.e="edit?.$el.click()"
                @keyup.d="duplicate?.$el.click()"
                @keyup.delete="deleteAction?.$el.click()"
                @keyup.s="shareAction?.$el.click()"
                @keyup.i="documentationAction?.$el.click()"
                @keyup.a="addExampleAction?.$el.click()"
                @keyup.escape="hide()"
              >
                <HoppSmartItem
                  v-if="!hasNoTeamAccess"
                  ref="edit"
                  :icon="IconEdit"
                  :label="t('action.edit')"
                  :shortcut="['E']"
                  @click="
                    () => {
                      emit('edit-request')
                      hide()
                    }
                  "
                />
                <HoppSmartItem
                  v-if="!hasNoTeamAccess"
                  ref="duplicate"
                  :icon="IconCopy"
                  :label="t('action.duplicate')"
                  :loading="duplicateRequestLoading"
                  :shortcut="['D']"
                  @click="
                    () => {
                      emit('duplicate-request')
                    }
                  "
                />
                <HoppSmartItem
                  v-if="!hasNoTeamAccess"
                  ref="addExampleAction"
                  :icon="IconPlusCircle"
                  :label="t('action.add_example')"
                  :shortcut="['A']"
                  @click="
                    () => {
                      emit('add-example')
                      hide()
                    }
                  "
                />
                <HoppSmartItem
                  v-if="isDocumentationVisible"
                  ref="documentationAction"
                  :icon="IconBook"
                  :label="t('documentation.title')"
                  :shortcut="['I']"
                  @click="
                    () => {
                      handleDocumentationAction()
                      hide()
                    }
                  "
                />
                <HoppSmartItem
                  v-if="!hasNoTeamAccess"
                  data-testid="request-copy-curl"
                  ref="shareAction"
                  :icon="IconShare2"
                  :label="
                    platform.localDesktop
                      ? t('action.copy') + ' cURL'
                      : t('action.share')
                  "
                  :shortcut="['S']"
                  @click="
                    () => {
                      emit('share-request')
                      hide()
                    }
                  "
                />
                <HoppSmartItem
                  v-if="!hasNoTeamAccess"
                  ref="deleteAction"
                  :icon="IconTrash2"
                  :label="t('action.delete')"
                  :shortcut="['⌫']"
                  @click="
                    () => {
                      emit('remove-request')
                      hide()
                    }
                  "
                />
              </div>
            </template>
          </tippy>
        </span>
      </div>
    </div>
    <div
      class="w-full transition"
      :class="[
        {
          'bg-accentDark': isLastItemReorderable,
          'h-1 ': isLastItem,
        },
      ]"
      @drop="!partialFolder && handelDrop($event)"
      @dragover.prevent="!partialFolder && (orderingLastItem = true)"
      @dragleave="resetDragState"
      @dragend="resetDragState"
    ></div>

    <div v-if="isResponseVisible" class="flex">
      <div
        class="ml-[1.35rem] flex w-0.5 transform cursor-nsResize bg-dividerLight transition hover:scale-x-125 hover:bg-dividerDark"
      ></div>
      <div class="flex flex-col w-full pl-3">
        <CollectionsExampleResponse
          v-for="[index, [key, value]] of Object.entries(
            Object.entries(
              (request as HoppRESTRequest | HoppGQLRequest).responses
            )
          )"
          :key="key"
          :response-name="key"
          :response="value"
          :save-context="{
            requestID: requestID,
            exampleID: index,
            parentID: parentID,
            collectionsType: collectionsType,
            saveRequest: saveRequest,
          }"
          @edit-response="emit('edit-response', $event)"
          @remove-response="emit('remove-response', $event)"
          @duplicate-response="emit('duplicate-response', $event)"
          @select-response="emit('select-response', $event)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import IconCheckCircle from "~icons/lucide/check-circle"
import IconMoreVertical from "~icons/lucide/more-vertical"
import IconEdit from "~icons/lucide/edit"
import IconCopy from "~icons/lucide/copy"
import IconTrash2 from "~icons/lucide/trash-2"
import IconRotateCCW from "~icons/lucide/rotate-ccw"
import IconShare2 from "~icons/lucide/share-2"
import IconArrowRight from "~icons/lucide/chevron-right"
import IconArrowDown from "~icons/lucide/chevron-down"
import IconBook from "~icons/lucide/book"
import IconPlusCircle from "~icons/lucide/plus-circle"
import { ref, PropType, watch, computed, nextTick } from "vue"
import {
  ensureRemoteRequest,
  remoteRequestLoading,
} from "~/helpers/remote-collections"
import { isCollectionRequestSummary } from "~/helpers/collection-summary"
import { useToast } from "~/composables/toast"
import { HoppRESTRequest, HoppGQLRequest } from "@apirequest/data"
import { isGQLRequest } from "@apirequest/data"
import IconGraphql from "~icons/hopp/graphql"
import { useI18n } from "@composables/i18n"
import { useDocumentationVisibility } from "~/composables/documentationVisibility"
import { TippyComponent } from "vue-tippy"
import {
  changeCurrentReorderStatus,
  currentReorderingStatus$,
} from "~/newstore/reordering"
import { useReadonlyStream } from "~/composables/stream"
import { getMethodLabelColorClassOf } from "~/helpers/rest/labelColoring"
import { platform } from "~/platform"
import { invokeAction } from "~/helpers/actions"

type CollectionType = "my-collections" | "team-collections"

const t = useI18n()

const props = defineProps({
  request: {
    type: Object as PropType<HoppRESTRequest | HoppGQLRequest>,
    default: () => ({}),
    required: true,
  },
  partialFolder: { type: Boolean, default: false },
  requestID: {
    type: String,
    default: "",
    required: false,
  },
  parentID: {
    type: String as PropType<string | null>,
    default: null,
    required: true,
  },
  collectionsType: {
    type: String as PropType<CollectionType>,
    default: "my-collections",
    required: true,
  },
  duplicateRequestLoading: {
    type: Boolean,
    default: false,
    required: false,
  },
  saveRequest: {
    type: Boolean,
    default: false,
    required: false,
  },
  isActive: {
    type: Boolean,
    default: false,
    required: false,
  },
  hasNoTeamAccess: {
    type: Boolean,
    default: false,
    required: false,
  },
  isSelected: {
    type: Boolean as PropType<boolean | null>,
    default: false,
    required: false,
  },
  requestMoveLoading: {
    type: Array as PropType<string[]>,
    default: () => [],
    required: false,
  },
  isLastItem: {
    type: Boolean,
    default: false,
    required: false,
  },
})

type ResponsePayload = {
  responseName: string
  responseID: string
}

const emit = defineEmits<{
  (event: "edit-request"): void
  (event: "edit-response", payload: ResponsePayload): void
  (event: "duplicate-request"): void
  (event: "open-request-documentation"): void
  (event: "remove-request"): void
  (event: "select-request"): void
  (event: "share-request"): void
  (event: "add-example"): void
  (event: "drag-request", payload: DataTransfer): void
  (event: "update-request-order", payload: DataTransfer): void
  (event: "update-last-request-order", payload: DataTransfer): void
  (event: "duplicate-response", payload: ResponsePayload): void
  (event: "remove-response", payload: ResponsePayload): void
  (event: "select-response", payload: ResponsePayload): void
  (event: "toggle-children"): void
}>()

const tippyActions = ref<HTMLButtonElement | null>(null)
const edit = ref<HTMLButtonElement | null>(null)
const deleteAction = ref<HTMLButtonElement | null>(null)
const options = ref<TippyComponent | null>(null)
const duplicate = ref<HTMLButtonElement | null>(null)
const shareAction = ref<HTMLButtonElement | null>(null)
const documentationAction = ref<HTMLButtonElement | null>(null)
const addExampleAction = ref<HTMLButtonElement | null>(null)

const { isDocumentationVisible } = useDocumentationVisibility()

const isGQL = computed(() => isGQLRequest(props.request))

const dragging = ref(false)
const ordering = ref(false)
const orderingLastItem = ref(false)

const isResponseVisible = ref(false)

const currentReorderingStatus = useReadonlyStream(currentReorderingStatus$, {
  type: "collection",
  id: "",
  parentID: "",
})

watch(
  () => props.duplicateRequestLoading,
  (val) => {
    if (!val) {
      options.value!.tippy?.hide()
    }
  }
)

const selectRequest = () => {
  emit("select-request")
}

const toggleRequestResponse = async () => {
  try {
    await ensureRemoteRequest(props.request)
    await nextTick()
    emit("toggle-children")
    isResponseVisible.value = !isResponseVisible.value
  } catch {
    useToast().error(t("error.something_went_wrong"))
  }
}

const dragStart = ({ dataTransfer }: DragEvent) => {
  if (dataTransfer) {
    emit("drag-request", dataTransfer)
    dragging.value = !dragging.value
    changeCurrentReorderStatus({
      type: "request",
      id: props.requestID,
      parentID: props.parentID,
    })
  }
}

const isSameRequest = computed(() => {
  return currentReorderingStatus.value.id === props.requestID
})

const isCollectionDragging = computed(() => {
  return currentReorderingStatus.value.type === "collection"
})

const isSameParent = computed(() => {
  return currentReorderingStatus.value.parentID === props.parentID
})

const isReorderable = computed(() => {
  return (
    ordering.value &&
    !isCollectionDragging.value &&
    isSameParent.value &&
    !isSameRequest.value
  )
})

const isLastItemReorderable = computed(() => {
  return (
    orderingLastItem.value && isSameParent.value && !isCollectionDragging.value
  )
})

// Trigger the re-ordering event when a request is dragged over another request's top section
const handleDragOver = (e: DragEvent) => {
  dragging.value = true
  if (e.offsetY < 10) {
    ordering.value = true
    dragging.value = false
    orderingLastItem.value = false
  } else if (e.offsetY > 18) {
    orderingLastItem.value = true
    dragging.value = false
    ordering.value = false
  } else {
    ordering.value = false
    orderingLastItem.value = false
  }
}

const handelDrop = (e: DragEvent) => {
  if (ordering.value) {
    updateRequestOrder(e)
  } else if (orderingLastItem.value) {
    updateLastItemOrder(e)
  } else {
    updateRequestOrder(e)
  }
}

const updateRequestOrder = (e: DragEvent) => {
  if (e.dataTransfer) {
    e.stopPropagation()
    resetDragState()
    emit("update-request-order", e.dataTransfer)
  }
}

const updateLastItemOrder = (e: DragEvent) => {
  if (e.dataTransfer) {
    e.stopPropagation()
    resetDragState()
    emit("update-last-request-order", e.dataTransfer)
  }
}

const isRequestLoading = computed(() => {
  if (props.request.id && remoteRequestLoading.has(props.request.id))
    return true
  if (props.requestMoveLoading.length > 0 && props.requestID) {
    return props.requestMoveLoading.includes(props.requestID)
  }
  return false
})

const handleDocumentationAction = () => {
  const currentUser = platform.auth.getCurrentUser()

  if (!platform.localDesktop && !currentUser) {
    // 账号模式由服务端校验访问权限。
    invokeAction("workspace.reconnect")
    return
  }

  // User is authenticated, proceed with opening documentation
  emit("open-request-documentation")
}

const resetDragState = () => {
  dragging.value = false
  ordering.value = false
  orderingLastItem.value = false
}
</script>

<style scoped>
.collection-request-current {
  background-color: color-mix(in srgb, var(--accent-color) 10%, transparent);
}
</style>
