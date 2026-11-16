import { beforeEach, describe, expect, it, vi } from "vitest"
import { Subject } from "rxjs"
import { getDefaultRESTRequest } from "@apirequest/data"
import { executedResponses$ } from "~/helpers/RequestRunner"
import {
  addRESTHistoryEntry,
  restHistoryStore,
  setRESTHistoryEntries,
} from "../history"
import { applySetting } from "../settings"
import { isHistoryStoreEnabled } from "~/lib/sync/history/status"

vi.mock("~/helpers/RequestRunner", () => ({
  executedResponses$: new Subject(),
}))
vi.mock("~/helpers/workbench-history-results", () => ({
  captureHistoryResult: (entry: unknown) => entry,
}))

const response = () => ({
  req: getDefaultRESTRequest(),
  statusCode: 200,
  statusText: "OK",
  meta: { responseDuration: 10 },
  headers: [],
  body: new ArrayBuffer(0),
})

beforeEach(() => {
  isHistoryStoreEnabled.value = true
  setRESTHistoryEntries([])
  applySetting("RECORD_HISTORY", true)
})

describe("recording completed requests", () => {
  it("also respects a disabled backend history policy", () => {
    isHistoryStoreEnabled.value = false
    executedResponses$.next(response() as never)
    expect(restHistoryStore.value.state).toHaveLength(0)
  })
  it("keeps old entries when paused and records only new requests after resuming", () => {
    addRESTHistoryEntry({
      v: 1,
      request: getDefaultRESTRequest(),
      star: false,
      responseMeta: { statusCode: 201, duration: 1 },
    })
    applySetting("RECORD_HISTORY", false)
    executedResponses$.next(response() as never)
    expect(restHistoryStore.value.state).toHaveLength(1)
    expect(restHistoryStore.value.state[0].responseMeta.statusCode).toBe(201)
    applySetting("RECORD_HISTORY", true)
    executedResponses$.next(response() as never)
    expect(restHistoryStore.value.state).toHaveLength(2)
    expect(restHistoryStore.value.state[0].responseMeta.statusCode).toBe(200)
  })
})
