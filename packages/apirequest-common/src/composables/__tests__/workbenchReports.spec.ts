import { beforeEach, describe, expect, it, vi } from "vitest"
import * as E from "fp-ts/Either"
import type { WorkbenchReport } from "../workbenchReports"
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), legacy: vi.fn() }))
vi.mock("~/kernel/store", () => ({
  NATIVE_STORE_SCOPE: "localhost.apirequest.store",
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("~/platform", () => ({ platform: { localDesktop: true } }))
vi.mock("~/services/persistence", () => ({ PersistenceService: class {} }))
vi.mock("~/modules/dioc", () => ({ getService: () => ({ get: mocks.legacy }) }))
const report = (id: string, status = "completed"): WorkbenchReport => ({
  id,
  kind: "automation",
  name: id,
  createdAt: new Date(1700000000000 + Number(id || 0)).toISOString(),
  summary: { completed: 1, failed: 1, elapsedMs: 12 },
  automation: { status, passedTests: 0, failedTests: 1, totalTests: 1 },
  steps: [
    {
      name: "failed",
      passed: false,
      errors: ["TESTS_FAILING"],
      errorDetails: [{ code: "error", data: { message: "original failure" } }],
      assertions: [
        {
          descriptor: "assert",
          passed: 0,
          failed: 1,
          expectResults: [{ status: "fail", message: "complete message" }],
        },
      ],
    },
  ],
})
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.legacy.mockResolvedValue(E.right(undefined))
  mocks.invoke.mockImplementation(async (_command, { action }) =>
    action.type === "page" ? [] : undefined
  )
})
describe("durable automation reports", () => {
  it("migrates every legacy report and retains more than 20 full failed reports across restart", async () => {
    const disk = new Map<string, WorkbenchReport>()
    mocks.legacy.mockResolvedValue(
      E.right(
        JSON.stringify(Array.from({ length: 25 }, (_, i) => report(String(i))))
      )
    )
    mocks.invoke.mockImplementation(async (_command, { action }) => {
      if (action.type === "page")
        return [...disk.values()].slice(action.skip, action.skip + action.take)
      disk.set(action.key, structuredClone(action.value))
    })
    let storage = (await import("../workbenchReports")).useWorkbenchReports()
    await storage.ready
    await Promise.all(
      Array.from({ length: 110 }, (_, i) => storage.add(report(String(25 + i))))
    )
    expect(storage.reports.value).toHaveLength(135)
    vi.resetModules()
    storage = (await import("../workbenchReports")).useWorkbenchReports()
    await storage.ready
    expect(storage.reports.value).toHaveLength(135)
    expect(storage.reports.value.find((item) => item.id === "0")).toEqual(
      report("0")
    )
  })
  it("updates a running report in place and keeps failure details when the process is interrupted", async () => {
    mocks.invoke.mockImplementation(async (_command, { action }) =>
      action.type === "page" ? [report("1", "paused")] : undefined
    )
    const storage = (await import("../workbenchReports")).useWorkbenchReports()
    await storage.ready
    expect(storage.reports.value[0].automation?.status).toBe("interrupted")
    expect(storage.reports.value[0].steps).toEqual(report("1").steps)
    await storage.add(report("1"))
    expect(storage.reports.value).toHaveLength(1)
  })
  it("surfaces failed writes, keeps the report available for export and allows a later retry", async () => {
    const storage = (await import("../workbenchReports")).useWorkbenchReports()
    await storage.ready
    mocks.invoke.mockRejectedValueOnce(new Error("disk full"))
    await expect(storage.add(report("1"))).rejects.toThrow("disk full")
    expect(storage.storageError.value).toBe("disk full")
    expect(storage.reports.value[0]).toEqual(report("1"))
    await storage.add(report("1"))
    expect(storage.storageError.value).toBe("")
  })
  it("does not replace unreadable history with an empty history", async () => {
    mocks.legacy.mockResolvedValue(E.left({ message: "read failed" }))
    const storage = (await import("../workbenchReports")).useWorkbenchReports()
    await expect(storage.ready).rejects.toThrow("read failed")
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(storage.storageError.value).toBe("read failed")
    await expect(storage.add(report("1"))).rejects.toThrow("read failed")
    expect(storage.reports.value[0]).toEqual(report("1"))
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

it("deletes the full saved report and prevents legacy migration or a late callback from restoring it", async () => {
  const disk = new Map<string, any>()
  mocks.legacy.mockResolvedValue(
    E.right(JSON.stringify([report("1"), report("2")]))
  )
  mocks.invoke.mockImplementation(async (_command, { action }) => {
    if (action.type === "page")
      return [...disk.values()].slice(action.skip, action.skip + action.take)
    disk.set(action.key, structuredClone(action.value))
  })
  let storage = (await import("../workbenchReports")).useWorkbenchReports()
  await storage.ready
  await storage.remove("1")
  expect(disk.get("1")).toEqual({ id: "1", deleted: true })
  expect(storage.reports.value.map((item) => item.id)).toEqual(["2"])
  await storage.add(report("1"))
  expect(storage.reports.value.map((item) => item.id)).toEqual(["2"])
  vi.resetModules()
  storage = (await import("../workbenchReports")).useWorkbenchReports()
  await storage.ready
  expect(storage.reports.value.map((item) => item.id)).toEqual(["2"])
})

it("keeps the report if deleting fails and rejects deletion of an active run", async () => {
  const storage = (await import("../workbenchReports")).useWorkbenchReports()
  await storage.ready
  await storage.add(report("1"))
  mocks.invoke.mockRejectedValueOnce(new Error("disk write failed"))
  await expect(storage.remove("1")).rejects.toThrow("disk write failed")
  expect(storage.reports.value[0]).toEqual(report("1"))
  await storage.add(report("2", "running"))
  await expect(storage.remove("2")).rejects.toThrow(
    "Cannot delete an active report"
  )
  await storage.remove("1")
  expect(storage.reports.value.map((item) => item.id)).toEqual(["2"])
})

it("allows deleting paused and interrupted reports", async () => {
  const storage = (await import("../workbenchReports")).useWorkbenchReports()
  await storage.ready
  for (const status of ["paused", "interrupted"]) {
    await storage.add(report("1", status))
    await storage.remove("1")
    expect(storage.reports.value).toHaveLength(0)
  }
})
