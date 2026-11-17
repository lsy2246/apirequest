import { afterEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import { getDefaultRESTRequest, makeCollection } from "@apirequest/data"
import * as E from "fp-ts/Either"
vi.mock("~/helpers/RequestRunner", () => ({
  captureInitialEnvironmentState: vi.fn(),
  runTestRunnerRequest: vi.fn(),
  executedResponses$: { subscribe: vi.fn() },
}))
import { runTestRunnerRequest } from "~/helpers/RequestRunner"
import { getService } from "~/modules/dioc"
import { TestRunnerService } from "../test-runner.service"
import {
  emptyRunnerTestResult,
  collectReportSteps,
} from "~/helpers/test-runner/report"
const service = getService(TestRunnerService)
const execute = vi.mocked(runTestRunnerRequest)
const config = {
  iterations: 2,
  delay: 0,
  stopOnError: false,
  persistResponses: false,
  keepVariableValues: false,
}
function fixture() {
  const request = getDefaultRESTRequest()
  const collection = makeCollection({
    name: "Suite",
    folders: [],
    headers: [],
    variables: [],
    auth: { authType: "none", authActive: false },
    preRequestScript: "",
    testScript: "",
    requests: [request, { ...request, name: "Second" }],
  })
  const tab = ref({
    id: crypto.randomUUID(),
    document: {
      type: "test-runner",
      status: "idle",
      config,
      collection,
      collectionID: "collection",
      collectionType: "my-collections",
      request: null,
      testRunnerMeta: {},
    },
  }) as any
  const snapshots: any[] = []
  const options = {
    ...config,
    stopRef: ref(false),
    onProgress: async () => {
      snapshots.push(
        JSON.parse(
          JSON.stringify({
            status: tab.value.document.status,
            steps: collectReportSteps(
              tab.value.document.iterationResults ?? []
            ),
          })
        )
      )
    },
  }
  return { tab, collection, snapshots, options }
}
function result() {
  return E.right({
    updatedRequest: getDefaultRESTRequest(),
    testResult: emptyRunnerTestResult(),
    response: {
      type: "fail",
      statusCode: 500,
      statusText: "Failed",
      headers: [],
      body: new TextEncoder().encode("complete error response").buffer,
      meta: { responseDuration: 12, responseSize: 23 },
    },
  }) as any
}
afterEach(() => {
  vi.clearAllMocks()
})
describe("runner pause and durable checkpoints", () => {
  it("publishes running before requests and preserves the current failure before pausing, then resumes remaining iterations", async () => {
    const { tab, collection, snapshots, options } = fixture()
    let finish!: (value: any) => void
    execute
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValue(result())
    const done = service.runTests(tab, collection, options)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    expect(snapshots[0]).toEqual({ status: "running", steps: [] })
    expect(service.pauseRun(tab.value.id)).toBe(true)
    finish(result())
    await vi.waitFor(() => expect(tab.value.document.status).toBe("paused"))
    expect(execute).toHaveBeenCalledTimes(1)
    expect(snapshots.at(-1).steps[0]).toMatchObject({
      passed: false,
      statusCode: 500,
      response: {
        body: btoa("complete error response"),
        bodyEncoding: "base64",
      },
    })
    expect(service.resumeRun(tab.value.id)).toBe(true)
    await done
    expect(execute).toHaveBeenCalledTimes(4)
    expect(snapshots.at(-1).status).toBe("completed")
    expect(snapshots.at(-1).steps).toHaveLength(4)
    expect(service.resumeRun(tab.value.id)).toBe(false)
  })
  it("stops a paused run without losing its completed requests or sending more", async () => {
    const { tab, collection, snapshots, options } = fixture()
    let finish!: (value: any) => void
    execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const done = service.runTests(tab, collection, options)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    service.pauseRun(tab.value.id)
    finish(result())
    await vi.waitFor(() => expect(tab.value.document.status).toBe("paused"))
    service.stopRun(tab.value.id)
    await done
    expect(execute).toHaveBeenCalledTimes(1)
    expect(snapshots.at(-1).status).toBe("stopped")
    expect(snapshots.at(-1).steps).toHaveLength(1)
  })
  it("saves the final error when setup/execution throws", async () => {
    const { tab, collection, snapshots, options } = fixture()
    vi.spyOn(service as any, "runTestIterations").mockRejectedValueOnce(
      new Error("planning failed")
    )
    await service.runTests(tab, collection, options)
    expect(snapshots.at(-1).status).toBe("error")
    expect(tab.value.document.runError.message).toBe("planning failed")
    vi.restoreAllMocks()
  })
})

it("pauses and stops immediately during the configured delay", async () => {
  vi.useFakeTimers()
  try {
    const { tab, collection, snapshots, options } = fixture()
    execute.mockResolvedValue(result())
    const done = service.runTests(tab, collection, { ...options, delay: 60000 })
    await vi.waitFor(() =>
      expect(
        (service as any).runControls.get(tab.value.id)?.interruptDelay
      ).toBeTypeOf("function")
    )
    service.pauseRun(tab.value.id)
    await vi.waitFor(() => expect(tab.value.document.status).toBe("paused"))
    expect(execute).toHaveBeenCalledTimes(1)
    service.stopRun(tab.value.id)
    await done
    expect(snapshots.at(-1).status).toBe("stopped")
    expect(snapshots.at(-1).steps).toHaveLength(1)
  } finally {
    vi.useRealTimers()
  }
})
