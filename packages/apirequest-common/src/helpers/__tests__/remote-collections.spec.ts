import { beforeEach, describe, expect, it, vi } from "vitest"
import { getDefaultGQLRequest, getDefaultRESTRequest, makeCollection, type HoppCollection } from "@apirequest/data"
import { assertCollectionLoaded, assertCollectionRequestLoaded, collectPendingCollections, isCollectionRequestSummary, mergePendingCollections } from "../collection-summary"
import type { RemoteCollectionIndex } from "../remote-collections"

const mocks = vi.hoisted(() => ({
  state: { value: { state: [] as HoppCollection[] } },
  get: vi.fn(), post: vi.fn(), read: vi.fn(), write: vi.fn(), set: vi.fn(),
}))
vi.mock("axios", () => ({ default: { get: mocks.get, post: mocks.post } }))
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
    expect(merged[0].folders[0].requests.map((request) => request.name)).toEqual(["One", "Not uploaded"])
  })
})
