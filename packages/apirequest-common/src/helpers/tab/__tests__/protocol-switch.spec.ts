import { describe, expect, it, vi } from "vitest"
import { TestContainer } from "dioc/testing"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import { getDefaultRESTRequest } from "~/helpers/rest/default"
import { WORKSPACE_TABS_STATE_SCHEMA } from "~/services/persistence/validation-schemas"
import type { HoppRequestDocument, HoppTabDocument } from "../document"
import type { PersistableTabState } from "~/services/tab"
import {
  switchActiveTabToGQL,
  switchActiveTabToREST,
  switchActiveTabToWebSocket,
  type ProtocolSwitchServices,
} from "../protocol-switch"

// 请求切换通过真实标签服务执行，持久化适配器不参与本测试的外部读写。
vi.mock("~/services/persistence", () => ({
  PersistenceService: class {},
  STORE_KEYS: {},
}))

function setup() {
  const tabs = new TestContainer().bind(WorkspaceTabsService)
  const services = {
    tabs,
    gqlTabConn: { cleanupTab: vi.fn() },
    scrollService: { cleanupScrollForTab: vi.fn() },
  } as unknown as ProtocolSwitchServices
  const original: HoppRequestDocument = {
    type: "request",
    request: {
      ...getDefaultRESTRequest(),
      name: "原始请求",
      endpoint: "https://example.test/orders",
      method: "POST",
      body: { contentType: "application/json", body: '{"sku":"test"}' },
    },
    isDirty: true,
    saveContext: {
      originLocation: "user-collection",
      folderPath: "0",
      requestIndex: 0,
    },
    cancelFunction: vi.fn(),
  }
  tabs.currentActiveTab.value.document = original
  return { tabs, services, original }
}

describe("当前标签协议切换", () => {
  it("三种协议往返时保留标签 ID、请求内容和各自草稿", () => {
    const { tabs, services, original } = setup()
    const id = tabs.currentActiveTab.value.id
    const count = tabs.getTabs().length
    expect(switchActiveTabToWebSocket(services)).toBe(true)
    expect(original.cancelFunction).toHaveBeenCalledOnce()
    const ws = tabs.currentActiveTab.value.document
    if (ws.type !== "websocket") throw new Error("未切换到 WebSocket")
    expect(ws.request.endpoint).toBe("wss://example.test/orders")
    ws.request = {
      endpoint: "ws://example.test/live",
      protocols: [{ value: "chat", active: true }],
    }
    ws.name = "消息草稿"

    expect(switchActiveTabToGQL(services)).toBe(true)
    const gql = tabs.currentActiveTab.value.document
    if (gql.type !== "gql-request") throw new Error("未切换到 GraphQL")
    gql.request.query = "query Test { orders { id } }"
    expect(switchActiveTabToWebSocket(services)).toBe(true)
    expect(services.gqlTabConn.cleanupTab).toHaveBeenCalledWith(id)
    expect(tabs.currentActiveTab.value.document).toMatchObject({
      type: "websocket",
      name: "消息草稿",
      request: ws.request,
    })
    expect(switchActiveTabToREST(services)).toBe(true)
    expect(tabs.currentActiveTab.value.document).toMatchObject({
      type: "request",
      request: original.request,
      isDirty: true,
      saveContext: original.saveContext,
    })
    expect(switchActiveTabToGQL(services)).toBe(true)
    expect(tabs.currentActiveTab.value.document).toMatchObject({
      type: "gql-request",
      request: { query: "query Test { orders { id } }" },
    })
    expect(tabs.currentActiveTab.value.id).toBe(id)
    expect(tabs.getTabs()).toHaveLength(count)
    expect(switchActiveTabToGQL(services)).toBe(false)
  })

  it("另一协议保存后，通过 WebSocket 恢复草稿仍使用最新的数据库身份", () => {
    const { tabs, services } = setup()
    tabs.currentActiveTab.value.document.isDirty = false
    switchActiveTabToGQL(services)
    const gql = tabs.currentActiveTab.value.document
    if (gql.type !== "gql-request") throw new Error("未切换到 GraphQL")
    gql.request.id = "new-saved-request"
    gql.isDirty = false
    switchActiveTabToWebSocket(services)
    switchActiveTabToREST(services)
    expect(tabs.currentActiveTab.value.document).toMatchObject({
      type: "request",
      request: { id: "new-saved-request" },
      isDirty: false,
    })
  })

  it("活动协议为 WebSocket 时刷新，原请求、目录和 WebSocket 草稿仍能恢复", () => {
    const { tabs, services, original } = setup()
    const id = tabs.currentActiveTab.value.id
    switchActiveTabToWebSocket(services)
    const persisted = WORKSPACE_TABS_STATE_SCHEMA.parse(
      JSON.parse(JSON.stringify(tabs.persistableTabState.value))
    )
    const restored = new TestContainer().bind(WorkspaceTabsService)
    restored.loadTabsFromPersistedState(
      persisted as PersistableTabState<HoppTabDocument>
    )
    const restoredServices = { ...services, tabs: restored }
    expect(switchActiveTabToREST(restoredServices)).toBe(true)
    expect(restored.currentActiveTab.value.id).toBe(id)
    expect(restored.currentActiveTab.value.document).toMatchObject({
      type: "request",
      request: original.request,
      saveContext: original.saveContext,
    })
    expect(switchActiveTabToWebSocket(restoredServices)).toBe(true)
    expect(restored.currentActiveTab.value.document).toMatchObject({
      type: "websocket",
      request: { endpoint: "wss://example.test/orders" },
    })
  })

  it("独立打开的 WebSocket 标签也能原地切换", () => {
    const { tabs, services } = setup()
    tabs.currentActiveTab.value.document = {
      type: "websocket",
      name: "独立消息",
      isDirty: false,
      request: { endpoint: "wss://example.test/live", protocols: [] },
    }
    const id = tabs.currentActiveTab.value.id
    expect(switchActiveTabToGQL(services)).toBe(true)
    expect(tabs.currentActiveTab.value.document).toMatchObject({
      type: "gql-request",
      request: { name: "独立消息", url: "https://example.test/live" },
    })
    expect(tabs.currentActiveTab.value.id).toBe(id)
    expect(tabs.getTabs()).toHaveLength(1)
  })
})
