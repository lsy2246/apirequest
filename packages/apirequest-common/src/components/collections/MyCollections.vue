<template>
  <div class="flex flex-1 flex-col">
    <div
      class="sticky z-10 flex shrink-0 flex-col border-b border-dividerLight bg-primary"
      :class="{ 'rounded-t': saveRequest }"
      :style="
        saveRequest ? 'top: calc(-1 * var(--line-height-body))' : 'top: 0'
      "
    >
      <div class="flex items-center gap-1 px-2 pt-1">
        <input
          :value="filterText"
          type="search"
          autocomplete="off"
          class="h-8 min-w-0 flex-1 rounded border border-dividerLight bg-primaryLight px-2"
          :placeholder="t('action.search')"
          :aria-label="t('action.search')"
          @input="
            emit(
              'update:filter-text',
              ($event.target as HTMLInputElement).value
            )
          "
        />
        <CollectionsNewMenu
          compact
          :folder-only="saveRequest"
          @new-folder="emit('display-modal-add')"
        />
      </div>
      <div
        v-if="!saveRequest || filteredCollections.length > 1"
        class="flex items-center justify-end px-2"
      >
        <template v-if="!saveRequest">
          <HoppButtonSecondary
            v-tippy="{ theme: 'tooltip' }"
            :title="t('collection.locate_request')"
            :aria-label="t('collection.locate_request')"
            :icon="IconLocateFixed"
            :disabled="!locatableRequest"
            class="!px-2 !py-1"
            @click="locateCurrentRequest"
          />
          <tippy
            interactive
            trigger="click"
            theme="popover"
            placement="bottom-end"
            class="!flex-none"
          >
            <HoppButtonSecondary
              :title="t('layout.collapse_collection')"
              :aria-label="t('layout.collapse_collection')"
              :icon="IconListTree"
              :disabled="!filteredCollections.length"
              class="!px-2 !py-1"
            />
            <template #content="{ hide }">
              <div class="flex min-w-36 flex-col">
                <HoppSmartItem
                  :label="t('collection.expand_all')"
                  :icon="IconChevronsDown"
                  @click="setTreeExpansion(true, hide)"
                />
                <HoppSmartItem
                  :label="t('collection.collapse_all')"
                  :icon="IconChevronsUp"
                  @click="setTreeExpansion(false, hide)"
                />
              </div>
            </template>
          </tippy>
        </template>
        <HoppButtonSecondary
          v-if="filteredCollections && filteredCollections.length > 1"
          v-tippy="{ theme: 'tooltip' }"
          :title="t('action.sort')"
          :aria-label="t('action.sort')"
          :icon="IconArrowUpDown"
          class="!px-2 !py-1"
          @click="debouncedSorting"
        />
      </div>
    </div>
    <div ref="collectionTree" class="flex flex-1 flex-col">
      <HoppSmartTree v-if="folderExpansionReady" :adapter="myAdapter">
        <template
          #content="{ node, toggleChildren, isOpen, highlightChildren }"
        >
          <CollectionsCollection
            v-if="node.data.type === 'collections'"
            :id="node.id"
            v-tree-expansion="{
              command: expansionCommand,
              path: node.id,
              folderID: folderIdentity(node.data.data.data),
              savedOpen: savedFolderExpansion(node.data.data.data),
              isOpen,
              toggleChildren,
            }"
            :parent-i-d="node.data.data.parentIndex"
            :data="node.data.data.data"
            :collections-type="collectionsType.type"
            :is-open="isOpen"
            :is-last-item="node.data.isLastItem"
            :is-selected="
              isSelected({
                collectionIndex: parseInt(node.id),
              })
            "
            folder-type="collection"
            @add-request="
              node.data.type === 'collections' &&
              emit('add-request', {
                path: node.id,
                folder: node.data.data.data,
              })
            "
            @import-curl="
              !saveRequest &&
              node.data.type === 'collections' &&
              emit('import-curl', {
                path: node.id,
                folder: node.data.data.data,
              })
            "
            @add-gql-request="
              node.data.type === 'collections' &&
              emit('add-gql-request', {
                path: node.id,
                folder: node.data.data.data,
              })
            "
            @add-folder="
              node.data.type === 'collections' &&
              emit('add-folder', {
                path: node.id,
                folder: node.data.data.data,
              })
            "
            @run-collection="
              emit('run-collection', {
                collectionIndex: node.id,
                collection: node.data.data.data,
              })
            "
            @edit-collection="
              node.data.type === 'collections' &&
              emit('edit-collection', {
                collectionIndex: node.id,
                collection: node.data.data.data,
              })
            "
            @duplicate-collection="
              node.data.type === 'collections' &&
              emit('duplicate-collection', {
                pathOrID: node.id,
                collectionSyncID: node.data.data.data.id,
              })
            "
            @open-documentation="
              node.data.type === 'collections' &&
              emit('open-documentation', {
                pathOrID: node.id,
                collectionRefID: node.data.data.data._ref_id,
                collection: node.data.data.data,
              })
            "
            @edit-properties="
              node.data.type === 'collections' &&
              emit('edit-properties', {
                collectionIndex: node.id,
                collection: node.data.data.data,
              })
            "
            @export-data="
              node.data.type === 'collections' &&
              emit('export-data', node.data.data.data)
            "
            @remove-collection="emit('remove-collection', node.id)"
            @sort-collections="emit('sort-collections', $event)"
            @drop-event="dropEvent($event, node.id)"
            @drag-event="dragEvent($event, node.id)"
            @update-collection-order="
              updateCollectionOrder($event, {
                destinationCollectionIndex: node.id,
                destinationCollectionParentIndex: node.data.data.parentIndex,
              })
            "
            @update-last-collection-order="
              updateCollectionOrder($event, {
                destinationCollectionIndex: null,
                destinationCollectionParentIndex: node.data.data.parentIndex,
              })
            "
            @dragging="
              (isDraging: boolean) =>
                highlightChildren(isDraging ? node.id : null)
            "
            @toggle-children="
              () => {
                ;(toggleFolder(node.data.data.data, isOpen, toggleChildren),
                  saveRequest &&
                    emit('select', {
                      pickedType: 'my-collection',
                      collectionIndex: parseInt(node.id),
                    }))
              }
            "
          />
          <CollectionsCollection
            v-if="node.data.type === 'folders'"
            :id="node.id"
            v-tree-expansion="{
              command: expansionCommand,
              path: node.id,
              folderID: folderIdentity(node.data.data.data),
              savedOpen: savedFolderExpansion(node.data.data.data),
              isOpen,
              toggleChildren,
            }"
            :parent-i-d="node.data.data.parentIndex"
            :data="node.data.data.data"
            :collections-type="collectionsType.type"
            :is-open="isOpen"
            :is-last-item="node.data.isLastItem"
            :is-selected="
              isSelected({
                folderPath: node.id,
              })
            "
            folder-type="folder"
            @run-collection="
              emit('run-collection', {
                collectionIndex: node.id,
                collection: node.data.data.data,
              })
            "
            @add-request="
              node.data.type === 'folders' &&
              emit('add-request', {
                path: node.id,
                folder: node.data.data.data,
              })
            "
            @import-curl="
              !saveRequest &&
              node.data.type === 'folders' &&
              emit('import-curl', {
                path: node.id,
                folder: node.data.data.data,
              })
            "
            @add-gql-request="
              node.data.type === 'folders' &&
              emit('add-gql-request', {
                path: node.id,
                folder: node.data.data.data,
              })
            "
            @add-folder="
              node.data.type === 'folders' &&
              emit('add-folder', {
                path: node.id,
                folder: node.data.data.data,
              })
            "
            @edit-collection="
              node.data.type === 'folders' &&
              emit('edit-folder', {
                folderPath: node.id,
                folder: node.data.data.data,
              })
            "
            @duplicate-collection="
              node.data.type === 'folders' &&
              emit('duplicate-collection', {
                pathOrID: node.id,
                collectionSyncID: node.data.data.data.id,
              })
            "
            @open-documentation="
              node.data.type === 'folders' &&
              emit('open-documentation', {
                pathOrID: node.id,
                collectionRefID: node.data.data.data._ref_id,
                collection: node.data.data.data,
              })
            "
            @edit-properties="
              node.data.type === 'folders' &&
              emit('edit-properties', {
                collectionIndex: node.id,
                collection: node.data.data.data,
              })
            "
            @export-data="
              node.data.type === 'folders' &&
              emit('export-data', node.data.data.data)
            "
            @remove-collection="
              node.data.type === 'folders' && emit('remove-folder', node.id)
            "
            @sort-collections="
              node.data.type === 'folders' && emit('sort-collections', $event)
            "
            @drop-event="dropEvent($event, node.id)"
            @drag-event="dragEvent($event, node.id)"
            @update-collection-order="
              updateCollectionOrder($event, {
                destinationCollectionIndex: node.id,
                destinationCollectionParentIndex: node.data.data.parentIndex,
              })
            "
            @update-last-collection-order="
              updateCollectionOrder($event, {
                destinationCollectionIndex: null,
                destinationCollectionParentIndex: node.data.data.parentIndex,
              })
            "
            @dragging="
              (isDraging: boolean) =>
                highlightChildren(isDraging ? node.id : null)
            "
            @toggle-children="
              () => {
                ;(toggleFolder(node.data.data.data, isOpen, toggleChildren),
                  saveRequest &&
                    emit('select', {
                      pickedType: 'my-folder',
                      folderPath: node.id,
                    }))
              }
            "
          />
          <CollectionsRequest
            v-if="node.data.type === 'requests'"
            :data-collection-request-path="`${node.data.data.parentIndex}/${pathToIndex(node.id)}`"
            :request="node.data.data.data"
            :request-i-d="`${node.data.data.parentIndex}/${pathToIndex(node.id)}`"
            :parent-i-d="node.data.data.parentIndex"
            :collections-type="collectionsType.type"
            :save-request="saveRequest"
            :is-last-item="node.data.isLastItem"
            :is-active="
              isActiveRequest(
                node.data.data.parentIndex,
                node.data.data.data._ref_id ?? node.data.data.data.id ?? '',
                pathToIndex(node.id)
              )
            "
            :is-selected="
              isSelected({
                folderPath: node.data.data.parentIndex,
                requestIndex: parseInt(pathToIndex(node.id)),
              })
            "
            @edit-request="
              node.data.type === 'requests' &&
              emit('edit-request', {
                folderPath: node.data.data.parentIndex,
                requestIndex: pathToIndex(node.id),
                request: node.data.data.data,
              })
            "
            @edit-response="
              emit('edit-response', {
                folderPath: node.data.data.parentIndex,
                requestIndex: pathToIndex(node.id),
                request: node.data.data.data,
                responseName: $event.responseName,
                responseID: $event.responseID,
              })
            "
            @duplicate-request="
              node.data.type === 'requests' &&
              emit('duplicate-request', {
                folderPath: node.data.data.parentIndex,
                request: node.data.data.data,
              })
            "
            @open-request-documentation="
              node.data.type === 'requests' &&
              emit('open-request-documentation', {
                folderPath: node.data.data.parentIndex,
                requestIndex: pathToIndex(node.id),
                requestRefID: node.data.data.data._ref_id,
                request: node.data.data.data,
              })
            "
            @duplicate-response="
              emit('duplicate-response', {
                folderPath: node.data.data.parentIndex,
                requestIndex: pathToIndex(node.id),
                request: node.data.data.data,
                responseName: $event.responseName,
                responseID: $event.responseID,
              })
            "
            @remove-request="
              node.data.type === 'requests' &&
              emit('remove-request', {
                folderPath: node.data.data.parentIndex,
                requestIndex: pathToIndex(node.id),
              })
            "
            @remove-response="
              emit('remove-response', {
                folderPath: node.data.data.parentIndex,
                requestIndex: pathToIndex(node.id),
                request: node.data.data.data,
                responseName: $event.responseName,
                responseID: $event.responseID,
              })
            "
            @select-request="
              node.data.type === 'requests' &&
              selectRequest({
                request: node.data.data.data,
                folderPath: node.data.data.parentIndex,
                requestIndex: pathToIndex(node.id),
              })
            "
            @select-response="
              emit('select-response', {
                responseName: $event.responseName,
                responseID: $event.responseID,
                request: node.data.data.data,
                folderPath: node.data.data.parentIndex,
                requestIndex: pathToIndex(node.id),
              })
            "
            @share-request="
              node.data.type === 'requests' &&
              emit('share-request', {
                request: node.data.data.data,
              })
            "
            @add-example="
              node.data.type === 'requests' &&
              emit('add-example', {
                folderPath: node.data.data.parentIndex,
                request: node.data.data.data,
                requestIndex: pathToIndex(node.id),
              })
            "
            @drag-request="
              dragRequest($event, {
                folderPath: node.data.data.parentIndex,
                requestIndex: `${node.data.data.parentIndex}/${pathToIndex(node.id)}`,
                requestRefID:
                  node.data.data.data._ref_id ?? node.data.data.data.id ?? '',
              })
            "
            @update-request-order="
              updateRequestOrder($event, {
                folderPath: node.data.data.parentIndex,
                requestIndex: `${node.data.data.parentIndex}/${pathToIndex(node.id)}`,
              })
            "
            @update-last-request-order="
              updateRequestOrder($event, {
                folderPath: node.data.data.parentIndex,
                requestIndex: null,
              })
            "
          />
        </template>
        <template #emptyNode="{ node }">
          <HoppSmartPlaceholder
            v-if="filterText.length !== 0 && node === null"
            :text="`${t('state.nothing_found')} ‟${filterText}”`"
          >
            <template #icon>
              <icon-lucide-search class="svg-icons opacity-75" />
            </template>
          </HoppSmartPlaceholder>
          <HoppSmartPlaceholder
            v-else-if="node === null"
            :src="`/images/states/${colorMode.value}/pack.svg`"
            :alt="`${t('empty.collections')}`"
            :text="t('empty.collections')"
          >
            <template #body>
              <div class="flex flex-col items-center space-y-4">
                <CollectionsNewMenu
                  :folder-only="saveRequest"
                  @new-folder="emit('display-modal-add')"
                />
              </div>
            </template>
          </HoppSmartPlaceholder>
          <HoppSmartPlaceholder
            v-else-if="node.data.type === 'collections'"
            :src="`/images/states/${colorMode.value}/pack.svg`"
            :alt="`${t('empty.collections')}`"
            :text="t('empty.collections')"
          >
            <template #body>
              <HoppButtonSecondary
                :label="t('add.new')"
                filled
                outline
                @click="
                  node.data.type === 'collections' &&
                  emit('add-folder', {
                    path: node.id,
                    folder: node.data.data.data,
                  })
                "
              />
            </template>
          </HoppSmartPlaceholder>
          <HoppSmartPlaceholder
            v-else-if="node.data.type === 'folders'"
            :src="`/images/states/${colorMode.value}/pack.svg`"
            :alt="`${t('empty.folder')}`"
            :text="t('empty.folder')"
          />
        </template>
      </HoppSmartTree>
    </div>
  </div>
</template>

<script setup lang="ts">
import CollectionsNewMenu from "./NewMenu.vue"
import IconArrowUpDown from "~icons/lucide/arrow-up-down"
import IconChevronsDown from "~icons/lucide/chevrons-down"
import IconChevronsUp from "~icons/lucide/chevrons-up"
import IconListTree from "~icons/lucide/list-tree"
import IconLocateFixed from "~icons/lucide/locate-fixed"
import { HoppCollection, HoppRESTRequest, HoppGQLRequest, isGQLRequest } from "@apirequest/data"
import { computed, nextTick, type ObjectDirective, PropType, ref, Ref, shallowRef, toRef, watch } from "vue"
import { ChildrenResult, SmartTreeAdapter } from "@apirequest/ui/helpers"
import { useI18n } from "@composables/i18n"
import { useColorMode } from "@composables/theming"
import { useSetting } from "@composables/settings"
import { Picked } from "~/helpers/types/HoppPicked.js"
import { useService } from "dioc/vue"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import { useNativeFolderExpansion } from "~/composables/nativeFolderExpansion"
import { platform } from "~/platform"
import { useDebounceFn, useLocalStorage } from "@vueuse/core"
import {
  isRootRequestCollection,
  navigateToFolderWithIndexPath,
} from "~/newstore/collections"
import { CurrentSortValuesService } from "~/services/current-sort.service"

export type Collection = {
  type: "collections"
  isLastItem: boolean
  data: {
    parentIndex: null
    data: HoppCollection
  }
}

type Folder = {
  type: "folders"
  isLastItem: boolean
  data: {
    parentIndex: string
    data: HoppCollection
  }
}

type Requests = {
  type: "requests"
  isLastItem: boolean
  data: {
    parentIndex: string
    data: HoppRESTRequest | HoppGQLRequest
  }
}

const t = useI18n()
const colorMode = useColorMode()

type SelectedTeam = undefined

type CollectionType =
  | {
      type: "team-collections"
      selectedTeam: SelectedTeam
    }
  | { type: "my-collections"; selectedTeam: undefined }

const props = defineProps({
  filteredCollections: {
    type: Array as PropType<HoppCollection[]>,
    default: () => [],
    required: true,
  },
  allCollections: {
    type: Array as PropType<HoppCollection[]>,
    required: true,
  },
  collectionsType: {
    type: Object as PropType<CollectionType>,
    default: () => ({ type: "my-collections", selectedTeam: undefined }),
    required: true,
  },
  filterText: {
    type: String as PropType<string>,
    default: "",
    required: true,
  },
  saveRequest: {
    type: Boolean,
    default: false,
    required: false,
  },
  picked: {
    type: Object as PropType<Picked | null>,
    default: null,
    required: false,
  },
})

type ResponsePayload = {
  folderPath: string
  requestIndex: string
  request: HoppRESTRequest | HoppGQLRequest
  responseName: string
  responseID: string
}

const emit = defineEmits<{
  (event: "update:filter-text", value: string): void
  (event: "display-modal-add"): void
  (
    event: "import-curl",
    payload: { path: string; folder: HoppCollection }
  ): void
  (
    event: "add-request",
    payload: {
      path: string
      folder: HoppCollection
    }
  ): void
  (
    event: "add-gql-request",
    payload: {
      path: string
      folder: HoppCollection
    }
  ): void
  (
    event: "add-folder",
    payload: {
      path: string
      folder: HoppCollection
    }
  ): void
  (
    event: "run-collection",
    payload: {
      collectionIndex: string
      collection: HoppCollection
    }
  ): void
  (
    event: "edit-collection",
    payload: {
      collectionIndex: string
      collection: HoppCollection
    }
  ): void
  (
    event: "edit-folder",
    payload: {
      folderPath: string
      folder: HoppCollection
    }
  ): void
  (
    event: "duplicate-collection",
    payload: {
      pathOrID: string
      collectionSyncID?: string
    }
  ): void
  (
    event: "open-documentation",
    payload: {
      pathOrID: string
      collectionRefID: string
      collection: HoppCollection
    }
  ): void
  (
    event: "open-request-documentation",
    payload: {
      folderPath: string
      requestIndex: string
      requestRefID: string
      request: HoppRESTRequest | HoppGQLRequest
    }
  ): void
  (
    event: "edit-properties",
    payload: {
      collectionIndex: string
      collection: HoppCollection
    }
  ): void
  (
    event: "edit-request",
    payload: {
      folderPath: string
      requestIndex: string
      request: HoppRESTRequest | HoppGQLRequest
    }
  ): void
  (event: "edit-response", payload: ResponsePayload): void
  (
    event: "duplicate-request",
    payload: {
      folderPath: string
      request: HoppRESTRequest | HoppGQLRequest
    }
  ): void
  (event: "duplicate-response", payload: ResponsePayload): void
  (event: "export-data", payload: HoppCollection): void
  (event: "remove-collection", payload: string): void
  (event: "remove-folder", payload: string): void
  (
    event: "remove-request",
    payload: {
      folderPath: string | null
      requestIndex: string
    }
  ): void
  (event: "remove-response", payload: ResponsePayload): void
  (
    event: "select-request",
    payload: {
      request: HoppRESTRequest | HoppGQLRequest
      folderPath: string
      requestIndex: string
      isActive: boolean
    }
  ): void
  (
    event: "sort-collections",
    payload: {
      collectionID: string | null
      sortOrder: "asc" | "desc"
      collectionRefID: string
    }
  ): void
  (
    event: "share-request",
    payload: {
      request: HoppRESTRequest | HoppGQLRequest
    }
  ): void
  (
    event: "add-example",
    payload: {
      folderPath: string
      request: HoppRESTRequest | HoppGQLRequest
      requestIndex: number
    }
  ): void
  (
    event: "drop-request",
    payload: {
      folderPath: string
      requestIndex: string
      destinationCollectionIndex: string
      requestRefID?: string
    }
  ): void
  (
    event: "drop-collection",
    payload: {
      collectionIndexDragged: string
      destinationCollectionIndex: string
    }
  ): void
  (
    event: "update-request-order",
    payload: {
      dragedRequestIndex: string
      destinationRequestIndex: string | null
      destinationCollectionIndex: string
    }
  ): void
  (
    event: "update-collection-order",
    payload: {
      dragedCollectionIndex: string
      destinationCollection: {
        destinationCollectionIndex: string | null
        destinationCollectionParentIndex: string | null
      }
    }
  ): void
  (event: "select", payload: Picked | null): void
  (event: "select-response", payload: ResponsePayload): void

}>()

const refFilterCollection = toRef(props, "filteredCollections")

const currentSortValuesService = useService(CurrentSortValuesService)

const currentSortOrder = ref<"asc" | "desc">(
  currentSortValuesService.getSortOption("personal")?.sortOrder ?? "asc"
)

const pathToIndex = (path: string) => {
  const pathArr = path.split("/")
  return pathArr[pathArr.length - 1]
}

const isSelected = ({
  collectionIndex,
  folderPath,
  requestIndex,
}: {
  collectionIndex?: number | undefined
  folderPath?: string | undefined
  requestIndex?: number | undefined
}) => {
  if (collectionIndex !== undefined) {
    return (
      props.picked &&
      props.picked.pickedType === "my-collection" &&
      props.picked.collectionIndex === collectionIndex
    )
  } else if (requestIndex !== undefined && folderPath !== undefined) {
    return (
      props.picked &&
      props.picked.pickedType === "my-request" &&
      props.picked.folderPath === folderPath &&
      props.picked.requestIndex === requestIndex
    )
  }
  return (
    props.picked &&
    props.picked.pickedType === "my-folder" &&
    props.picked.folderPath === folderPath
  )
}

const tabs = useService(WorkspaceTabsService)
const active = computed(() => {
  const doc = tabs.currentActiveTab.value?.document
  return doc && doc.type !== "test-runner" ? doc.saveContext : undefined
})

const locatableRequest = computed(() => {
  const context = active.value
  return context &&
    context.originLocation === "user-collection" &&
    (context.requestRefID || context.requestIndex !== undefined)
    ? context
    : null
})

type ExpansionCommand = { open: boolean; paths?: Set<string> }
type TreeExpansion = {
  command: ExpansionCommand | null
  path: string
  folderID?: string
  savedOpen?: boolean
  isOpen: boolean
  toggleChildren: () => void
}

const expansionCommand = shallowRef<ExpansionCommand | null>(null)
const collectionTree = ref<HTMLElement | null>(null)
const sidebarVisible = useSetting("SIDEBAR")
const nativeExpansion = platform.localDesktop
  ? useNativeFolderExpansion()
  : undefined
const folderExpansionReady = computed(
  () => nativeExpansion?.loaded.value ?? true
)
const folderExpansion =
  nativeExpansion?.expansion ??
  useLocalStorage<Record<string, boolean>>(
    "hopp-personal-collection-expansion",
    {},
    { flush: "sync" }
  )

function folderIdentity(folder: HoppCollection) {
  return folder.id ?? folder._ref_id
}

function toggleFolder(
  folder: HoppCollection,
  isOpen: boolean,
  toggleChildren: () => void
) {
  const id = folderIdentity(folder)
  // 用户点击时直接保存意图，目录重绘或重新挂载后仍能恢复。
  if (!props.saveRequest && id) {
    folderExpansion.value = { ...folderExpansion.value, [id]: !isOpen }
  }
  toggleChildren()
}

function savedFolderExpansion(folder: HoppCollection) {
  const id = folderIdentity(folder)
  if (props.saveRequest || !id) return
  // 本地创建的目录可能在第一次点击之后才收到服务端 ID。
  return (
    folderExpansion.value[id] ??
    (folder._ref_id ? folderExpansion.value[folder._ref_id] : undefined)
  )
}

async function runTreeExpansion(command: ExpansionCommand) {
  if (!props.saveRequest) {
    const saved = { ...folderExpansion.value }
    const remember = (folders: HoppCollection[], parent = "") => {
      folders.forEach((folder, index) => {
        const path = parent ? `${parent}/${index}` : String(index)
        if (command.paths && !command.paths.has(path)) return
        if (isRootRequestCollection(folder)) return
        const id = folderIdentity(folder)
        if (id) saved[id] = command.open
        remember(folder.folders, path)
      })
    }
    remember(props.filteredCollections)
    folderExpansion.value = saved
  }
  expansionCommand.value = command
  await nextTick()
  if (expansionCommand.value === command) expansionCommand.value = null
}

function setTreeExpansion(open: boolean, hide: () => void) {
  hide()
  void runTreeExpansion({ open })
}

function applyTreeExpansion(
  { command, path, savedOpen, isOpen, toggleChildren }: TreeExpansion,
  identityChanged = false
) {
  const target =
    command && (!command.paths || command.paths.has(path))
      ? command.open
      : (savedOpen ?? (identityChanged ? false : undefined))
  if (target !== undefined && target !== isOpen) toggleChildren()
}

// 树按索引复用行。仅在挂载、换到另一目录或执行展开命令时恢复状态。
const vTreeExpansion: ObjectDirective<HTMLElement, TreeExpansion> = {
  mounted(_element, { value }) {
    applyTreeExpansion(value)
  },
  updated(_element, { value, oldValue }) {
    const identityChanged = value.folderID !== oldValue?.folderID
    if (
      identityChanged ||
      (value.command && value.command !== oldValue?.command)
    ) {
      applyTreeExpansion(value, identityChanged && !props.saveRequest)
    }
  },
}

function findRequestPath(
  collections: HoppCollection[],
  requestRefID: string,
  parent = ""
): string | undefined {
  for (const [index, collection] of collections.entries()) {
    const path = parent ? `${parent}/${index}` : String(index)
    const requestIndex = collection.requests.findIndex(
      (request) => (request._ref_id ?? request.id) === requestRefID
    )
    if (requestIndex !== -1) return `${path}/${requestIndex}`
    const nested = findRequestPath(collection.folders, requestRefID, path)
    if (nested) return nested
  }
}

const currentRequestPath = computed(() => {
  const context = locatableRequest.value
  if (!context || props.filterText) return
  return context.requestRefID
    ? findRequestPath(props.filteredCollections, context.requestRefID)
    : `${context.folderPath}/${context.requestIndex}`
})

function requestAncestorPaths(requestPath: string) {
  const parts = requestPath.split("/")
  return parts
    .slice(0, -1)
    .map((_, index) => parts.slice(0, index + 1).join("/"))
}

async function revealRequest(requestPath: string, paths: string[]) {
  await runTreeExpansion({ open: true, paths: new Set(paths) })
  if (requestPath !== currentRequestPath.value || !sidebarVisible.value) return
  collectionTree.value
    ?.querySelector(`[data-collection-request-path="${requestPath}"]`)
    ?.scrollIntoView({ block: "nearest", inline: "nearest" })
}

async function locateCurrentRequest() {
  if (!locatableRequest.value) return

  // 搜索结果的索引可能与原目录不同，恢复完整树后用请求引用查找。
  if (props.filterText) {
    emit("update:filter-text", "")
    await nextTick()
  }
  const requestPath = currentRequestPath.value
  if (!requestPath) return
  await revealRequest(requestPath, requestAncestorPaths(requestPath))
}

watch(
  [currentRequestPath, sidebarVisible],
  ([path, visible]) => {
    if (props.saveRequest || !visible || !path) return
    const paths = requestAncestorPaths(path)
    let folders = props.filteredCollections
    for (const index of path.split("/").slice(0, -1)) {
      const folder = folders[Number(index)]
      // 恢复位置时尊重手动折叠；仍可用“定位当前请求”主动打开这条路径。
      if (!folder || savedFolderExpansion(folder) === false) return
      folders = folder.folders
    }
    void revealRequest(path, paths)
  },
  { immediate: true, flush: "post" }
)

const isActiveRequest = (
  folderPath: string,
  requestRefID: string,
  requestIndex: string
) => {
  const context = locatableRequest.value
  return (
    !!context &&
    context.exampleID === undefined &&
    (context.requestRefID
      ? context.requestRefID === requestRefID
      : context.folderPath === folderPath &&
        context.requestIndex === Number(requestIndex))
  )
}

const selectRequest = (data: {
  request: HoppRESTRequest | HoppGQLRequest
  folderPath: string
  requestIndex: string
}) => {
  const { request, folderPath, requestIndex } = data

  if (props.saveRequest) {
    emit("select", {
      pickedType: "my-request",
      folderPath: folderPath,
      requestIndex: parseInt(requestIndex),
    })
  } else {
    emit("select-request", {
      request,
      folderPath,
      requestIndex,
      isActive: isActiveRequest(
        folderPath,
        request._ref_id ?? request.id ?? "",
        requestIndex
      ),
    })
  }
}

const dragEvent = (dataTransfer: DataTransfer, collectionIndex: string) => {
  dataTransfer.setData("collectionIndex", collectionIndex)
}

const dragRequest = (
  dataTransfer: DataTransfer,
  {
    folderPath,
    requestIndex,
    requestRefID,
  }: { folderPath: string | null; requestIndex: string; requestRefID?: string }
) => {
  if (!folderPath) return
  dataTransfer.setData("folderPath", folderPath)
  dataTransfer.setData("requestIndex", requestIndex)
  if (requestRefID) dataTransfer.setData("requestRefID", requestRefID)
}

const dropEvent = (
  dataTransfer: DataTransfer,
  destinationCollectionIndex: string
) => {
  const folderPath = dataTransfer.getData("folderPath")
  const requestIndex = dataTransfer.getData("requestIndex")
  const collectionIndexDragged = dataTransfer.getData("collectionIndex")
  const requestRefID = dataTransfer.getData("requestRefID")

  if (folderPath && requestIndex) {
    emit("drop-request", {
      folderPath,
      requestIndex,
      destinationCollectionIndex,
      requestRefID,
    })
  } else {
    emit("drop-collection", {
      collectionIndexDragged,
      destinationCollectionIndex,
    })
  }
}

const updateRequestOrder = (
  dataTransfer: DataTransfer,
  {
    folderPath,
    requestIndex,
  }: { folderPath: string | null; requestIndex: string | null }
) => {
  if (!folderPath) return
  const dragedRequestIndex = dataTransfer.getData("requestIndex")
  const destinationRequestIndex = requestIndex
  const destinationCollectionIndex = folderPath

  emit("update-request-order", {
    dragedRequestIndex,
    destinationRequestIndex,
    destinationCollectionIndex,
  })
}

const updateCollectionOrder = (
  dataTransfer: DataTransfer,
  destinationCollection: {
    destinationCollectionIndex: string | null
    destinationCollectionParentIndex: string | null
  }
) => {
  const dragedCollectionIndex = dataTransfer.getData("collectionIndex")

  emit("update-collection-order", {
    dragedCollectionIndex,
    destinationCollection,
  })
}

const debouncedSorting = useDebounceFn(() => {
  currentSortOrder.value = currentSortOrder.value === "asc" ? "desc" : "asc"
  emit("sort-collections", {
    collectionID: null,
    sortOrder: currentSortOrder.value,
    collectionRefID: "personal",
  })
}, 250)

type MyCollectionNode = Collection | Folder | Requests

class MyCollectionsAdapter implements SmartTreeAdapter<MyCollectionNode> {
  constructor(
    public data: Ref<HoppCollection[]>,
    public allCollections: Ref<HoppCollection[]>,
    public filterText: Ref<string>
  ) {}

  getChildren(
    id: string | null,
    type?: string
  ): Ref<ChildrenResult<MyCollectionNode>> {
    return computed(() => {
      // 树会自动展开唯一的根节点；请求是叶子，不能把请求 ID 当作目录路径。
      if (type === "requests") return { status: "loaded", data: [] }
      if (id === null) {
        const folders = this.data.value.flatMap((item, index) =>
          isRootRequestCollection(item)
            ? []
            : [
                {
                  id: String(index),
                  data: {
                    type: "collections" as const,
                    isLastItem: index === this.data.value.length - 1,
                    data: { parentIndex: null, data: item },
                  },
                },
              ]
        )
        const filter = this.filterText.value.toLowerCase()
        // 根请求直接用原树的索引，即使搜索过滤了前面的集合或请求也能修改正确的记录。
        const requests = this.allCollections.value.flatMap(
          (collection, index) => {
            if (!isRootRequestCollection(collection)) return []
            return collection.requests.flatMap((request, requestIndex) => {
              const url = isGQLRequest(request) ? request.url : request.endpoint
              if (
                !request.name.toLowerCase().includes(filter) &&
                !url.toLowerCase().includes(filter)
              )
                return []
              return [
                {
                  id: `root-${index}/${requestIndex}`,
                  data: {
                    type: "requests" as const,
                    isLastItem: requestIndex === collection.requests.length - 1,
                    data: { parentIndex: String(index), data: request },
                  },
                },
              ]
            })
          }
        )
        return { status: "loaded", data: [...folders, ...requests] }
      }

      const indexPath = id.split("/").map((x) => parseInt(x))

      const item = navigateToFolderWithIndexPath(this.data.value, indexPath)

      if (item) {
        const data = [
          ...item.folders.map((folder, index) => ({
            id: `${id}/${index}`,
            data: {
              isLastItem:
                item.folders && item.folders.length > 1
                  ? index === item.folders.length - 1
                  : false,
              type: "folders",
              data: {
                parentIndex: id,
                data: folder,
              },
            },
          })),
          ...item.requests.map((requests, index) => ({
            id: `${id}/${index}`,
            data: {
              isLastItem:
                item.requests && item.requests.length > 1
                  ? index === item.requests.length - 1
                  : false,
              type: "requests",
              data: {
                parentIndex: id,
                data: requests,
              },
            },
          })),
        ]

        return {
          status: "loaded",
          data: data,
        } as ChildrenResult<Folder | Requests>
      }
      return {
        status: "loaded",
        data: [],
      }
    })
  }
}

const myAdapter: SmartTreeAdapter<MyCollectionNode> = new MyCollectionsAdapter(
  refFilterCollection,
  toRef(props, "allCollections"),
  toRef(props, "filterText")
)
</script>
