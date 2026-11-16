import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  archive: vi.fn(),
  nativeAPI: vi.fn(),
}))
vi.mock("~/platform", () => ({
  platform: {
    localDesktop: false,
    auth: { localSessionState: { value: "ready" } },
  },
}))
vi.mock("../native-workbench-history", () => ({
  archiveNativeHistory: mocks.archive,
  nativeHistoryAPI: mocks.nativeAPI,
  nativeHistoryURL: (path: string) => path,
}))

const snapshot = () => ({
  statusCode: 200,
  statusText: "OK",
  duration: 4,
  headers: [
    { key: "content-type", value: "application/octet-stream" },
    { key: "x-request-id", value: "fixture" },
  ],
  body: new Uint8Array([0, 1, 255]),
})
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubGlobal("fetch", mocks.fetch)
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ enabled: true }),
  })
  mocks.nativeAPI.mockResolvedValue({ enabled: true })
  Object.assign(window, { __APIREQUEST_NATIVE__: false })
})
afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, "__APIREQUEST_NATIVE__")
})

describe("complete history storage", () => {
  it("restores full storage again if an older configuration is imported between requests", async () => {
    let enabled = false
    let saved = 0
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/policy")) enabled = true
      else if (enabled) saved++
      return { ok: enabled, json: async () => ({ enabled }) }
    })
    const { uploadHistoryResult } = await import("../workbench-history-results")
    await uploadHistoryResult("first", snapshot())
    enabled = false
    await uploadHistoryResult("second", snapshot())
    expect(saved).toBe(2)
  })
  it("enables storage for older configurations and saves full response bytes and headers", async () => {
    const { uploadHistoryResult } = await import("../workbench-history-results")
    await Promise.all([
      uploadHistoryResult("first", snapshot()),
      uploadHistoryResult("second", snapshot()),
    ])
    const calls = mocks.fetch.mock.calls
    expect(calls).toHaveLength(3)
    expect(calls[0][0]).toMatch(/\/policy$/)
    expect(calls[0][1].method).toBe("PUT")
    expect(JSON.parse(calls[0][1].body)).toEqual({ enabled: true })
    for (const [, options] of calls.slice(1)) {
      expect(options.method).toBe("PUT")
      const bytes = await new Promise<Uint8Array>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () =>
          resolve(new Uint8Array(reader.result as ArrayBuffer))
        reader.onerror = reject
        reader.readAsArrayBuffer(options.body)
      })
      const newline = bytes.indexOf(10)
      const metadata = JSON.parse(
        new TextDecoder().decode(bytes.subarray(0, newline))
      )
      expect(metadata.statusCode).toBe(200)
      expect(metadata.headers).toEqual(snapshot().headers)
      expect(Array.from(bytes.subarray(newline + 1))).toEqual([0, 1, 255])
    }
  })

  it("prepares native response storage before archiving a complete snapshot", async () => {
    Object.assign(window, { __APIREQUEST_NATIVE__: true })
    const { uploadHistoryResult } = await import("../workbench-history-results")
    const response = snapshot()
    await uploadHistoryResult("native", response)
    expect(mocks.nativeAPI).toHaveBeenCalledWith(
      "policy",
      expect.objectContaining({ method: "PUT", body: '{"enabled":true}' })
    )
    expect(mocks.archive).toHaveBeenCalledWith("native", response)
    expect(mocks.nativeAPI.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.archive.mock.invocationCallOrder[0]
    )
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it("can retry preparation after a storage failure", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("Storage unavailable"))
    const { ensureFullHistoryStorage } =
      await import("../workbench-history-results")
    await expect(ensureFullHistoryStorage()).rejects.toThrow(
      "Storage unavailable"
    )
    await expect(ensureFullHistoryStorage()).resolves.toBeUndefined()
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })
})
