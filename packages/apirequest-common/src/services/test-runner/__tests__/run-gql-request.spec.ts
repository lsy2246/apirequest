import * as E from "fp-ts/Either"
import { ref } from "vue"
import { beforeEach, describe, expect, test, vi } from "vitest"

// RequestRunner drags in the network/kernel stack; these tests only exercise
// the service's GQL result handling. `executedResponses$` must exist on the
// mock — newstore/history subscribes to it at module load.
vi.mock("~/helpers/RequestRunner", () => ({
  captureInitialEnvironmentState: vi.fn(() => ({ initial: "env-state" })),
  runTestRunnerRequest: vi.fn(),
  executedResponses$: { subscribe: vi.fn() },
}))

vi.mock("~/helpers/graphql/testRunner", () => ({
  runTestRunnerGQLRequest: vi.fn(),
}))

import { runTestRunnerGQLRequest } from "~/helpers/graphql/testRunner"
import { runTestRunnerRequest } from "~/helpers/RequestRunner"
import { getService } from "~/modules/dioc"
import { TestRunnerService } from "../test-runner.service"

const service = getService(TestRunnerService)
const mockedRun = vi.mocked(runTestRunnerGQLRequest)

const gqlRequest = {
  v: 10,
  name: "gql-under-test",
  _ref_id: "gql-1",
  url: "https://example.com/graphql",
  query: "query { hello }",
  variables: "{}",
  headers: [],
  auth: { authType: "none", authActive: false },
  description: null,
  responses: {},
  preRequestScript: "",
  testScript: "",
}

const emptyMeta = () => ({
  totalRequests: 0,
  completedRequests: 0,
  totalTests: 0,
  passedTests: 0,
  failedTests: 0,
  totalTime: 0,
})

const makeTab = () =>
  ref({
    id: "runner-tab",
    document: {
      type: "test-runner" as const,
      status: "running" as const,
      resultCollection: {
        v: 12,
        name: "run",
        folders: [],
        requests: [
          {
            ...gqlRequest,
            type: "test-response",
            passedTests: 0,
            failedTests: 0,
            isLoading: false,
          },
        ],
        headers: [],
        variables: [],
        auth: { authType: "none", authActive: false },
      },
      testRunnerMeta: emptyMeta(),
    },
  }) as any

const makeOptions = (overrides: Record<string, unknown> = {}) => ({
  stopRef: ref(false),
  delay: 0,
  iterations: 1,
  keepVariableValues: false,
  persistResponses: true,
  stopOnError: false,
  ...overrides,
})

const passingTestResult = (overrides: Record<string, unknown> = {}) => ({
  description: "",
  expectResults: [
    { status: "pass", message: "" },
    { status: "pass", message: "" },
    { status: "fail", message: "" },
  ],
  tests: [],
  envDiff: {
    global: { additions: [], deletions: [], updations: [] },
    selected: { additions: [], deletions: [], updations: [] },
  },
  scriptError: false,
  consoleEntries: [],
  ...overrides,
})

const successResponse = { type: "success", meta: { responseDuration: 42 } }

const runGQL = (
  tab: ReturnType<typeof makeTab>,
  options: ReturnType<typeof makeOptions>,
  iterationMeta = emptyMeta(),
  iterationVars: unknown[] = []
) =>
  (service as any).runTestGQLRequest(
    tab,
    gqlRequest,
    options,
    [0],
    iterationMeta,
    iterationVars
  )

beforeEach(() => {
  mockedRun.mockReset()
})

describe("TestRunnerService.runTestGQLRequest", () => {
  test("skips request and inherited GraphQL scripts when execution is disabled", async () => {
    mockedRun.mockResolvedValue(
      E.left({
        type: "request_fail",
        message: "script failed",
        error: "script failed",
      }) as any
    )
    const request = {
      ...gqlRequest,
      preRequestScript: "before",
      testScript: "after",
    }
    await (service as any).runTestGQLRequest(
      makeTab(),
      request,
      makeOptions({ executeScripts: false }),
      [0],
      emptyMeta(),
      [],
      [],
      [],
      ["parent-before"],
      ["parent-after"]
    )
    expect(mockedRun.mock.calls[0][0]).toMatchObject({
      preRequestScript: "",
      testScript: "",
    })
    expect(mockedRun.mock.calls[0][5]).toEqual([])
    expect(mockedRun.mock.calls[0][6]).toEqual([])
    expect(request.preRequestScript).toBe("before")
  })

  test("skips request and inherited REST scripts without changing the saved request", async () => {
    const execute = vi.mocked(runTestRunnerRequest)
    execute.mockResolvedValue(
      E.left({ type: "script_fail", error: "script failed" }) as any
    )
    const request = {
      name: "REST",
      endpoint: "https://example.com",
      method: "GET",
      preRequestScript: "before",
      testScript: "after",
    }
    await (service as any).runTestRequest(
      makeTab(),
      request,
      {},
      makeOptions({ executeScripts: false }),
      [0],
      emptyMeta(),
      [],
      [],
      ["parent-before"],
      ["parent-after"]
    )
    expect(execute.mock.calls[0][0]).toMatchObject({
      preRequestScript: "",
      testScript: "",
    })
    expect(execute.mock.calls[0][4]).toEqual([])
    expect(execute.mock.calls[0][5]).toEqual([])
    expect(request.testScript).toBe("after")
  })
  test("forwards dataset iteration variables to the GQL executor", async () => {
    mockedRun.mockResolvedValue(
      E.right({
        response: successResponse,
        testResult: passingTestResult(),
      }) as any
    )

    const iterationVars = [
      {
        key: "col",
        initialValue: "row-1",
        currentValue: "row-1",
        secret: false,
      },
    ]
    await runGQL(makeTab(), makeOptions(), emptyMeta(), iterationVars)

    expect(mockedRun).toHaveBeenCalledTimes(1)
    // (request, keepVariableValues, inheritedVariables, envState,
    //  inheritedHeaders, preScripts, testScripts, iterationVars)
    expect(mockedRun.mock.calls[0][7]).toBe(iterationVars)
    // Pins the positional threading — a future arg shuffle that displaces the
    // captured env state (or iterationVars) must fail here
    expect(mockedRun.mock.calls[0][3]).toEqual({ initial: "env-state" })
  })

  test.each(["REST", "GraphQL"])(
    "keeps %s outcome metadata when response storage is disabled",
    async (protocol) => {
      const result = E.right({
        response: {
          ...successResponse,
          statusCode: 200,
          body: "private response",
        },
        testResult: passingTestResult(),
        updatedRequest: { name: "REST" },
      }) as any
      const tab = makeTab()
      const options = makeOptions({ persistResponses: false })
      if (protocol === "GraphQL") {
        mockedRun.mockResolvedValue(result)
        await runGQL(tab, options)
      } else {
        vi.mocked(runTestRunnerRequest).mockResolvedValue(result)
        await (service as any).runTestRequest(
          tab,
          { name: "REST" },
          {},
          options,
          [0],
          emptyMeta()
        )
      }
      const row = tab.value.document.resultCollection.requests[0]
      expect(row.response).toBeNull()
      expect(row.reportResponse).toMatchObject({
        type: "success",
        statusCode: 200,
        elapsedMs: 42,
      })
      expect(JSON.stringify(row.reportResponse)).not.toContain(
        "private response"
      )
    }
  )

  test.each(["REST", "GraphQL"])(
    "preserves original %s executor failures in report metadata",
    async (protocol) => {
      const original = Object.assign(
        new Error("connect ECONNREFUSED 127.0.0.1:4321"),
        { code: "ECONNREFUSED" }
      )
      const tab = makeTab()
      if (protocol === "GraphQL") {
        mockedRun.mockResolvedValue(
          E.left({
            type: "request_fail",
            message: original.message,
            error: original,
          }) as any
        )
        await runGQL(tab, makeOptions())
      } else {
        vi.mocked(runTestRunnerRequest).mockResolvedValue(
          E.left({ type: "request_fail", error: original }) as any
        )
        await (service as any).runTestRequest(
          tab,
          { name: "REST" },
          {},
          makeOptions(),
          [0],
          emptyMeta()
        )
      }
      const details =
        tab.value.document.resultCollection.requests[0].reportResponse
          .errorDetails
      expect(details[0].data.message).toBe(original.message)
      expect(details[0].data.code).toBe("ECONNREFUSED")
    }
  )

  test("writes per-row pass/fail counts and tallies both run metas", async () => {
    mockedRun.mockResolvedValue(
      E.right({
        response: successResponse,
        testResult: passingTestResult(),
      }) as any
    )

    const tab = makeTab()
    const iterationMeta = emptyMeta()
    await runGQL(tab, makeOptions(), iterationMeta)

    const row = tab.value.document.resultCollection.requests[0]
    expect(row.passedTests).toBe(2)
    expect(row.failedTests).toBe(1)
    expect(row.testResults).toBeTruthy()
    expect(row.isLoading).toBe(false)

    for (const meta of [tab.value.document.testRunnerMeta, iterationMeta]) {
      expect(meta.totalTests).toBe(3)
      expect(meta.passedTests).toBe(2)
      expect(meta.failedTests).toBe(1)
      expect(meta.completedRequests).toBe(1)
      expect(meta.totalTime).toBe(42)
    }
  })

  test("stopOnError halts the run on a GQL test-script failure", async () => {
    mockedRun.mockResolvedValue(
      E.right({
        response: successResponse,
        testResult: passingTestResult({
          expectResults: [],
          scriptError: true,
        }),
      }) as any
    )

    const tab = makeTab()
    await expect(
      runGQL(tab, makeOptions({ stopOnError: true }))
    ).rejects.toThrow("Test execution stopped due to error")

    expect(tab.value.document.status).toBe("stopped")
    // The row and meta record the request before the halt
    expect(tab.value.document.testRunnerMeta.failedTests).toBe(1)
    expect(tab.value.document.resultCollection.requests[0].isLoading).toBe(
      false
    )
  })

  test("a stop taken mid-flight clears the row's loading spinner", async () => {
    const options = makeOptions()
    mockedRun.mockImplementation(async () => {
      options.stopRef.value = true
      return E.right({
        response: successResponse,
        testResult: passingTestResult(),
      }) as any
    })

    const tab = makeTab()
    await expect(runGQL(tab, options)).rejects.toThrow("Test execution stopped")

    expect(tab.value.document.resultCollection.requests[0].isLoading).toBe(
      false
    )
  })

  test("executor failures mark the row and honor stopOnError", async () => {
    mockedRun.mockResolvedValue(
      E.left({ type: "subscription_unsupported" }) as any
    )

    const tab = makeTab()
    await expect(
      runGQL(tab, makeOptions({ stopOnError: true }))
    ).rejects.toThrow("Test execution stopped due to error")

    const row = tab.value.document.resultCollection.requests[0]
    expect(row.error).toMatch(/subscriptions are not supported/)
    expect(row.isLoading).toBe(false)
    expect(tab.value.document.status).toBe("stopped")
  })
})
