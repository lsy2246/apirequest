import { afterEach, beforeEach, expect, it, vi } from "vitest"

vi.mock("~/platform", () => ({
  platform: { auth: { performAuthInit: vi.fn() } },
}))

import { listWorkbenchConfigs } from "../workbench-mcp"

beforeEach(() => vi.stubEnv("VITE_BACKEND_API_URL", "https://example.test/v1"))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it("has distinct requests for first and subsequent configuration pages", async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ items: ["a"], nextOffset: 100 }))
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ items: ["b"], nextOffset: null }))
    )
  vi.stubGlobal("fetch", send)
  expect(await listWorkbenchConfigs("automation")).toEqual(["a", "b"])
  expect(send.mock.calls[1][0]).toMatch(/configs\/automation\?offset=100$/)
})

it("fails clearly instead of repeatedly requesting the same offset", async () => {
  const send = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response(JSON.stringify({ items: ["a"], nextOffset: 100 }))
    )
  vi.stubGlobal("fetch", send)
  await expect(listWorkbenchConfigs("automation")).rejects.toThrow("下一页")
  expect(send).toHaveBeenCalledTimes(2)
})
