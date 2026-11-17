import { beforeEach, describe, expect, it, vi } from "vitest"
import { nativeMcpAPI } from "../native-workbench-mcp"
import {
  applyConfig,
  configurations,
  prepareChange,
  newConfigID,
} from "../native-workbench-config"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }))
vi.mock("../native-workbench-config", () => ({
  applyConfig: vi.fn(),
  configurations: vi.fn(),
  prepareChange: vi.fn(),
  domains: { parse: (value: string) => value },
  nativeGuide: {},
  newConfigID: vi.fn(),
  publishedDocumentation: vi.fn(),
  readLocal: vi.fn(),
  redact: vi.fn(),
  writeLocal: vi.fn(),
}))

const before = { id: "plan", name: "Plan", collectionID: "collection" }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(configurations).mockResolvedValue([{ id: "plan", data: before }])
  vi.mocked(prepareChange).mockResolvedValue({
    ...before,
    config: { iterations: 3 },
  })
})

describe("native automation settings", () => {
  it("validates and saves edits through the existing local configuration service", async () => {
    await nativeMcpAPI("configs/automation/plan", {
      environmentID: "environment",
      config: { iterations: 3, delay: 100 },
    })
    expect(prepareChange).toHaveBeenCalledWith(
      {
        entity: "automation",
        operation: "update",
        id: "plan",
        data: {
          environmentID: "environment",
          config: { iterations: 3, delay: 100 },
        },
      },
      before
    )
    expect(applyConfig).toHaveBeenCalledTimes(1)
  })

  it("does not allow this route to write arbitrary configuration fields", async () => {
    await expect(
      nativeMcpAPI("configs/automation/plan", {
        name: "Changed",
        config: { iterations: 3 },
      })
    ).rejects.toThrow()
    expect(applyConfig).not.toHaveBeenCalled()
  })

  it("keeps a read free of writes", async () => {
    await expect(
      nativeMcpAPI("configs/automation/plan", undefined)
    ).resolves.toEqual(before)
    expect(applyConfig).not.toHaveBeenCalled()
  })

  it("creates a local plan using the existing validated configuration service", async () => {
    vi.mocked(configurations).mockImplementation(async (entity) =>
      entity === "collection"
        ? [{ id: "collection", data: { id: "collection", name: "Suite" } }]
        : []
    )
    vi.mocked(newConfigID).mockReturnValue("new-plan")
    await nativeMcpAPI("configs/automation", {
      collectionID: "collection",
      requestID: null,
      config: { iterations: 2, delay: 0 },
    })
    expect(prepareChange).toHaveBeenCalledWith({
      entity: "automation",
      operation: "create",
      id: "new-plan",
      data: {
        name: "Suite",
        collectionID: "collection",
        requestID: undefined,
        config: { iterations: 2, delay: 0 },
      },
    })
    expect(applyConfig).toHaveBeenCalledOnce()
  })

  it("clears the previous request when changing the target to a group", async () => {
    await nativeMcpAPI("configs/automation/plan", {
      collectionID: "group",
      requestID: null,
      config: {},
    })
    expect(prepareChange).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { collectionID: "group", requestID: undefined, config: {} },
      }),
      before
    )
  })
})
