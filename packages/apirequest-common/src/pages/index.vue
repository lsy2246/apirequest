<template>
  <div>
    <AppPaneLayout layout-id="http">
      <template #primary>
        <HoppSmartWindows
          v-if="currentTabID"
          class="request-windows"
          :id="'rest_windows'"
          v-model="currentTabID"
          :render-inactive-tabs="
            activeTabs.some((tab) => tab.document.type === 'websocket')
          "
          @remove-tab="removeTab"
          @add-tab="addNewTab"
          @sort="sortTabs"
        >
          <HoppSmartWindow
            v-for="tab in activeTabs"
            :id="tab.id"
            :key="tab.id"
            :label="getTabName(tab)"
            :is-removable="true"
            :close-visibility="'always'"
          >
            <template #tabhead>
              <HttpTabHead
                v-if="
                  tab.document.type === 'request' ||
                  tab.document.type === 'example-response'
                "
                :tab="tab"
                :is-removable="true"
                @open-rename-modal="openReqRenameModal(tab.id)"
                @close-tab="removeTab(tab.id)"
                @close-other-tabs="closeOtherTabsAction(tab.id)"
                @duplicate-tab="duplicateTab(tab.id)"
                @share-tab-request="shareTabRequest(tab.id)"
              />
              <GqlTabHead
                v-else-if="
                  tab.document.type === 'gql-request' ||
                  tab.document.type === 'gql-example-response'
                "
                :tab="tab"
                :is-removable="true"
                @open-rename-modal="openReqRenameModal(tab.id)"
                @close-tab="removeTab(tab.id)"
                @close-other-tabs="closeOtherTabsAction(tab.id)"
                @duplicate-tab="duplicateTab(tab.id)"
                @share-tab-request="shareTabRequest(tab.id)"
              />
              <span
                v-else-if="tab.document.type === 'websocket'"
                class="flex items-center gap-2 truncate px-2"
              >
                <IconWebsocket class="h-4 w-4 shrink-0 text-accent" />
                <span class="truncate">{{ getTabName(tab) }}</span>
              </span>
              <!-- Fallback for document types without a dedicated head
                   (test-runner) — providing the #tabhead slot suppresses the
                   Window's own `label`, so an unmatched type would otherwise
                   render a blank tab head. -->
              <span v-else class="flex items-center truncate px-2">
                <span class="truncate">{{ getTabName(tab) }}</span>
              </span>
            </template>
            <template #suffix>
              <span
                v-if="tab.document.isDirty"
                class="flex w-4 items-center justify-center text-secondary group-hover:hidden"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="1.2em"
                  height="1.2em"
                  class="h-1.5 w-1.5"
                >
                  <circle cx="12" cy="12" r="12" fill="currentColor"></circle>
                </svg>
              </span>
            </template>
            <HttpProtocolSwitcher
              v-if="
                tab.id === currentTabID &&
                (tab.document.type === 'websocket' ||
                  (isGqlWorkspaceEnabled &&
                    (tab.document.type === 'request' ||
                      tab.document.type === 'gql-request')))
              "
            />
            <WebSocketEditor
              v-if="tab.document.type === 'websocket'"
              v-model="tab.document.request"
              :active="tab.id === currentTabID"
            />
            <template v-else-if="tab.id === currentTabID">
              <HttpExampleResponseTab
                v-if="
                  tab.document.type === 'example-response' &&
                  tab.document.response
                "
                :model-value="tab"
                @update:model-value="onTabUpdate"
              />
              <GqlExampleResponseTab
                v-if="
                  tab.document.type === 'gql-example-response' &&
                  tab.document.response
                "
                :model-value="tab"
                @update:model-value="onTabUpdate"
              />
              <!-- Render TabContents -->
              <!-- When document.type === 'request' the tab type is HoppTab<HoppRequestDocument>-->
              <HttpRequestTab
                v-if="tab.document.type === 'request'"
                :model-value="tab"
                @update:model-value="onTabUpdate"
              />
              <!-- When document.type === 'gql-request' render GQL tab -->
              <GqlRequestTab
                v-if="tab.document.type === 'gql-request'"
                :model-value="tab"
                @update:model-value="onTabUpdate"
              />
              <!-- END Render TabContents -->
            </template>
          </HoppSmartWindow>
          <template #actions>
            <div class="request-tab-actions flex h-full shrink-0">
              <AppRequestLayoutToggle />
              <AppCollectionSidebarToggle />
              <EnvironmentsSelector class="w-[4.5rem] flex-none md:w-56" />
            </div>
          </template>
        </HoppSmartWindows>
        <div
          v-else
          class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
          data-testid="empty-request-workspace"
        >
          <h2 class="text-lg font-semibold text-secondaryDark">
            {{ t("workbench.no_open_requests") }}
          </h2>
          <p class="text-secondaryLight">
            {{ t("workbench.open_request_hint") }}
          </p>
          <HoppButtonPrimary
            :icon="IconPlus"
            :label="t('workbench.new_request')"
            :aria-label="t('workbench.new_request')"
            @click="addNewTab"
          />
        </div>
      </template>
      <template #sidebar>
        <HttpSidebar />
      </template>
    </AppPaneLayout>
    <CollectionsEditRequest
      v-model="reqName"
      :request-context="requestToRename"
      :show="showRenamingReqNameModal"
      @submit="renameReqName"
      @hide-modal="showRenamingReqNameModal = false"
    />
    <HoppSmartConfirmModal
      :show="confirmingCloseAllTabs"
      :confirm="t('modal.close_unsaved_tab')"
      :title="t('confirm.close_unsaved_tabs', { count: unsavedTabsCount })"
      @hide-modal="confirmingCloseAllTabs = false"
      @resolve="onResolveConfirmCloseAllTabs"
    />
    <HoppSmartModal
      v-if="confirmingCloseForTabID !== null"
      dialog
      role="dialog"
      aria-modal="true"
      :title="t('modal.close_unsaved_tab')"
      @close="confirmingCloseForTabID = null"
    >
      <template #body>
        <div class="text-center">
          {{ t("confirm.save_unsaved_tab") }}
        </div>
      </template>
      <template #footer>
        <span class="flex space-x-2">
          <HoppButtonPrimary
            v-focus
            :label="t?.('action.yes')"
            outline
            @click="onResolveConfirmSaveTab"
          />
          <HoppButtonSecondary
            :label="t?.('action.no')"
            filled
            outline
            @click="onCloseConfirmSaveTab"
          />
        </span>
      </template>
    </HoppSmartModal>
    <CollectionsSaveRequest
      v-if="savingRequest"
      :mode="saveRequestMode"
      :show="savingRequest"
      @hide-modal="onSaveModalClose"
    />
    <AppContextMenu
      v-if="contextMenu.show"
      :show="contextMenu.show"
      :position="contextMenu.position"
      :text="contextMenu.text"
      @hide-modal="contextMenu.show = false"
    />
  </div>
</template>

<script lang="ts" setup>
import IconWebsocket from "~icons/hopp/websocket"
import IconPlus from "~icons/lucide/plus"
import WebSocketEditor from "~/components/realtime/WebSocketEditor.vue"
import AppCollectionSidebarToggle from "~/components/app/CollectionSidebarToggle.vue"
import AppRequestLayoutToggle from "~/components/app/RequestLayoutToggle.vue"
import { ref, onMounted, onBeforeUnmount, computed, nextTick, watch } from "vue"
import { generateUniqueRefId, parseRESTRequest } from "@apirequest/data"
import { translateExtURLParams } from "~/helpers/RESTExtURLParams"
import { useRoute, useRouter } from "vue-router"
import { LATEST_RESPONSE_NAME } from "~/helpers/tab/saved-response"
import { useI18n } from "@composables/i18n"
import { getDefaultRESTRequest } from "~/helpers/rest/default"
import { defineActionHandler, invokeAction } from "~/helpers/actions"
import { platform } from "~/platform"
import { useReadonlyStream } from "~/composables/stream"
import { useService } from "dioc/vue"
import { InspectionService } from "~/services/inspection"
import { RequestInspectorService } from "~/services/inspection/inspectors/request.inspector"
import { EnvironmentInspectorService } from "~/services/inspection/inspectors/environment.inspector"
import { ResponseInspectorService } from "~/services/inspection/inspectors/response.inspector"
import { ScriptingInterceptorInspectorService } from "~/services/inspection/inspectors/scripting-interceptor.inspector"
import { cloneDeep } from "lodash-es"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import { HoppTab } from "~/services/tab"
import { HoppTabDocument } from "~/helpers/tab/document"
import { ScrollService } from "~/services/scroll.service"
import { GQLTabConnectionService } from "~/services/gql-tab-connection.service"
import { useGqlWorkspaceVisibility } from "~/composables/gqlWorkspaceVisibility"

const scrollService = useService(ScrollService)
const gqlTabConn = useService(GQLTabConnectionService)

// Tear down every GQL tab's poll timer and subscription socket when the user
// navigates away from the REST workspace. Per-tab cleanup on close covers
// tab-by-tab removal, but nothing fires when the whole page unmounts — so
// without this each gql-request tab's 7s schema poll keeps running for the
// rest of the app session. `disconnectAllTabs` clears the per-tab contexts;
// each tab re-establishes a fresh connection when the page is revisited.
onBeforeUnmount(() => {
  gqlTabConn.disconnectAllTabs()
})

const { isGqlWorkspaceEnabled } = useGqlWorkspaceVisibility()

const savingRequest = ref(false)
const confirmingCloseForTabID = ref<string | null>(null)
const confirmingCloseAllTabs = ref(false)
const showRenamingReqNameModal = ref(false)
const reqName = ref<string>("")
const unsavedTabsCount = ref(0)
const exceptedTabID = ref<string | null>(null)
const renameTabID = ref<string | null>(null)

const t = useI18n()

const tabs = useService(WorkspaceTabsService)
const router = useRouter()
watch(tabs.currentActiveTab, (tab) => {
  if (tab?.document.type === "test-runner")
    void router.push({ path: "/automation", query: { run: tab.id } })
})

const allTabs = tabs.getActiveTabs()
const activeTabs = computed(() =>
  allTabs.value.filter((tab) => tab.document.type !== "test-runner")
)
const currentTabID = computed({
  get: () =>
    activeTabs.value.find((tab) => tab.id === tabs.currentTabID.value)?.id ??
    activeTabs.value[0]?.id ??
    "",
  set: (id: string) => tabs.setActiveTab(id),
})
onMounted(() => {
  if (currentTabID.value) tabs.setActiveTab(currentTabID.value)
})

const currentUser = useReadonlyStream(
  platform.auth.getCurrentUserStream(),
  platform.auth.getCurrentUser()
)

type PopupDetails = {
  show: boolean
  position: {
    top: number
    left: number
  }
  text: string | null
}

const contextMenu = ref<PopupDetails>({
  show: false,
  position: {
    top: 0,
    left: 0,
  },
  text: null,
})

function bindRequestToURLParams() {
  const route = useRoute()
  // Get URL parameters and set that as the request
  onMounted(() => {
    const query = route.query
    // If query params are empty, or contains code or error param (these are from Oauth Redirect)
    // We skip URL params parsing
    if (Object.keys(query).length === 0 || query.code || query.error) return

    if (!tabs.currentActiveTab.value) addNewTab()
    const tab = tabs.currentActiveTab.value
    if (tab?.document.type !== "request") return

    const request = tab.document.request

    tab.document.request = parseRESTRequest(
      translateExtURLParams(query, request)
    )
  })
}

const onTabUpdate = (tab: HoppTab<HoppTabDocument>) => {
  tabs.updateTab(tab)
}

// Always "workspace" — on the unified page every save goes through
// WorkspaceTabsService, for both REST and GQL documents.
const saveRequestMode = computed(() => "workspace" as const)

const addNewTab = () => {
  const tab = tabs.createNewTab({
    type: "request",
    request: getDefaultRESTRequest(),
    isDirty: false,
  })

  tabs.setActiveTab(tab.id)
}
const sortTabs = (e: { oldIndex: number; newIndex: number }) => {
  const from = allTabs.value.findIndex(
    (tab) => tab.id === activeTabs.value[e.oldIndex]?.id
  )
  const to = allTabs.value.findIndex(
    (tab) => tab.id === activeTabs.value[e.newIndex]?.id
  )
  if (from >= 0 && to >= 0) tabs.updateTabOrdering(from, to)
}

const getTabName = (tab: HoppTab<HoppTabDocument>) => {
  if (tab.document.type === "request") {
    return tab.document.request?.name ?? "Untitled"
  } else if (tab.document.type === "gql-request") {
    return tab.document.request?.name ?? "Untitled"
  } else if (tab.document.type === "websocket") {
    return tab.document.name || "WebSocket"
  } else if (
    tab.document.type === "example-response" ||
    tab.document.type === "gql-example-response"
  ) {
    const name = tab.document.response?.name
    return name === LATEST_RESPONSE_NAME
      ? t("response.latest")
      : (name ?? "Untitled")
  }

  return "Unnamed tab"
}

const inspectionService = useService(InspectionService)

const removeTab = (tabID: string) => {
  if (!tabID || !tabs.getTabs().some((tab) => tab.id === tabID)) return
  const tabState = tabs.getTabRef(tabID).value

  if (tabState.document.isDirty) {
    confirmingCloseForTabID.value = tabID
  } else {
    // 仅在实际关闭后清理连接与检查状态。
    if (tabs.closeTab(tabState.id)) {
      scrollService.cleanupScrollForTab(tabState.id)
      if (tabState.document.type === "gql-request") {
        gqlTabConn.cleanupTab(tabState.id)
      }
      inspectionService.deleteTabInspectorResult(tabState.id)
    }
  }
}

// Tear down GQL connections (the 7s schema-poll timer, any open subscription
// socket, and the per-tab context maps) for every tab `closeOtherTabs` is
// about to discard — it only removes them from the tab map, so without this
// each dropped gql-request tab leaks its poll loop and socket. Mirrors the
// single-tab cleanup in `removeTab`; `cleanupTab` is idempotent.
const cleanupDiscardedTabs = (keepTabID: string) => {
  for (const tab of tabs.getTabs()) {
    if (tab.id === keepTabID || tab.document.type === "test-runner") continue
    if (tab.document.type === "gql-request") {
      gqlTabConn.cleanupTab(tab.id)
    }
    inspectionService.deleteTabInspectorResult(tab.id)
  }
}

const closeOtherTabsAction = (tabID: string) => {
  if (!tabID || !tabs.getTabs().some((tab) => tab.id === tabID)) return
  const isTabDirty = tabs.getTabRef(tabID).value?.document.isDirty
  const dirtyTabCount = tabs.getDirtyTabsCount()
  // If current tab is dirty, so we need to subtract 1 from the dirty tab count
  const balanceDirtyTabCount = isTabDirty ? dirtyTabCount - 1 : dirtyTabCount

  // If there are dirty tabs, show the confirm modal
  if (balanceDirtyTabCount > 0) {
    confirmingCloseAllTabs.value = true
    unsavedTabsCount.value = balanceDirtyTabCount
    exceptedTabID.value = tabID
  } else {
    scrollService.cleanupAllScroll(tabID)
    cleanupDiscardedTabs(tabID)
    for (const tab of activeTabs.value)
      if (tab.id !== tabID) tabs.closeTab(tab.id)
  }
}

const duplicateTab = (tabID: string) => {
  if (!tabID || !tabs.getTabs().some((tab) => tab.id === tabID)) return
  const tab = tabs.getTabRef(tabID)
  if (tab.value && tab.value.document.type === "request") {
    const newTab = tabs.createNewTab({
      type: "request",
      request: {
        ...cloneDeep(tab.value.document.request),
        _ref_id: generateUniqueRefId("req"),
      },
      isDirty: true,
    })
    tabs.setActiveTab(newTab.id)
  } else if (tab.value && tab.value.document.type === "gql-request") {
    const doc = tab.value.document
    const newTab = tabs.createNewTab({
      type: "gql-request",
      request: {
        ...cloneDeep(doc.request),
        _ref_id: generateUniqueRefId("req"),
      },
      isDirty: true,
      cursorPosition: doc.cursorPosition ?? 0,
      // Like REST duplicates: no inheritedProperties (the copy is detached
      // from the source collection, `inherit` resolves to none until saved)
      // and no response/sub-tab preference
    })
    tabs.setActiveTab(newTab.id)
  }
}

const onResolveConfirmCloseAllTabs = () => {
  if (exceptedTabID.value) {
    scrollService.cleanupAllScroll(exceptedTabID.value)
    cleanupDiscardedTabs(exceptedTabID.value)
    for (const tab of activeTabs.value)
      if (tab.id !== exceptedTabID.value) tabs.closeTab(tab.id)
  }
  confirmingCloseAllTabs.value = false
}

const requestToRename = computed(() => {
  if (!renameTabID.value) return null
  const tab = tabs.getTabRef(renameTabID.value)

  if (tab.value.document.type === "request") {
    return tab.value.document.request
  } else if (tab.value.document.type === "gql-request") {
    return tab.value.document.request
  }
  return null
})

const openReqRenameModal = (tabID?: string) => {
  if (tabID) {
    const tab = tabs.getTabRef(tabID)
    const docType = tab.value.document.type

    if (docType !== "request" && docType !== "gql-request") return

    reqName.value = tab.value.document.request.name
    renameTabID.value = tabID
  } else {
    const active = tabs.currentActiveTab.value
    if (!active) return
    const { id, document } = active

    if (document.type !== "request" && document.type !== "gql-request") return

    reqName.value = document.request.name
    renameTabID.value = id
  }
  showRenamingReqNameModal.value = true
}

const renameReqName = () => {
  const tab = tabs.getTabRef(renameTabID.value ?? currentTabID.value)
  if (
    tab.value &&
    (tab.value.document.type === "request" ||
      tab.value.document.type === "gql-request")
  ) {
    tab.value.document.request.name = reqName.value
    tabs.updateTab(tab.value)
  }
  showRenamingReqNameModal.value = false
}

/**
 * This function is closed when the confirm tab is closed by some means (even saving triggers close)
 */
const onCloseConfirmSaveTab = () => {
  if (!savingRequest.value && confirmingCloseForTabID.value) {
    const tabState = tabs.getTabRef(confirmingCloseForTabID.value).value
    // Only tear down when the tab actually closed (see removeTab)
    if (tabs.closeTab(confirmingCloseForTabID.value)) {
      scrollService.cleanupScrollForTab(confirmingCloseForTabID.value)
      if (tabState?.document.type === "gql-request") {
        gqlTabConn.cleanupTab(confirmingCloseForTabID.value)
      }
      inspectionService.deleteTabInspectorResult(confirmingCloseForTabID.value)
    }
    confirmingCloseForTabID.value = null
  }
}

/**
 * Called when the user confirms they want to save the tab
 */
const onResolveConfirmSaveTab = async () => {
  const closingTabID = confirmingCloseForTabID.value
  if (!closingTabID) return

  const tabState = tabs.getTabRef(closingTabID).value

  // Both save paths (the `request-response.save` handler and the Save As
  // modal) act on the active tab, so the tab being closed has to be focused
  // first — closing a dirty background tab would otherwise save the active
  // one. `nextTick` lets the newly active tab mount and bind its handler.
  if (currentTabID.value !== closingTabID) {
    tabs.setActiveTab(closingTabID)
    await nextTick()
  }

  // `HoppTabDocument` is a union — test-runner documents carry no
  // `saveContext`, so probe for the key instead of assuming it exists.
  const saveContext =
    "saveContext" in tabState.document
      ? tabState.document.saveContext
      : undefined

  if (!saveContext) {
    savingRequest.value = true
    return
  }

  invokeAction("request-response.save")

  // Only tear down when the tab actually closed (see removeTab)
  if (tabs.closeTab(closingTabID)) {
    scrollService.cleanupScrollForTab(closingTabID)
    if (tabState.document.type === "gql-request") {
      gqlTabConn.cleanupTab(closingTabID)
    }
    inspectionService.deleteTabInspectorResult(closingTabID)
  }
  confirmingCloseForTabID.value = null
}

/**
 * Called when the Save Request modal is done and is closed
 */
const onSaveModalClose = () => {
  savingRequest.value = false
  if (confirmingCloseForTabID.value) {
    const tabState = tabs.getTabRef(confirmingCloseForTabID.value).value
    // Only tear down when the tab actually closed (see removeTab)
    if (tabs.closeTab(confirmingCloseForTabID.value)) {
      scrollService.cleanupScrollForTab(confirmingCloseForTabID.value)
      if (tabState?.document.type === "gql-request") {
        gqlTabConn.cleanupTab(confirmingCloseForTabID.value)
      }
      inspectionService.deleteTabInspectorResult(confirmingCloseForTabID.value)
    }
    confirmingCloseForTabID.value = null
  }
}

const shareTabRequest = (tabID: string) => {
  const tab = tabs.getTabRef(tabID)
  if (
    tab.value &&
    (tab.value.document.type === "request" ||
      tab.value.document.type === "gql-request")
  ) {
    if (platform.localDesktop || currentUser.value) {
      invokeAction("share.request", {
        request: tab.value.document.request,
      })
    } else {
      invokeAction("workspace.reconnect")
    }
  }
}

defineActionHandler("contextmenu.open", ({ position, text }) => {
  if (text) {
    contextMenu.value = {
      show: true,
      position,
      text,
    }
  } else {
    contextMenu.value = {
      show: false,
      position,
      text,
    }
  }
})

bindRequestToURLParams()

defineActionHandler("rest.request.open", ({ doc }) => {
  tabs.createNewTab(doc)
})

defineActionHandler("rest.gql-request.open", ({ doc }) => {
  tabs.createNewTab(doc)
})

defineActionHandler("request.rename", () => {
  const tab = tabs.currentActiveTab.value
  if (!tab) return
  const docType = tab.document.type
  if (docType === "request" || docType === "gql-request")
    openReqRenameModal(tab.id)
})

defineActionHandler("tab.duplicate-tab", ({ tabID }) => {
  duplicateTab(tabID ?? currentTabID.value)
})

defineActionHandler("tab.close-current", () => {
  removeTab(currentTabID.value)
})

defineActionHandler("tab.close-other", () => {
  // Route through closeOtherTabsAction so the keyboard shortcut gets the same
  // dirty-tab confirmation (and scroll/GQL cleanup) as the tab context menu,
  // instead of force-closing unsaved tabs.
  closeOtherTabsAction(currentTabID.value)
})

defineActionHandler("tab.open-new", addNewTab)

defineActionHandler("tab.next", () => {
  tabs.goToNextTab()
})

defineActionHandler("tab.prev", () => {
  tabs.goToPreviousTab()
})

defineActionHandler("tab.switch-to-first", () => {
  tabs.goToFirstTab()
})

defineActionHandler("tab.switch-to-last", () => {
  tabs.goToLastTab()
})

defineActionHandler("tab.reopen-closed", () => {
  tabs.reopenClosedTab()
})

defineActionHandler("tab.mru-switch", () => {
  tabs.goToMRUTab()
})

defineActionHandler("tab.mru-switch-reverse", () => {
  tabs.goToPreviousMRUTab()
})

useService(RequestInspectorService)
useService(EnvironmentInspectorService)
useService(ResponseInspectorService)
useService(ScriptingInterceptorInspectorService)

for (const inspectorDef of platform.additionalInspectors ?? []) {
  useService(inspectorDef.service)
}
</script>

<style scoped>
/* The shared tabs reserve room for two actions; this workbench has four. */
.request-windows :deep(> .tabs > div:nth-child(2)) {
  width: auto;
  flex-shrink: 0;
}
</style>
