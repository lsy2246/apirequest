import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import { getDefaultRESTRequest, makeCollection } from "@apirequest/data"
import * as E from "fp-ts/Either"
const disk = vi.hoisted(() => ({
  values: new Map<string, any>(),
  add: vi.fn(),
  pauseOnce: true,
}))
vi.mock("~/composables/workbenchReports", () => ({
  useWorkbenchReports: () => ({ add: disk.add }),
}))
vi.mock("~/helpers/RequestRunner", () => ({
  executedResponses$: { subscribe: vi.fn() },
  runTestRunnerRequest: vi.fn(),
  captureInitialEnvironmentState: () => {
    const selected = [
      {
        key: "token",
        initialValue: "",
        currentValue: "initial",
        secret: false,
      },
    ]
    return {
      initialGlobalEnvs: [],
      initialSelectedEnvs: selected,
      initialEnvID: "env",
      initialEnvironmentIndex: { type: "NO_ENV_SELECTED" },
      initialEnvName: "Snapshot",
      initialEnvs: { global: [], selected, temp: [] },
      initialEnvsForComparison: { global: [], selected },
    }
  },
}))
import { runTestRunnerRequest } from "~/helpers/RequestRunner"
import {
  startRecordedRun,
  resumeRecordedRun,
} from "~/helpers/test-runner/recorded-run"
import { emptyRunnerTestResult } from "~/helpers/test-runner/report"
import { getService } from "~/modules/dioc"
import { TestRunnerService } from "../test-runner.service"
const service = getService(TestRunnerService),
  execute = vi.mocked(runTestRunnerRequest)
const config = {
  iterations: 1,
  delay: 0,
  stopOnError: false,
  persistResponses: true,
  keepVariableValues: false,
}
const request = getDefaultRESTRequest()
function response(changes = false) {
  const tests = emptyRunnerTestResult()
  if (changes)
    tests.envDiff.selected.updations = [
      {
        key: "token",
        initialValue: "",
        currentValue: "saved-token",
        secret: false,
        previousValue: "initial",
      },
    ]
  return E.right({
    updatedRequest: request,
    testResult: tests,
    response: {
      type: "success",
      statusCode: 200,
      statusText: "OK",
      headers: [],
      body: new TextEncoder().encode("saved body").buffer,
      meta: { responseDuration: 5, responseSize: 10 },
    },
  }) as any
}
async function pausedReport(dataset = false) {
  const collection = makeCollection({
    name: "Frozen plan",
    folders: [],
    requests: [
      { ...request, name: "First" },
      { ...request, name: "Second" },
    ],
    auth: { authType: "none", authActive: false },
    headers: [],
    variables: [],
    preRequestScript: "",
    testScript: "",
  })
  const runConfig = {
    ...config,
    ...(dataset
      ? {
          dataset: {
            fileName: "rows.json",
            type: "json" as const,
            rows: [{ n: "1" }, { n: "2" }],
          },
        }
      : {}),
  }
  const tab = {
    id: "recovery-tab",
    document: {
      type: "test-runner",
      collection,
      collectionType: "my-collections",
      collectionID: "frozen",
      config: runConfig,
      status: "idle",
      request: null,
      isDirty: false,
      testRunnerMeta: {},
    },
  } as any
  execute.mockResolvedValue(response()).mockResolvedValueOnce(response(true))
  const done = startRecordedRun(tab, collection, runConfig)
  await vi.waitFor(() =>
    expect([...disk.values.values()].at(-1)?.automation.status).toBe("paused")
  )
  // Simulate disposing the old process: its in-memory runner no longer exists.
  service.stopRun(tab.id)
  await done
  return JSON.parse(JSON.stringify([...disk.values.values()].at(-1)))
}
beforeEach(() => {
  vi.clearAllMocks()
  disk.values.clear()
  disk.pauseOnce = true
  disk.add.mockImplementation(async (report) => {
    disk.values.set(report.id, JSON.parse(JSON.stringify(report)))
    if (
      disk.pauseOnce &&
      report.summary.completed === 1 &&
      report.automation.status === "running"
    ) {
      disk.pauseOnce = false
      service.pauseRun(report.runTabID)
    }
  })
})
afterEach(() => {
  service.stopRun("recovery-tab")
})
describe("persisted runner recovery", () => {
  it("continues the same report with frozen variables and dataset position without repeating completed requests", async () => {
    const report = await pausedReport(true)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(report.recovery.nextRequest).toBe(1)
    expect(
      report.recovery.environment.initialEnvs.selected[0].currentValue
    ).toBe("saved-token")
    resumeRecordedRun(report)
    await vi.waitFor(() =>
      expect(disk.values.get(report.id).automation.status).toBe("completed")
    )
    expect(execute.mock.calls.map((args) => args[0].name)).toEqual([
      "First",
      "Second",
      "First",
      "Second",
    ])
    expect(execute.mock.calls[1][3].initialEnvs.selected[0].currentValue).toBe(
      "saved-token"
    )
    expect(execute.mock.calls[2][3].initialEnvs.selected[0].currentValue).toBe(
      "initial"
    )
    expect(execute.mock.calls[1][6][0].currentValue).toBe("1")
    expect(execute.mock.calls[2][6][0].currentValue).toBe("2")
    const saved = disk.values.get(report.id)
    expect(saved.steps).toHaveLength(4)
    expect(saved.createdAt).toBe(report.createdAt)
    expect(saved.recovery).toBeUndefined()
    expect(disk.values.size).toBe(1)
  })
  it("requires a decision for an unknown request and records a skip without sending it again", async () => {
    const report = await pausedReport()
    report.automation.status = "interrupted"
    report.recovery.inFlight = { name: "Second", iteration: 1 }
    expect(() => resumeRecordedRun(report)).toThrow("Choose whether")
    resumeRecordedRun(report, "skip")
    await vi.waitFor(() =>
      expect(disk.values.get(report.id).automation.status).toBe("completed")
    )
    expect(execute).toHaveBeenCalledTimes(1)
    expect(disk.values.get(report.id).steps[1].errors).toEqual([
      "SKIPPED_UNKNOWN",
    ])
    expect(disk.values.get(report.id).events[0].action).toBe("skip")
  })
})
