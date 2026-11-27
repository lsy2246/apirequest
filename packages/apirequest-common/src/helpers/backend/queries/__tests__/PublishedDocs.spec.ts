import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getPublishedDocBySlugREST } from "../PublishedDocs"
vi.mock("~/helpers/backend/GQLClient", () => ({ runGQLQuery: vi.fn() }))
vi.mock("~/helpers/backend/operation", () => ({ backendOperation: vi.fn() }))
const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
describe("public documentation error classification", () => {
  it.each([
    [404, "not_found"],
    [410, "not_found"],
    [401, "unauthorized"],
    [403, "unauthorized"],
    [429, "load_failed"],
    [500, "load_failed"],
    [503, "load_failed"],
  ])("classifies HTTP %s as %s", async (status, kind) => {
    fetchMock.mockResolvedValue({ ok: false, status })
    expect(await getPublishedDocBySlugREST("example")()).toEqual({
      _tag: "Left",
      left: `published_docs/${kind}`,
    })
  })
  it("recovers from a network failure on the next request", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Offline"))
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ title: "Recovered" }),
    })
    expect(await getPublishedDocBySlugREST("example", "v1")()).toEqual({
      _tag: "Left",
      left: "published_docs/load_failed",
    })
    expect(await getPublishedDocBySlugREST("example", "v1")()).toEqual({
      _tag: "Right",
      right: { title: "Recovered" },
    })
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/published-docs/example/v1")
    )
  })
  it("treats an unreadable response as a retryable load failure", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Invalid JSON")
      },
    })
    expect(await getPublishedDocBySlugREST("example")()).toMatchObject({
      left: "published_docs/load_failed",
    })
  })
})
