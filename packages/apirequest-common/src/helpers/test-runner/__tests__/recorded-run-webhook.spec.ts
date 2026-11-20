import { beforeEach, describe, expect, it, vi } from "vitest"
import { startRecordedRun } from "../recorded-run"
import { makeCollection } from "@apirequest/data"

const mocks = vi.hoisted(() => ({ add: vi.fn(), api: vi.fn(), run: vi.fn() }))
vi.mock("~/modules/dioc", () => ({
  getService: () => ({ runTests: mocks.run }),
}))
vi.mock("~/services/test-runner/test-runner.service", () => ({
  TestRunnerService: class {},
}))
vi.mock("~/composables/workbenchReports", () => ({
  useWorkbenchReports: () => ({ add: mocks.add }),
}))
vi.mock("~/helpers/workbench-mcp", () => ({
  workbenchMcpAPI: mocks.api,
  workbenchSchedulesAvailable: () => true,
}))
vi.mock("../report", () => ({
  collectReportSteps: () => [],
  reportError: (value: unknown) => value,
}))
vi.mock("../saved-report", () => ({ savedReportTab: vi.fn() }))
const collection = makeCollection({
  name: "Manual plan",
  folders: [],
  requests: [],
})
const config = {
  iterations: 1,
  delay: 0,
  persistResponses: true,
  stopOnError: false,
  keepVariableValues: false,
  webhook: { enabled: true, includeErrorDetails: true },
}
const tab = (status: string) =>
  ({
    id: "tab",
    document: {
      status,
      iterationResults: [],
      collectionID: "group",
      environmentName: "Local",
      testRunnerMeta: {
        totalRequests: 0,
        passedTests: 0,
        failedTests: 0,
        totalTests: 0,
      },
    },
  }) as any
beforeEach(() => {
  vi.clearAllMocks()
  mocks.add.mockResolvedValue(undefined)
  mocks.api.mockResolvedValue({})
  mocks.run.mockImplementation(async (_tab, _collection, options) => {
    await options.onProgress()
    return "done"
  })
})
describe("manual automation Webhook completion", () => {
  it("sends the final report through the backend once after persistence", async () => {
    await expect(
      startRecordedRun(tab("completed"), collection, config)
    ).resolves.toBe("done")
    expect(mocks.api).toHaveBeenCalledOnce()
    expect(mocks.api.mock.calls[0]).toEqual([
      "automation/webhook/notify",
      expect.objectContaining({
        webhook: config.webhook,
        report: expect.objectContaining({ name: "Manual plan" }),
      }),
    ])
    expect(mocks.add.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.api.mock.invocationCallOrder[0]
    )
  })
  it.each(["paused", "running", "stopped"])(
    "does not notify an unfinished %s run",
    async (status) => {
      await startRecordedRun(tab(status), collection, config)
      expect(mocks.api).not.toHaveBeenCalled()
    }
  )
  it("honors opt-out and isolates delivery submission errors from test outcomes", async () => {
    await startRecordedRun(tab("completed"), collection, {
      ...config,
      webhook: { ...config.webhook, enabled: false },
    })
    expect(mocks.api).not.toHaveBeenCalled()
    mocks.api.mockRejectedValue(new Error("offline"))
    await expect(
      startRecordedRun(tab("completed"), collection, config)
    ).resolves.toBe("done")
    expect(mocks.add).toHaveBeenLastCalledWith(
      expect.objectContaining({
        notification: { status: "failed", attempts: 0 },
      })
    )
  })
})
