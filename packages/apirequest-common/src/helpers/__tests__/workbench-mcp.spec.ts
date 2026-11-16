import { afterEach, describe, expect, it, vi } from "vitest"
import { workbenchMcpAPI } from "../workbench-mcp"

vi.mock("~/platform", () => ({
  platform: { auth: { performAuthInit: vi.fn() } },
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("workbench API routing", () => {
  it("preserves the configured reverse proxy prefix for reads and writes", async () => {
    vi.stubEnv("VITE_WORKBENCH_NATIVE", "")
    vi.stubEnv("VITE_BACKEND_API_URL", "https://example.test/preview/v1/")
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })
    vi.stubGlobal("fetch", fetcher)

    await expect(workbenchMcpAPI("automation/plans")).resolves.toEqual({
      ok: true,
    })
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://example.test/preview/v1/workbench-mcp/automation/plans",
      expect.objectContaining({ method: "GET", credentials: "include" })
    )
    await workbenchMcpAPI("automation/plans", { name: "Example" })
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://example.test/preview/v1/workbench-mcp/automation/plans",
      expect.objectContaining({ method: "POST", body: '{"name":"Example"}' })
    )
  })
})
