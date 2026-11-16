import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }))
vi.mock("~/kernel/store", () => ({ Store: { get: mocks.get, set: mocks.set } }))
vi.mock("~/platform", () => ({ platform: { localDesktop: true } }))
vi.mock("~/services/persistence", () => ({
  STORE_NAMESPACE: "persistence.v1",
  PersistenceService: class {},
}))
vi.mock("~/modules/dioc", () => ({ getService: vi.fn() }))
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.get.mockResolvedValue({
    _tag: "Right",
    right: {
      request: [
        { id: "legacy", name: "Old case", expectedStatus: 401, variables: {} },
      ],
    },
  })
  mocks.set.mockResolvedValue({ _tag: "Right", right: undefined })
})
describe("persisted request cases", () => {
  it("reads legacy desktop cases and writes complete cases under the existing key", async () => {
    const { useWorkbenchRequestCases } =
      await import("../workbenchRequestCases")
    const storage = useWorkbenchRequestCases()
    await storage.ready
    expect(storage.cases.value.request[0].assertions[0].expected).toBe("401")
    await storage.update("request", (entries) =>
      entries.map((entry) => ({ ...entry, name: "Updated" }))
    )
    expect(mocks.set).toHaveBeenCalledWith(
      "persistence.v1",
      "workbench.request-cases.v1",
      expect.objectContaining({
        request: [
          expect.objectContaining({ name: "Updated", scripts: "disabled" }),
        ],
      })
    )
  })
  it("preserves the current cases when a write fails, including in-place mutators, and allows retry", async () => {
    const { useWorkbenchRequestCases } =
      await import("../workbenchRequestCases")
    const storage = useWorkbenchRequestCases()
    await storage.ready
    mocks.set.mockResolvedValueOnce({
      _tag: "Left",
      left: { message: "disk full" },
    })
    await expect(
      storage.update("request", (entries) => {
        entries[0].name = "Failed"
        return entries
      })
    ).rejects.toThrow("disk full")
    expect(storage.cases.value.request[0].name).toBe("Old case")
    await storage.update("request", (entries) =>
      entries.map((entry) => ({ ...entry, name: "Retried" }))
    )
    expect(storage.cases.value.request[0].name).toBe("Retried")
  })
  it("does not overwrite unreadable stored data", async () => {
    mocks.get.mockResolvedValue({ _tag: "Right", right: { request: "broken" } })
    const { useWorkbenchRequestCases } =
      await import("../workbenchRequestCases")
    const storage = useWorkbenchRequestCases()
    await expect(storage.ready).rejects.toThrow()
    expect(mocks.set).not.toHaveBeenCalled()
  })
})
