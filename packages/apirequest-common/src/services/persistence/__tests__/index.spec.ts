import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { ref, nextTick } from "vue"
import * as E from "fp-ts/Either"
import { getDefaultRESTRequest, makeCollection } from "@apirequest/data"
import { Subject } from "rxjs"
import { PersistenceService, STORE_KEYS, STORE_NAMESPACE } from "../index"
import { Store } from "~/kernel/store"
import { restCollectionStore, setRESTCollections } from "~/newstore/collections"

vi.mock("~/kernel/store", () => ({
  Store: { get: vi.fn(), set: vi.fn(), remove: vi.fn(), init: vi.fn() },
}))
vi.mock("~/services/tab/workspace-tabs", () => ({
  WorkspaceTabsService: class {},
}))
vi.mock("~/newstore/collections", () => ({
  restCollectionStore: { subject$: new Subject() },
  setRESTCollections: vi.fn(),
}))
vi.mock("~/newstore/history", () => ({
  graphqlHistoryStore: {},
  restHistoryStore: {},
  setGraphqlHistoryEntries: vi.fn(),
  setRESTHistoryEntries: vi.fn(),
  translateToNewGQLHistory: vi.fn(),
  translateToNewRESTHistory: vi.fn(),
}))

const fixture = () =>
  makeCollection({
    name: "saved",
    folders: [],
    requests: [getDefaultRESTRequest()],
    auth: { authType: "inherit", authActive: true },
    headers: [],
    variables: [],
    description: null,
    preRequestScript: "",
    testScript: "",
  })
const service = () =>
  Object.assign(Object.create(PersistenceService.prototype), {
    showErrorToast: vi.fn(),
  }) as any

describe("current collection persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(Store.set).mockResolvedValue(E.right(undefined))
    ;(restCollectionStore as any).subject$ = new Subject()
  })
  afterEach(() => {
    window.__APIREQUEST_NATIVE__ = false
  })
  it.each([false, true])(
    "restores current collections (native=%s)",
    async (native) => {
      window.__APIREQUEST_NATIVE__ = native
      const saved = [fixture()]
      vi.mocked(Store.get).mockResolvedValue(E.right(saved))
      await service().setupRESTCollectionsPersistence()
      expect(setRESTCollections).toHaveBeenCalledWith(saved)
      expect(Store.set).not.toHaveBeenCalled()
    }
  )
  it("backs up unsupported web data without overwriting it", async () => {
    const old = [{ ...fixture(), v: 11 }]
    vi.mocked(Store.get).mockResolvedValue(E.right(old))
    await service().setupRESTCollectionsPersistence()
    expect(setRESTCollections).not.toHaveBeenCalled()
    expect(Store.set).toHaveBeenCalledWith(
      STORE_NAMESPACE,
      `${STORE_KEYS.REST_COLLECTIONS}-backup`,
      old
    )
    expect(Store.set).not.toHaveBeenCalledWith(
      STORE_NAMESPACE,
      STORE_KEYS.REST_COLLECTIONS,
      expect.anything()
    )
  })
  it("keeps unsupported native data intact", async () => {
    window.__APIREQUEST_NATIVE__ = true
    vi.mocked(Store.get).mockResolvedValue(E.right([{ ...fixture(), v: 11 }]))
    await service().setupRESTCollectionsPersistence()
    expect(setRESTCollections).not.toHaveBeenCalled()
    expect(Store.set).not.toHaveBeenCalled()
  })
  it("does not replace native collections after a failed read", async () => {
    window.__APIREQUEST_NATIVE__ = true
    vi.mocked(Store.get).mockResolvedValue(
      E.left({ message: "read failed" } as any)
    )
    const persistence = service()
    await persistence.setupRESTCollectionsPersistence()
    expect(persistence.showErrorToast).toHaveBeenCalledOnce()
    expect(setRESTCollections).not.toHaveBeenCalled()
    expect(Store.set).not.toHaveBeenCalled()
  })
})

describe("workspace tab refresh persistence", () => {
  const listeners: EventListener[] = []
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.mocked(Store.get).mockResolvedValue(E.right(undefined))
    vi.mocked(Store.set).mockResolvedValue(E.right(undefined))
  })
  afterEach(() => {
    listeners.splice(0).forEach(listener => window.removeEventListener("pagehide", listener))
    vi.clearAllTimers()
    vi.useRealTimers()
  })
  async function setupTabs() {
    const state = ref({ lastActiveTabID: "a", orderedDocs: ["a", "b"].map(tabID => ({
      tabID, doc: { type: "request", request: getDefaultRESTRequest(), isDirty: false },
    })) })
    const persistence = service()
    persistence.workspaceTabsService = { persistableTabState: state }
    const listen = vi.spyOn(window, "addEventListener")
    await persistence.setupWorkspaceTabsPersistence()
    const flush = listen.mock.calls.find(([name]) => name === "pagehide")?.[1] as EventListener
    listen.mockRestore()
    listeners.push(flush)
    return { state, flush }
  }
  it("persists reordered tabs immediately without changing the active tab", async () => {
    const { state } = await setupTabs()
    state.value = { ...state.value, orderedDocs: [...state.value.orderedDocs].reverse() }
    await nextTick()
    expect(Store.set).toHaveBeenCalledWith(STORE_NAMESPACE, STORE_KEYS.REST_TABS,
      expect.objectContaining({ lastActiveTabID: "a", orderedDocs: [
        expect.objectContaining({ tabID: "b" }), expect.objectContaining({ tabID: "a" }),
      ] }))
  })
  it("persists opening or closing a background tab immediately", async () => {
    const { state } = await setupTabs()
    state.value = { ...state.value, orderedDocs: state.value.orderedDocs.slice(0, 1) }
    await nextTick()
    expect(Store.set).toHaveBeenCalledTimes(1)
  })
  it("leaves a newer snapshot alone when an idle page closes", async () => {
    const { flush } = await setupTabs()
    flush(new Event("pagehide"))
    expect(Store.set).not.toHaveBeenCalled()
  })
  it("keeps a dirty request with a retired editor panel and saves the next selection", async () => {
    const doc = { type: "request", request: getDefaultRESTRequest(), isDirty: true }
    const saved = { lastActiveTabID: "b", orderedDocs: [
      { tabID: "a", doc: { ...doc, optionTabPreference: "old-panel" } },
      { tabID: "b", doc },
    ] }
    vi.mocked(Store.get).mockResolvedValue(E.right(saved))
    const loadTabsFromPersistedState = vi.fn()
    const state = ref(saved)
    const persistence = service()
    persistence.workspaceTabsService = { persistableTabState: state, loadTabsFromPersistedState }
    const listen = vi.spyOn(window, "addEventListener")
    await persistence.setupWorkspaceTabsPersistence()
    listeners.push(listen.mock.calls.find(([name]) => name === "pagehide")![1] as EventListener)
    listen.mockRestore()
    expect(loadTabsFromPersistedState.mock.calls[0][0].orderedDocs[0]).toMatchObject({
      tabID: "a", doc: { isDirty: true, request: doc.request },
    })
    state.value = { ...saved, lastActiveTabID: "a" }
    await nextTick()
    expect(Store.set).toHaveBeenCalledWith(STORE_NAMESPACE, STORE_KEYS.REST_TABS, state.value)
  })
  it("flushes pending edits when the page is refreshed", async () => {
    const { state, flush } = await setupTabs()
    state.value.orderedDocs[0].doc.request.name = "Edited before refresh"
    await nextTick()
    expect(Store.set).not.toHaveBeenCalled()
    flush(new Event("pagehide"))
    expect(Store.set).toHaveBeenCalledWith(STORE_NAMESPACE, STORE_KEYS.REST_TABS, state.value)
    await vi.advanceTimersByTimeAsync(600)
    expect(Store.set).toHaveBeenCalledTimes(1)
  })
})
