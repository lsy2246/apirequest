import { beforeEach, describe, expect, it, vi } from "vitest"
import { getDefaultGQLRequest, getDefaultRESTRequest, type HoppCollection } from "@apirequest/data"
import { assertCollectionLoaded, assertCollectionRequestLoaded, collectPendingCollections, isCollectionRequestSummary, mergePendingCollections } from "../collection-summary"
import type { RemoteCollectionIndex } from "../remote-collections"

const mocks = vi.hoisted(() => ({
  state: { value: { state: [] as HoppCollection[] } },
  get: vi.fn(), post: vi.fn(), read: vi.fn(), write: vi.fn(), set: vi.fn(),
}))
vi.mock("axios", () => ({ default: { get: mocks.get, post: mocks.post, isAxiosError: (value: unknown) => !!(value as { response?: unknown })?.response } }))
vi.mock("~/platform", () => ({ platform: { auth: { localSessionState: { value: "ready" } } } }))
vi.mock("~/lib/sync", () => ({ runDispatchWithOutSyncing: (fn: () => void) => fn() }))
vi.mock("~/newstore/collections", () => ({
  restCollectionStore: { get value() { return mocks.state.value }, subject$: { subscribe: vi.fn() } },
  setRESTCollections: (tree: HoppCollection[]) => { mocks.state.value.state = tree; mocks.set(tree) },
}))
vi.mock("../remote-collection-cache", () => ({ readCollectionCache: mocks.read, writeCollectionCache: mocks.write }))

const snapshot = (): RemoteCollectionIndex => ({
  schemaVersion: 1, revision: "index-1",
  collections: [
    { id: "root", parentID: null, title: "Root", type: "REST", data: { _ref_id: "root-ref", preRequestScript: "before()", auth: { authType: "bearer", authActive: true, token: "inherited" } }, orderIndex: 0, updatedOn: "v1" },
    { id: "folder", parentID: "root", title: "Child", type: "REST", data: {}, orderIndex: 0, updatedOn: "v1" },
  ],
  requests: [
    { id: "one", collectionID: "folder", title: "One", refID: "one-ref", method: "POST", endpoint: "https://example.test", gql: false, hasResponses: true, orderIndex: 0, updatedOn: "v1" },
    { id: "two", collectionID: "root", title: "Two", refID: "two-ref", method: null, endpoint: "https://example.test/graphql", gql: true, hasResponses: false, orderIndex: 0, updatedOn: "v1" },
  ],
})
const detail = (id = "one") => ({
  id, collectionID: id === "one" ? "folder" : "root", title: id === "one" ? "One" : "Two", updatedOn: "v1",
  request: id === "one"
    ? { ...getDefaultRESTRequest(), _ref_id: "one-ref", method: "POST", preRequestScript: "requestBefore()", body: { contentType: "application/json", body: '{"preserved":true}' } }
    : { ...getDefaultGQLRequest(), _ref_id: "two-ref", query: "query { preserved }" },
})
let remote: typeof import("../remote-collections")
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.state.value.state = []
  mocks.read.mockResolvedValue(undefined)
  mocks.write.mockResolvedValue(undefined)
  remote = await import("../remote-collections")
})
const install = () => {
  const tree = remote.buildRemoteCollectionTree(snapshot())
  mocks.state.value.state = tree
  return tree
}

describe("remote collection detail loading", () => {
  it("builds searchable REST/GQL navigation without fabricating editable request bodies", () => {
    const tree = install()
    expect(tree[0]._ref_id).toBe("root-ref")
    expect(tree[0].preRequestScript).toBe("before()")
    expect(tree[0].auth).toEqual({ authType: "bearer", authActive: true, token: "inherited" })
    const request = tree[0].folders[0].requests[0]
    expect(request).toMatchObject({ name: "One", method: "POST", endpoint: "https://example.test" })
    expect(request).not.toHaveProperty("body")
    expect(tree[0].requests[0]).toMatchObject({ url: "https://example.test/graphql", query: "" })
    expect(() => assertCollectionRequestLoaded(request)).toThrow("详情尚未加载")
    expect(() => assertCollectionLoaded(tree[0])).toThrow("详情尚未加载")
  })

  it("shows a cached index before validation finishes and never downloads full details at startup", async () => {
    mocks.read.mockImplementation((store, key) => Promise.resolve(key === "workspace" ? snapshot() : undefined))
    let complete!: (value: unknown) => void
    mocks.get.mockReturnValue(new Promise((resolve) => { complete = resolve }))
    await remote.initRemoteCollectionIndex()
    expect(mocks.state.value.state[0].folders[0].requests).toHaveLength(1)
    expect(mocks.get).toHaveBeenCalledTimes(1)
    expect(mocks.get.mock.calls[0][0]).toMatch(/collections\/index$/)
    expect(mocks.post).not.toHaveBeenCalled()
    complete({ status: 304 })
    await remote.refreshRemoteCollectionIndex()
  })

  it("opens with folders only and loads a folder across cursor pages", async () => {
    const opening = { ...snapshot(), revision: "lazy-index-1", lazyRequests: true, requests: [] }
    mocks.get.mockResolvedValueOnce({ status: 200, data: opening })
    await remote.initRemoteCollectionIndex()
    expect(mocks.state.value.state[0].folders[0].requests).toEqual([])
    expect(() => assertCollectionLoaded(mocks.state.value.state[0])).toThrow("尚未加载")
    mocks.get.mockResolvedValueOnce({ data: {
      revision: "lazy-index-1", requests: [snapshot().requests[0]],
      nextCursor: { orderIndex: 0, id: "one" },
    } }).mockResolvedValueOnce({ data: {
      revision: "lazy-index-1", requests: [], nextCursor: null,
    } })
    await remote.ensureRemoteFolder("folder")
    expect(mocks.state.value.state[0].folders[0].requests[0].name).toBe("One")
    expect(remote.remoteFolderHasMore("folder")).toBe(true)
    expect(() => assertCollectionLoaded(mocks.state.value.state[0].folders[0])).toThrow("尚未加载")
    await remote.ensureRemoteFolder("folder")
    expect(mocks.get.mock.calls.at(-1)?.[1]?.params).toMatchObject({ cursorID: "one" })
    expect(remote.remoteFolderHasMore("folder")).toBe(false)
    expect(mocks.get).toHaveBeenCalledTimes(3)
  })

  it("locates an unloaded nested request beyond the first page using its ID", async () => {
    mocks.get.mockResolvedValueOnce({ status: 200, data: {
      ...snapshot(), revision: "lazy-index-1", lazyRequests: true, requests: [],
    } })
    await remote.initRemoteCollectionIndex()
    mocks.get.mockResolvedValueOnce({ data: detail() })
      .mockResolvedValueOnce({ data: {
        revision: "lazy-index-1", requests: [{ ...snapshot().requests[0], id: "other", refID: "other" }],
        nextCursor: { orderIndex: 0, id: "other" },
      } })
      .mockResolvedValueOnce({ data: {
        revision: "lazy-index-1", requests: [snapshot().requests[0]],
        nextCursor: { orderIndex: 1, id: "one" },
      } })
    expect(await remote.ensureRemoteRequestLocation({ id: "one" }, { folderPath: "9/9" }))
      .toEqual({ folderPath: "0/0", requestIndex: 1 })
    expect(mocks.get.mock.calls.slice(2).map(([url]) => url)).toEqual([
      expect.stringMatching(/folders\/folder\/requests$/), expect.stringMatching(/folders\/folder\/requests$/),
    ])
    expect(remote.isRemoteFolderLoaded("folder")).toBe(false)
    expect(mocks.get).toHaveBeenCalledTimes(4)
  })

  it("does not load pages when restoration is cancelled or an ancestor is collapsed", async () => {
    mocks.get.mockResolvedValueOnce({ status: 200, data: {
      ...snapshot(), lazyRequests: true, requests: [],
    } })
    await remote.initRemoteCollectionIndex()
    mocks.get.mockResolvedValueOnce({ data: detail() })
    const canLoad = vi.fn(() => false)
    expect(await remote.ensureRemoteRequestLocation({ id: "one" }, { canLoad })).toBeUndefined()
    expect(canLoad).toHaveBeenCalledWith("0/0")
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it("stops looking for a deleted request without scanning the workspace", async () => {
    mocks.get.mockResolvedValueOnce({ status: 200, data: {
      ...snapshot(), lazyRequests: true, requests: [],
    } })
    await remote.initRemoteCollectionIndex()
    mocks.get.mockRejectedValueOnce({ response: { status: 404 } })
    expect(await remote.ensureRemoteRequestLocation({ id: "deleted" })).toBeUndefined()
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it("recovers a lost tab association only when the original reference matches", async () => {
    mocks.get.mockResolvedValueOnce({ status: 200, data: {
      ...snapshot(), revision: "lazy-index-1", lazyRequests: true, requests: [],
    } })
    await remote.initRemoteCollectionIndex()
    mocks.get.mockResolvedValueOnce({ data: detail() }).mockResolvedValueOnce({ data: {
      revision: "lazy-index-1", requests: [snapshot().requests[0]], nextCursor: null,
    } })
    expect(await remote.ensureRemoteRequestLocation({ id: "one", _ref_id: "one-ref" }, { recoverDetached: true }))
      .toEqual({ folderPath: "0/0", requestIndex: 0 })
    expect(await remote.ensureRemoteRequestLocation({ id: "one", _ref_id: "copy-ref" }, { recoverDetached: true }))
      .toBeUndefined()
  })

  it("does not attach an unsaved copy to its source or load the source folder", async () => {
    mocks.get.mockResolvedValueOnce({ status: 200, data: {
      ...snapshot(), lazyRequests: true, requests: [],
    } })
    await remote.initRemoteCollectionIndex()
    mocks.get.mockResolvedValueOnce({ data: detail() })
    expect(await remote.ensureRemoteRequestLocation({ id: "one", _ref_id: "copy-ref" }, { recoverDetached: true }))
      .toBeUndefined()
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it("merges concurrently loaded folders without losing either page", async () => {
    mocks.get.mockResolvedValueOnce({ status: 200, data: {
      ...snapshot(), revision: "lazy-index-1", lazyRequests: true, requests: [],
    } })
    await remote.initRemoteCollectionIndex()
    mocks.get.mockImplementation((url: string) => Promise.resolve({ data: {
      revision: "lazy-index-1", nextCursor: null,
      requests: [snapshot().requests.find((row) => row.collectionID === (url.includes("/root/") ? "root" : "folder"))],
    } }))
    await Promise.all([remote.ensureRemoteFolder("folder"), remote.ensureRemoteFolder("root")])
    expect(mocks.state.value.state[0].folders[0].requests[0].id).toBe("one")
    expect(mocks.state.value.state[0].requests[0].id).toBe("two")
    expect(mocks.get).toHaveBeenCalledTimes(3)
  })

  it("honors the server cooldown before retrying a throttled folder", async () => {
    mocks.get.mockResolvedValueOnce({ status: 200, data: {
      ...snapshot(), lazyRequests: true, requests: [],
    } })
    await remote.initRemoteCollectionIndex()
    mocks.get.mockRejectedValueOnce({ response: { status: 429, headers: { "retry-after": "1" } } })
      .mockResolvedValueOnce({ data: {
        revision: "index-1", requests: [snapshot().requests[0]], nextCursor: null,
      } })
    vi.useFakeTimers()
    try {
      const loading = remote.ensureRemoteFolder("folder")
      await vi.advanceTimersByTimeAsync(1)
      expect(mocks.get).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(900)
      expect(mocks.get).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(100)
      await loading
      expect(mocks.get).toHaveBeenCalledTimes(3)
      expect(remote.remoteFolderErrors.has("folder")).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("skips queued restored folders after the sidebar closes", async () => {
    mocks.get.mockResolvedValueOnce({ status: 200, data: {
      ...snapshot(), lazyRequests: true, requests: [],
    } })
    await remote.initRemoteCollectionIndex()
    mocks.get.mockResolvedValueOnce({ data: {
      revision: "index-1", requests: [snapshot().requests[0]], nextCursor: null,
    } })
    const controller = new AbortController()
    const first = remote.ensureRemoteFolder("folder")
    const cancelled = remote.ensureRemoteFolder("root", false, controller.signal)
    controller.abort()
    await expect(cancelled).rejects.toBeDefined()
    await first
    expect(mocks.get).toHaveBeenCalledTimes(2)
    expect(remote.remoteFolderErrors.has("root")).toBe(false)
  })

  it("loads missing summaries before exporting a lazy collection", async () => {
    mocks.get.mockResolvedValueOnce({ status: 200, data: {
      ...snapshot(), revision: "lazy-index-1", lazyRequests: true, requests: [],
    } })
    await remote.initRemoteCollectionIndex()
    mocks.get.mockImplementation((url: string) => Promise.resolve({ data: {
      revision: "lazy-index-1", nextCursor: null,
      requests: snapshot().requests.filter((row) => row.collectionID === (url.includes("/root/") ? "root" : "folder")),
    } }))
    mocks.post.mockResolvedValue({ data: [detail(), detail("two")] })
    const exported = await remote.ensureRemoteCollection(mocks.state.value.state[0])
    expect(() => assertCollectionLoaded(exported)).not.toThrow()
    expect(exported.requests[0].id).toBe("two")
    expect(exported.folders[0].requests[0].id).toBe("one")
  })

  it("loads every page before exporting a partially visible folder", async () => {
    const opening = { ...snapshot(), revision: "lazy-index-1", lazyRequests: true, requests: [] }
    mocks.get.mockResolvedValueOnce({ status: 200, data: opening })
    await remote.initRemoteCollectionIndex()
    mocks.get.mockResolvedValueOnce({ data: {
      revision: "lazy-index-1", requests: [snapshot().requests[0]],
      nextCursor: { orderIndex: 0, id: "one" },
    } }).mockResolvedValueOnce({ data: {
      revision: "lazy-index-1", requests: [{ ...snapshot().requests[0], id: "another", orderIndex: 1 }],
      nextCursor: null,
    } })
    await remote.ensureRemoteFolder("folder")
    mocks.post.mockImplementation((_url: string, payload: { ids: string[] }) =>
      Promise.resolve({ data: payload.ids.map((id) => ({ ...detail(), id })) }))
    const exported = await remote.ensureRemoteCollection(mocks.state.value.state[0].folders[0])
    expect(exported.requests).toHaveLength(2)
    expect(() => assertCollectionLoaded(exported)).not.toThrow()
    expect(mocks.get).toHaveBeenCalledTimes(3)
  })

  it("searches unloaded folders on the server without loading all summaries", async () => {
    mocks.get.mockResolvedValueOnce({ status: 200, data: {
      ...snapshot(), revision: "lazy-index-1", lazyRequests: true, requests: [],
    } })
    await remote.initRemoteCollectionIndex()
    mocks.get.mockResolvedValueOnce({ data: [snapshot().requests[0]] })
    expect(await remote.searchRemoteRequests("One")).toMatchObject([{ id: "one" }])
    expect(mocks.get.mock.calls.at(-1)?.[0]).toMatch(/collections\/search$/)
    expect(mocks.state.value.state[0].folders[0].requests).toEqual([])
  })

  it("loads all summaries with one full index for workspace export", async () => {
    mocks.get.mockResolvedValueOnce({ status: 200, data: {
      ...snapshot(), revision: "lazy-index-1", lazyRequests: true, requests: [],
    } })
    await remote.initRemoteCollectionIndex()
    mocks.get.mockResolvedValueOnce({ data: snapshot() })
    mocks.post.mockResolvedValueOnce({ data: [detail(), detail("two")] })
    const collections = await remote.ensureAllRemoteCollections()
    expect(() => assertCollectionLoaded(collections[0])).not.toThrow()
    expect(collections[0].folders[0].requests[0]).toHaveProperty("body.body", '{"preserved":true}')
    expect(mocks.get.mock.calls.map(([url]) => url)).toEqual([
      expect.stringMatching(/collections\/index$/),
      expect.stringMatching(/collections\/index$/),
    ])
    expect(mocks.post).toHaveBeenCalledTimes(1)
  })

  it("splits a large export into bounded detail requests", async () => {
    const large = snapshot()
    large.requests = Array.from({ length: 201 }, (_, index) => ({
      ...large.requests[0], id: `r-${index}`,
    }))
    const tree = remote.buildRemoteCollectionTree(large)
    mocks.post.mockImplementation((_url: string, payload: { ids: string[] }) =>
      Promise.resolve({ data: payload.ids.map((id) => ({ ...detail(), id })) }))
    const result = await remote.ensureRemoteCollection(tree[0])
    expect(result.folders[0].requests).toHaveLength(201)
    expect(mocks.post.mock.calls.map((call) => call[1].ids.length)).toEqual([200, 1])
  })

  it("coalesces simultaneous opens and preserves the complete body and scripts", async () => {
    const tree = install(), summary = tree[0].folders[0].requests[0]
    mocks.get.mockResolvedValue({ data: detail() })
    const first = remote.ensureRemoteRequest(summary)
    const second = remote.ensureRemoteRequest(summary)
    expect(first).toBe(second)
    const full = await first
    expect(full).toMatchObject({ id: "one", name: "One", preRequestScript: "requestBefore()", body: { body: '{"preserved":true}' } })
    expect(isCollectionRequestSummary(full)).toBe(false)
    expect(mocks.get).toHaveBeenCalledTimes(1)
    expect(mocks.state.value.state[0].folders[0].requests[0]).toBe(full)
    expect(mocks.write).toHaveBeenCalledWith("requests", "one", expect.objectContaining({ revision: "v1", request: full }))
  })

  it("hydrates a single indexed request while retaining other tree branches", async () => {
    mocks.get.mockResolvedValueOnce({ status: 200, data: snapshot() })
    await remote.initRemoteCollectionIndex()
    const rootRequest = mocks.state.value.state[0].requests[0]
    const summary = mocks.state.value.state[0].folders[0].requests[0]
    mocks.get.mockResolvedValueOnce({ data: detail() })
    const full = await remote.ensureRemoteRequest(summary)
    expect(mocks.state.value.state[0].folders[0].requests[0]).toBe(full)
    expect(mocks.state.value.state[0].requests[0]).toBe(rootRequest)
  })

  it("updates an indexed request without replacing an edited request that changed during loading", async () => {
    mocks.get.mockResolvedValueOnce({ status: 200, data: snapshot() })
    await remote.initRemoteCollectionIndex()
    const originalRootRequest = mocks.state.value.state[0].requests[0]
    const summary = mocks.state.value.state[0].folders[0].requests[0]
    let complete!: (value: unknown) => void
    mocks.get.mockReturnValueOnce(new Promise((resolve) => { complete = resolve }))
    const loading = remote.ensureRemoteRequest(summary)
    await Promise.resolve()
    const edited = { ...getDefaultRESTRequest(), id: "one", name: "Unsaved edit" }
    mocks.state.value.state[0].folders[0].requests[0] = edited
    complete({ data: detail() })
    await loading
    expect(mocks.state.value.state[0].folders[0].requests[0]).toBe(edited)
    expect(mocks.state.value.state[0].requests[0]).toBe(originalRootRequest)
  })

  it("reuses a matching cached detail and fetches a detail whose version has changed", async () => {
    const tree = install()
    mocks.read.mockResolvedValue({ revision: "v1", request: detail().request })
    await remote.ensureRemoteRequest(tree[0].folders[0].requests[0])
    expect(mocks.get).not.toHaveBeenCalled()
    mocks.read.mockResolvedValue({ revision: "old", request: detail("two").request })
    mocks.get.mockResolvedValue({ data: detail("two") })
    expect(await remote.ensureRemoteRequest(tree[0].requests[0])).toHaveProperty("query", "query { preserved }")
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it("hydrates a whole subtree in one batch for export/run, including GraphQL requests", async () => {
    const tree = install()
    mocks.post.mockResolvedValue({ data: [detail(), detail("two")] })
    const full = await remote.ensureRemoteCollection(tree[0])
    expect(() => assertCollectionLoaded(full)).not.toThrow()
    expect(full.folders[0].requests[0]).toHaveProperty("body.body", '{"preserved":true}')
    expect(full.requests[0]).toHaveProperty("query", "query { preserved }")
    expect(mocks.post).toHaveBeenCalledTimes(1)
    expect(new Set(mocks.post.mock.calls[0][1].ids)).toEqual(new Set(["one", "two"]))
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it("recovers a corrupt detail cache by fetching the authoritative request", async () => {
    const tree = install()
    mocks.read.mockResolvedValue({ revision: "v1", request: { broken: true } })
    mocks.get.mockResolvedValue({ data: detail() })
    const full = await remote.ensureRemoteRequest(tree[0].folders[0].requests[0])
    expect(full).toHaveProperty("body.body", '{"preserved":true}')
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it("uses configured batches above the old 1000-item ceiling", async () => {
    const index = snapshot()
    const ids = Array.from({ length: 1001 }, (_, index) => `request-${index}`)
    index.detailBatchSize = ids.length
    index.requests = ids.map((id) => ({ ...index.requests[0], id }))
    mocks.get.mockResolvedValueOnce({ status: 200, data: index })
    await remote.initRemoteCollectionIndex()
    mocks.post.mockResolvedValueOnce({ data: ids.map((id) => ({ ...detail(), id })) })

    const result = await remote.ensureRemoteCollection(mocks.state.value.state[0])
    expect(result.folders[0].requests).toHaveLength(ids.length)
    expect(mocks.post).toHaveBeenCalledTimes(1)
    expect(mocks.post.mock.calls[0][1].ids).toEqual(ids)
  })

  it("keeps all summaries intact if a detail batch is incomplete", async () => {
    const tree = install()
    mocks.post.mockResolvedValue({ data: [detail()] })
    await expect(remote.ensureRemoteCollection(tree[0])).rejects.toThrow("未完整加载")
    expect(mocks.set).not.toHaveBeenCalled()
    expect(() => assertCollectionLoaded(mocks.state.value.state[0])).toThrow()
    expect(remote.remoteRequestLoading.size).toBe(0)
  })

  it("does not overwrite an edited full request while an older read is in flight", async () => {
    const tree = install(), summary = tree[0].folders[0].requests[0]
    let complete!: (value: unknown) => void
    mocks.get.mockReturnValue(new Promise((resolve) => { complete = resolve }))
    const operation = remote.ensureRemoteRequest(summary)
    await Promise.resolve()
    const edited = { ...getDefaultRESTRequest(), id: "one", name: "Unsaved edit" }
    tree[0].folders[0].requests[0] = edited
    complete({ data: detail() })
    await operation
    expect(mocks.state.value.state[0].folders[0].requests[0]).toBe(edited)
  })

  it("keeps pending device-only work without caching every server request", () => {
    const tree = install()
    const local = { ...getDefaultRESTRequest(), _ref_id: "pending", name: "Not uploaded" }
    tree[0].folders[0].requests.push(local)
    const pending = collectPendingCollections(tree)
    expect(pending[0].folders[0].requests).toEqual([local])
    expect(JSON.stringify(pending)).not.toContain("__workbenchSummary")
    const merged = mergePendingCollections(remote.buildRemoteCollectionTree(snapshot()), pending)
    expect(merged[0].folders[0].requests.map((request: HoppCollection["requests"][number]) => request.name)).toEqual(["One", "Not uploaded"])
  })
})
