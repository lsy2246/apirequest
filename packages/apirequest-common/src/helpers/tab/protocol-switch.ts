import { WorkspaceTabsService } from "~/services/tab/workspace-tabs";
import { GQLTabConnectionService } from "~/services/gql-tab-connection.service";
import { ScrollService } from "~/services/scroll.service";
import { convertRESTToGQL, convertGQLToREST } from "./type-converter";
import { HoppRequestDocument, HoppGQLRequestDocument } from "./document";
import { cloneDeep } from "lodash-es";
import { getDefaultRESTRequest } from "~/helpers/rest/default";
import { getDefaultGQLRequest } from "@apirequest/data";

/** 当前标签的协议切换入口，集中处理草稿、请求取消和连接释放。 */
export type ProtocolSwitchServices = {
  tabs: WorkspaceTabsService
  gqlTabConn: GQLTabConnectionService
  scrollService: ScrollService
}

/** 将当前 REST 或 WebSocket 标签切换为 GraphQL，保持标签身份。 */
export function switchActiveTabToGQL({
  tabs,
  gqlTabConn,
  scrollService,
}: ProtocolSwitchServices): boolean {
  const tab = tabs.currentActiveTab.value
  if (tab?.document.type === "websocket")
    return switchWebSocketToRequest({ tabs, gqlTabConn, scrollService }, "gql")
  if (!tab || tab.document.type !== "request") return false

  // Snapshot the current REST request as the REST draft so a later switch back
  // restores edits the user made before this protocol switch.
  tabs.setProtocolDraft(
    tab.id,
    "rest",
    tab.document.request,
    tab.document.isDirty
  )

  // If the user previously had GQL data on this tab, restore it verbatim.
  // Otherwise let the converter seed a fresh GQL request from the REST one.
  const gqlDraft = tabs.getProtocolDraft(tab.id)?.gql

  // Cancel the in-flight REST run before the document type flips — the runner
  // writes into `tab.document` from a subscription, not a component, so a late
  // response would land a HoppRESTResponse in a field typed GQLResponseEvent[].
  tab.document.cancelFunction?.()

  // The REST document's scroll offsets don't map onto the GQL panes
  scrollService.cleanupScrollForTab(tab.id)

  const gqlDoc = convertRESTToGQL(tab.document as HoppRequestDocument, gqlDraft)
  tab.document = gqlDoc
  tabs.updateTab(tab)
  return true
}

/** 将当前 GraphQL 或 WebSocket 标签切换为 REST，保持标签身份。 */
export function switchActiveTabToREST({
  tabs,
  gqlTabConn,
  scrollService,
}: ProtocolSwitchServices): boolean {
  const tab = tabs.currentActiveTab.value
  if (tab?.document.type === "websocket")
    return switchWebSocketToRequest({ tabs, gqlTabConn, scrollService }, "rest")
  if (!tab || tab.document.type !== "gql-request") return false

  // Snapshot the current GQL request as the GQL draft for round-trip preservation.
  tabs.setProtocolDraft(
    tab.id,
    "gql",
    tab.document.request,
    tab.document.isDirty
  )

  // Restore the previously-snapshotted REST request if any; else seed from GQL.
  const restDraft = tabs.getProtocolDraft(tab.id)?.rest

  const restDoc = convertGQLToREST(
    tab.document as HoppGQLRequestDocument,
    restDraft
  )

  // Tear down the GQL connection (poll timer, subscription socket, context
  // maps) before the document type flips to "request" — the close paths in
  // index.vue skip a tab that is no longer `gql-request`, so the context and
  // its 7s poll loop would leak for the page's lifetime.
  gqlTabConn.cleanupTab(tab.id)
  scrollService.cleanupScrollForTab(tab.id)

  tab.document = restDoc
  tabs.updateTab(tab)
  return true
}

// 三种协议共用同一个标签 ID；仅保存请求草稿，连接、响应和取消函数属于当前编辑器。
export function switchActiveTabToWebSocket({
  tabs,
  gqlTabConn,
  scrollService,
}: ProtocolSwitchServices): boolean {
  const tab = tabs.currentActiveTab.value
  const doc = tab?.document
  if (!tab || !doc || (doc.type !== "request" && doc.type !== "gql-request"))
    return false
  if (doc.type === "request") {
    tabs.setProtocolDraft(tab.id, "rest", doc.request, doc.isDirty)
    doc.cancelFunction?.()
  } else {
    tabs.setProtocolDraft(tab.id, "gql", doc.request, doc.isDirty)
    gqlTabConn.cleanupTab(tab.id)
  }
  const drafts = tab.protocolDrafts!
  drafts.requestContext = cloneDeep({
    protocol: doc.type === "request" ? "rest" : "gql",
    saveContext: doc.saveContext,
    inheritedProperties: doc.inheritedProperties,
  })
  const endpoint =
    doc.type === "request" ? doc.request.endpoint : doc.request.url
  const draft = drafts.websocket
  scrollService.cleanupScrollForTab(tab.id)
  tab.document = {
    type: "websocket",
    name: draft?.name ?? doc.request.name,
    request: cloneDeep(
      draft?.request ?? {
        endpoint: endpoint
          .replace(/^http:/i, "ws:")
          .replace(/^https:/i, "wss:"),
        protocols: [],
      }
    ),
    isDirty: false,
  }
  tabs.updateTab(tab)
  return true
}

function switchWebSocketToRequest(
  { tabs, scrollService }: ProtocolSwitchServices,
  target: "rest" | "gql"
): boolean {
  const tab = tabs.currentActiveTab.value
  const doc = tab?.document
  if (!tab || doc?.type !== "websocket") return false
  const drafts = tab.protocolDrafts ?? {}
  drafts.websocket = cloneDeep({ request: doc.request, name: doc.name })
  tab.protocolDrafts = drafts
  const { protocol, ...context } = cloneDeep(
    drafts.requestContext ?? { protocol: undefined }
  )
  const endpoint = doc.request.endpoint
    .replace(/^ws:/i, "http:")
    .replace(/^wss:/i, "https:")
  const restDoc: HoppRequestDocument = {
    type: "request",
    request: cloneDeep(
      drafts.rest?.request ?? {
        ...getDefaultRESTRequest(),
        name: doc.name,
        endpoint,
      }
    ),
    isDirty: drafts.rest?.isDirty ?? true,
    ...context,
    response: null,
    optionTabPreference: "params",
  }
  const gqlDoc: HoppGQLRequestDocument = {
    type: "gql-request",
    request: cloneDeep(
      drafts.gql?.request ?? {
        ...getDefaultGQLRequest(),
        name: doc.name,
        url: endpoint,
      }
    ),
    isDirty: drafts.gql?.isDirty ?? true,
    ...context,
    response: null,
    optionTabPreference: "query",
  }
  // 以进入 WebSocket 前的协议为身份来源，复用转换器更新草稿中的数据库 ID。
  // 这样在另一协议保存过的新请求，恢复旧草稿时仍会更新原记录。
  let restored: HoppRequestDocument | HoppGQLRequestDocument
  if (target === "rest") {
    restored =
      protocol === "gql" ? convertGQLToREST(gqlDoc, drafts.rest) : restDoc
  } else {
    restored =
      protocol === "rest" ? convertRESTToGQL(restDoc, drafts.gql) : gqlDoc
  }
  // WebSocket 编辑器卸载时会关闭自己的连接；先恢复文档，避免重建或激活别的标签。
  scrollService.cleanupScrollForTab(tab.id)
  tab.document = restored
  tabs.updateTab(tab)
  return true
}
