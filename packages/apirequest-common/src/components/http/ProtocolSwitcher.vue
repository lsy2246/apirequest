<template>
  <div
    class="sticky top-0 z-20 flex items-center border-b border-dividerLight bg-primary px-4 py-2"
  >
    <WorkbenchSelect
      class="w-32 shrink-0"
      :model-value="currentProtocolLabel"
      :options="protocolOptions"
      :label="t('request.switch_protocol')"
      @update:model-value="switchProtocol"
    />

    <!-- Folder path + editable request name -->
    <div class="ml-4 flex min-w-0 items-center">
      <template v-if="displayFolderPath.length > 0">
        <template v-for="(segment, i) in displayFolderPath" :key="i">
          <span
            v-tippy="{ theme: 'tooltip' }"
            :title="segment.tooltip"
            class="max-w-[10rem] flex-shrink-0 cursor-default truncate text-tiny text-secondaryLight"
          >
            {{ segment.name }}
          </span>
          <component
            :is="IconChevronRight"
            class="mx-0.5 h-3 w-3 flex-shrink-0 text-secondaryLight opacity-50"
          />
        </template>
      </template>
      <HoppSmartInput
        v-model="requestName"
        :autofocus="false"
        styles=""
        input-styles="border border-transparent bg-transparent text-tiny text-secondaryDark focus:border-divider focus:bg-primaryLight rounded px-2 py-0.5 outline-none transition-colors"
        :placeholder="t('request.untitled')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useService } from "dioc/vue";
import { useI18n } from "@composables/i18n";
import { useReadonlyStream } from "@composables/stream";
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs";
import { GQLTabConnectionService } from "~/services/gql-tab-connection.service";
import { ScrollService } from "~/services/scroll.service";
import { switchActiveTabToGQL, switchActiveTabToREST, switchActiveTabToWebSocket } from "~/helpers/tab/protocol-switch";
import { defineActionHandler } from "~/helpers/actions";
import { isRootRequestCollection, restCollections$ } from "~/newstore/collections";
import IconChevronRight from "~icons/lucide/chevron-right";
import IconGlobe from "~icons/lucide/globe";
import IconGraphql from "~icons/hopp/graphql";
import IconWebsocket from "~icons/hopp/websocket";
import { isLocalWorkbench } from "~/platform";

const t = useI18n()

const tabs = useService(WorkspaceTabsService)
const gqlTabConn = useService(GQLTabConnectionService)
const scrollService = useService(ScrollService)

const collections = useReadonlyStream(restCollections$, [])

const currentDoc = computed(() => tabs.currentActiveTab.value?.document)

const isGQL = computed(() => currentDoc.value?.type === "gql-request")

const isWebSocket = computed(() => currentDoc.value?.type === "websocket")

const currentProtocolLabel = computed(() =>
  isWebSocket.value ? "WebSocket" : isGQL.value ? "GraphQL" : "REST"
)

type Protocol = "REST" | "GraphQL" | "WebSocket"
const protocolOptions = computed(() => [
  { value: "REST" as const, label: "REST", icon: IconGlobe },
  { value: "GraphQL" as const, label: "GraphQL", icon: IconGraphql },
  ...(isLocalWorkbench()
    ? [{ value: "WebSocket" as const, label: "WebSocket", icon: IconWebsocket }]
    : []),
])
const switchProtocol = (protocol: Protocol) => {
  if (protocol === "REST") switchToREST()
  else if (protocol === "GraphQL") switchToGQL()
  else switchToWebSocket()
}

const requestName = computed({
  get: () => {
    const doc = currentDoc.value
    if (!doc) return ""
    if (doc.type === "request") return doc.request.name
    if (doc.type === "gql-request") return doc.request.name
    if (doc.type === "websocket") return doc.name
    return ""
  },
  set: (value: string) => {
    const doc = currentDoc.value
    if (!doc) return
    if (doc.type === "request" || doc.type === "gql-request") {
      doc.request.name = value
    } else if (doc.type === "websocket") {
      doc.name = value
    }
  },
})

const folderPath = computed<string[]>(() => {
  const doc = currentDoc.value
  if (!doc) return []

  const saveContext =
    doc.type === "request" || doc.type === "gql-request"
      ? doc.saveContext
      : null

  if (
    !saveContext ||
    saveContext.originLocation !== "user-collection" ||
    !saveContext.folderPath
  ) {
    return []
  }

  const indexPath = saveContext.folderPath
  const indexes = indexPath.split("/").map((x) => parseInt(x))

  // Walk the collection tree collecting names
  const names: string[] = []
  const cols = collections.value

  if (indexes.length === 0 || !cols.length) return []

  // First index is the root collection
  let current = cols[indexes[0]]
  if (!current || isRootRequestCollection(current)) return []
  names.push(current.name)

  // Subsequent indexes traverse into folders
  for (let i = 1; i < indexes.length; i++) {
    const folder = current.folders[indexes[i]]
    if (!folder) break
    names.push(folder.name)
    current = folder
  }

  return names
})

// Every segment is width-capped (ellipsized by CSS),
// and deep paths collapse to `root > … > parent` with the hidden
// segments in the tooltip
const displayFolderPath = computed<{ name: string; tooltip: string }[]>(() => {
  const path = folderPath.value
  if (path.length <= 3) {
    return path.map((name) => ({ name, tooltip: name }))
  }
  return [
    { name: path[0], tooltip: path[0] },
    {
      name: "…",
      tooltip: path.slice(1, -1).join(" > "),
    },
    { name: path[path.length - 1], tooltip: path[path.length - 1] },
  ]
})

// The switch flow (draft snapshots, teardown ordering) is shared with the AI
// chat's `switch_protocol` tool — see `~/helpers/tab/protocol-switch`.
const switchToGQL = () => {
  switchActiveTabToGQL({ tabs, gqlTabConn, scrollService })
}

const switchToREST = () => {
  switchActiveTabToREST({ tabs, gqlTabConn, scrollService })
}

const switchToWebSocket = () => {
  if (isLocalWorkbench())
    switchActiveTabToWebSocket({ tabs, gqlTabConn, scrollService })
}

// Keyboard shortcut (Alt/⌥ T) and Spotlight route through this action —
// without a payload it toggles, with one it targets that protocol.
defineActionHandler("tab.switch-protocol", (payload) => {
  const target = payload?.protocol
  if (target === "rest") switchToREST()
  else if (target === "graphql") switchToGQL()
  else if (target === "websocket") switchToWebSocket()
  else if (isGQL.value || isWebSocket.value) switchToREST()
  else switchToGQL()
})
</script>
