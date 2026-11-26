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
      <p v-if="locateError" role="status" class="px-2 text-tiny text-secondaryLight">
        {{ locateError }}
      </p>
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
            :disabled="!locatableRequest || locatingRequest"
            class="!px-2 !py-1"
            @click="locateCurrentRequest(false)"
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
      <div v-if="usesLazyRemoteCollections() && filterText.trim()" class="flex flex-col">
        <button v-for="match in searchMatches" :key="match.id" type="button"
          class="truncate px-4 py-2 text-left text-secondaryLight hover:text-secondary"
          :disabled="openingMatch === match.id"
          @click="void openSearchMatch(match).catch(console.error)">
          {{ openingMatch === match.id ? '加载中…' : `${match.method ?? ''} ${match.title}`.trim() }}
        </button>
        <span v-if="searchError" class="px-4 py-2 text-tiny text-red-400">{{ searchError }}</span>
      </div>
      <HoppSmartTree v-if="folderExpansionReady" :adapter="myAdapter"
        :class="{ 'lazy-single-root-tree': lazySingleRoot }">
        <template
          #content="{ node, toggleChildren, isOpen, highlightChildren }"
        >
          <CollectionsCollection
            v-if="node.data.type === 'collections'"
            :data-collection-folder-path="node.id"
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
            :data-collection-folder-path="node.id"
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
          <button
            v-if="node.data.type === 'loadMore'"
            type="button"
            class="px-4 py-2 text-left text-secondaryLight hover:text-secondary"
            :disabled="remoteFolderLoading.has(node.data.collectionID)"
            @click="void retryRemoteFolder(node.data.collectionID).catch(console.error)"
          >
            {{ remoteFolderLoading.has(node.data.collectionID) ? '加载中…' : remoteFolderErrors.has(node.data.collectionID) ? '加载失败，点击重试' : '加载更多接口' }}
          </button>
          <CollectionsRequest
            v-if="node.data.type === 'requests' && node.id !== LAZY_ROOT_ANCHOR"
            :partial-folder="isUnloadedFolder(node.data.data.parentIndex)"
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
                node.data.data.data,
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
import { matchesCollectionRequest } from "~/helpers/local-workspace/collections"
import type { HoppTabSaveContext } from "~/helpers/tab/document"
import IconArrowUpDown from "~icons/lucide/arrow-up-down"
import IconChevronsDown from "~icons/lucide/chevrons-down"
import IconChevronsUp from "~icons/lucide/chevrons-up"
import IconListTree from "~icons/lucide/list-tree"
import IconLocateFixed from "~icons/lucide/locate-fixed"
import { HoppCollection, HoppRESTRequest, HoppGQLRequest, isGQLRequest } from "@apirequest/data"
import { computed, nextTick, type ObjectDirective, PropType, ref, Ref, shallowRef, toRef, watch } from "vue"
import { ChildrenResult, SmartTreeAdapter } from "@apirequest/ui/helpers"
import { ensureRemoteRequestLocation, ensureRemoteFolder, isRemoteFolderLoaded, remoteFolderErrors, remoteFolderHasMore, remoteFolderLoading, retryRemoteFolder, remoteRequestLocation, searchRemoteRequests, usesLazyRemoteCollections, type RemoteCollectionIndex } from "~/helpers/remote-collections"
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
  cascadeParentCollectionForProperties,
  isRootRequestCollection,
  navigateToFolderWithIndexPath,
  restCollectionStore,
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

const LAZY_ROOT_ANCHOR = "__lazy_root_anchor__"

type LoadMore = { type: "loadMore"; collectionID: string }

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

const locatableRequest = computed<HoppTabSaveContext>(() => {
  const context = active.value
  if (context &&
    context.originLocation === "user-collection" &&
    (context.requestRefID || context.requestIndex !== undefined)) return context
  const doc = tabs.currentActiveTab.value?.document
  // Earlier lazy snapshots could clear saveContext. Recover only database-backed
  // request tabs; the loader verifies their original reference before attaching.
  if (context === undefined && doc &&
    (doc.type === "request" || doc.type === "gql-request") && doc.request.id) {
    return { originLocation: "user-collection" as const, folderPath: "",
      requestRefID: doc.request._ref_id || doc.request.id }
  }
  return null
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
  if (!isOpen && id && usesLazyRemoteCollections())
    void ensureRemoteFolder(id).catch(console.error)
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
  { command, path, folderID, savedOpen, isOpen, toggleChildren }: TreeExpansion,
  identityChanged = false
) {
  const target =
    command && (!command.paths || command.paths.has(path))
      ? command.open
      : (savedOpen ?? (identityChanged ? false : undefined))
  if (target !== undefined && target !== isOpen) {
    if (target && folderID && usesLazyRemoteCollections())
      void ensureRemoteFolder(folderID).catch(console.error)
    toggleChildren()
  }
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
  identity: { id?: string; _ref_id?: string },
  parent = ""
): string | undefined {
  for (const [index, collection] of collections.entries()) {
    const path = parent ? `${parent}/${index}` : String(index)
    const requestIndex = collection.requests.findIndex(
      (request) => matchesCollectionRequest(identity, request)
    )
    if (requestIndex !== -1) return `${path}/${requestIndex}`
    const nested = findRequestPath(collection.folders, identity, path)
    if (nested) return nested
  }
}

const currentRequestIdentity = computed(() => {
  const doc = tabs.currentActiveTab.value?.document
  const request = doc && doc.type !== "websocket" && "request" in doc ? doc.request : undefined
  return {
    id: request?.id,
    _ref_id: locatableRequest.value?.requestRefID || request?._ref_id,
  }
})

const currentRequestPath = computed(() => {
  const context = locatableRequest.value
  if (!context || !active.value || props.filterText) return
  const identity = currentRequestIdentity.value
  if (identity.id || identity._ref_id)
    return findRequestPath(props.filteredCollections, identity)
  return `${context.folderPath}/${context.requestIndex}`
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

const locatingRequest = ref(false)
const locateError = ref("")

function canRestoreFolder(folderPath: string) {
  let folders = props.filteredCollections
  for (const index of folderPath.split("/")) {
    const folder = folders[Number(index)]
    if (!folder || savedFolderExpansion(folder) === false) return false
    folders = folder.folders
  }
  return true
}

async function locateCurrentRequest(automatic = false) {
  const context = locatableRequest.value
  if (!context || locatingRequest.value || props.saveRequest) return
  if (automatic && (!sidebarVisible.value || props.filterText)) return
  const tabID = tabs.currentActiveTab.value?.id
  const stillCurrent = () => tabs.currentActiveTab.value?.id === tabID &&
    !!locatableRequest.value && sidebarVisible.value && !props.filterText
  locatingRequest.value = true
  locateError.value = ""
  try {
    // Search results use different positional paths; restore the full tree first.
    if (props.filterText) {
      emit("update:filter-text", "")
      await nextTick()
    }
    if (!currentRequestPath.value && usesLazyRemoteCollections()) {
      const recovering = active.value === undefined
      const location = await ensureRemoteRequestLocation(currentRequestIdentity.value, {
        folderPath: context.folderPath,
        canLoad: (path) => stillCurrent() && (!automatic || canRestoreFolder(path)),
        recoverDetached: recovering,
      })
      const doc = tabs.currentActiveTab.value?.document
      if (recovering && location && stillCurrent() && doc &&
        (doc.type === "request" || doc.type === "gql-request") && doc.saveContext === undefined) {
        doc.saveContext = { originLocation: "user-collection", ...location,
          requestRefID: doc.request._ref_id || doc.request.id }
        doc.inheritedProperties = cascadeParentCollectionForProperties(
          location.folderPath, doc.type === "request" ? "rest" : "graphql")
      }
      await nextTick()
    }
    const path = currentRequestPath.value
    if (!path || !stillCurrent()) {
      if (!automatic && stillCurrent()) locateError.value = "未找到当前接口，请确认接口是否已被删除。"
      return
    }
    const folderPath = path.split("/").slice(0, -1).join("/")
    // Automatic restoration respects deliberate collapses, even during loading.
    if (automatic && !canRestoreFolder(folderPath)) return
    // Ancestors must have their first page before SmartTree renders children.
    // Do not advance pagination in ancestors which already have a visible page.
    if (usesLazyRemoteCollections()) {
      let folders = props.filteredCollections
      const ids: string[] = []
      for (const part of folderPath.split("/")) {
        const folder = folders[Number(part)]
        if (!folder) return
        if (folder.id) ids.push(folder.id)
        folders = folder.folders
      }
      for (const id of ids) {
        if (!stillCurrent() || (automatic && !canRestoreFolder(folderPath))) return
        if (!isRemoteFolderLoaded(id) && !remoteFolderHasMore(id))
          await ensureRemoteFolder(id)
      }
      await nextTick()
    }
    const readyPath = currentRequestPath.value
    if (!readyPath || !stillCurrent()) return
    if (automatic && !canRestoreFolder(readyPath.split("/").slice(0, -1).join("/"))) return
    await revealRequest(readyPath, requestAncestorPaths(readyPath))
  } catch (error) {
    console.error("定位当前接口失败", error)
    if (stillCurrent()) locateError.value = "定位失败，请点击定位按钮重试。"
  } finally {
    locatingRequest.value = false
    if (tabs.currentActiveTab.value?.id !== tabID)
      void locateCurrentRequest(true)
  }
}

watch(
  [currentRequestPath, locatableRequest, sidebarVisible,
    () => tabs.currentActiveTab.value?.id, () => props.filteredCollections],
  () => { void locateCurrentRequest(true) },
  { immediate: true, flush: "post" }
)

const isActiveRequest = (
  folderPath: string,
  request: Pick<HoppRESTRequest, "id" | "_ref_id">,
  requestIndex: string
) => {
  const context = locatableRequest.value
  const identity = currentRequestIdentity.value
  return (
    !props.saveRequest &&
    !!active.value &&
    !!context &&
    context.exampleID === undefined &&
    (identity.id || identity._ref_id
      ? matchesCollectionRequest(identity, request)
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
        request,
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

type MyCollectionNode = Collection | Folder | Requests | LoadMore

function isUnloadedFolder(path: string): boolean {
  const folder = navigateToFolderWithIndexPath(props.filteredCollections, path.split("/").map(Number))
  return (folder as HoppCollection & { __workbenchUnloaded?: boolean } | undefined)?.__workbenchUnloaded === true
}

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
      if (type === "requests" || type === "loadMore") return { status: "loaded", data: [] }
      if (id === null) {
        const lazy = usesLazyRemoteCollections()
        const folders = this.data.value.flatMap((item, index) =>
          (isRootRequestCollection(item) && !lazy)
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
            if (lazy || !isRootRequestCollection(collection)) return []
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
        const nodes = [...folders, ...requests]
        // SmartTree expands its only root automatically. An invisible second root
        // keeps a large collection collapsed until the user opens it.
        if (lazy && nodes.length === 1)
          nodes.push({
            id: LAZY_ROOT_ANCHOR,
            data: { type: "requests", isLastItem: false,
              data: { parentIndex: "", data: {} as HoppRESTRequest } },
          })
        return { status: "loaded", data: nodes }
      }

      const indexPath = id.split("/").map((x) => parseInt(x))

      const item = navigateToFolderWithIndexPath(this.data.value, indexPath)

      if (item) {
        if (item.id && usesLazyRemoteCollections() && !isRemoteFolderLoaded(item.id)) {
          if (remoteFolderErrors.has(item.id) && !remoteFolderHasMore(item.id))
            return { status: "loaded", data: [] }
          if (!remoteFolderHasMore(item.id)) {
            return { status: "loading" }
          }
        }
        const data: Array<{ id: string; data: MyCollectionNode }> = [
          ...item.folders.map((folder, index) => ({
            id: `${id}/${index}`,
            data: {
              isLastItem:
                item.folders && item.folders.length > 1
                  ? index === item.folders.length - 1
                  : false,
              type: "folders" as const,
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
              type: "requests" as const,
              data: {
                parentIndex: id,
                data: requests,
              },
            },
          })),
        ]

        if (item.id && remoteFolderHasMore(item.id))
          data.push({ id: `${id}/more`, data: { type: "loadMore", collectionID: item.id } })
        return {
          status: "loaded",
          data,
        } as ChildrenResult<MyCollectionNode>
      }
      return {
        status: "loaded",
        data: [],
      }
    })
  }
}

const searchMatches = ref<RemoteCollectionIndex["requests"]>([])
const openingMatch = ref<string | null>(null)
const searchError = ref("")
let searchGeneration = 0
watch(() => props.filterText, async (text) => {
  const generation = ++searchGeneration
  searchMatches.value = []
  searchError.value = ""
  if (!text.trim() || !usesLazyRemoteCollections()) return
  await new Promise((resolve) => setTimeout(resolve, 180))
  if (generation !== searchGeneration) return
  try {
    const matches = await searchRemoteRequests(text)
    if (generation === searchGeneration) searchMatches.value = matches
  } catch (error) {
    if (generation === searchGeneration) searchError.value = "搜索失败，请重新输入关键词"
    console.error("接口搜索失败", error)
  }
})

async function openSearchMatch(row: RemoteCollectionIndex["requests"][number]) {
  if (openingMatch.value) return
  openingMatch.value = row.id
  searchError.value = ""
  try {
    let location = remoteRequestLocation({ id: row.id } as HoppRESTRequest)
    while (!location && !isRemoteFolderLoaded(row.collectionID)) {
      await ensureRemoteFolder(row.collectionID)
      location = remoteRequestLocation({ id: row.id } as HoppRESTRequest)
    }
    if (!location) throw new Error("接口位置已变化，请重新搜索")
    const folder = navigateToFolderWithIndexPath(restCollectionStore.value.state,
      location.folderPath.split("/").map(Number))
    const request = folder?.requests[location.requestIndex]
    if (!request || request.id !== row.id) throw new Error("接口位置已变化，请重新搜索")
    selectRequest({ request, folderPath: location.folderPath,
      requestIndex: String(location.requestIndex) })
  } catch (error) {
    searchError.value = error instanceof Error ? error.message : "接口加载失败，请重试"
  } finally { openingMatch.value = null }
}

const lazySingleRoot = computed(() =>
  usesLazyRemoteCollections() && props.filteredCollections.length === 1)

const myAdapter: SmartTreeAdapter<MyCollectionNode> = new MyCollectionsAdapter(
  refFilterCollection,
  toRef(props, "allCollections"),
  toRef(props, "filterText")
)
</script>

<style scoped>
/* The second root only controls SmartTree's automatic expansion. */
:deep(.lazy-single-root-tree > div > div:last-child) { display: none; }
</style>
