import { beforeEach, describe, expect, it, vi } from "vitest"
import * as E from "fp-ts/Either"
import { refreshHistory } from ".."
import {
  hasErrorFetchingHistoryStoreStatus,
  isFetchingHistoryStoreStatus,
  isHistoryStoreEnabled,
} from "../status"

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  entries: vi.fn(),
  setREST: vi.fn(),
  setGQL: vi.fn(),
}))
vi.mock("~/platform", () => ({
  platform: {
    auth: { getCurrentUser: () => ({ uid: "local" }) },
    sync: { history: { getHistoryStoreStatus: mocks.status } },
  },
}))
vi.mock("../api", () => ({ getUserHistoryEntries: mocks.entries }))
vi.mock("../sync", () => ({ restHistorySyncer: {}, gqlHistorySyncer: {} }))
vi.mock("~/newstore/history", () => ({
  restHistoryStore: { value: { state: [] } },
  graphqlHistoryStore: { value: { state: [] } },
  setRESTHistoryEntries: mocks.setREST,
  setGraphqlHistoryEntries: mocks.setGQL,
}))

beforeEach(() => {
  vi.clearAllMocks()
  isHistoryStoreEnabled.value = false
  hasErrorFetchingHistoryStoreStatus.value = false
  mocks.status.mockResolvedValue(true)
  mocks.entries.mockResolvedValue(
    E.right({ me: { RESTHistory: [], GQLHistory: [] } })
  )
})

describe("history refresh", () => {
  it("reports unavailable status as an error and retries without losing existing entries", async () => {
    isHistoryStoreEnabled.value = true
    mocks.status.mockRejectedValueOnce(new Error("Offline"))
    await refreshHistory()
    expect(hasErrorFetchingHistoryStoreStatus.value).toBe(true)
    expect(isHistoryStoreEnabled.value).toBe(true)
    expect(mocks.setREST).not.toHaveBeenCalled()
    await refreshHistory()
    expect(hasErrorFetchingHistoryStoreStatus.value).toBe(false)
    expect(isFetchingHistoryStoreStatus.value).toBe(false)
    expect(mocks.setREST).toHaveBeenCalledWith([])
  })
  it("preserves an explicitly disabled policy and existing data", async () => {
    mocks.status.mockResolvedValueOnce(false)
    await refreshHistory()
    expect(isHistoryStoreEnabled.value).toBe(false)
    expect(hasErrorFetchingHistoryStoreStatus.value).toBe(false)
    expect(mocks.entries).not.toHaveBeenCalled()
    expect(mocks.setREST).not.toHaveBeenCalled()
  })
  it("reports a failed entries query separately from an empty history", async () => {
    mocks.entries.mockResolvedValueOnce(
      E.left({ error: "Network unavailable" })
    )
    await refreshHistory()
    expect(hasErrorFetchingHistoryStoreStatus.value).toBe(true)
    expect(mocks.setREST).not.toHaveBeenCalled()
  })
  it("keeps loading visible until the entries query finishes", async () => {
    let complete!: (value: unknown) => void
    mocks.entries.mockReturnValueOnce(
      new Promise((resolve) => (complete = resolve))
    )
    const pending = refreshHistory()
    await vi.waitFor(() => expect(mocks.entries).toHaveBeenCalled())
    expect(isFetchingHistoryStoreStatus.value).toBe(true)
    complete(E.right({ me: { RESTHistory: [], GQLHistory: [] } }))
    await pending
    expect(isFetchingHistoryStoreStatus.value).toBe(false)
  })
})
