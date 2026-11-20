import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import {
  getDefaultRESTRequest,
  makeCollection,
  newRequestCase,
} from "@apirequest/data"

vi.mock("~/helpers/RequestRunner", () => ({
  captureInitialEnvironmentState: () => ({
    initialEnvs: { global: [], selected: [], temp: [] },
    initialGlobalEnvs: [],
    initialSelectedEnvs: [],
  }),
  runTestRunnerRequest: vi.fn(),
  executedResponses$: { subscribe: vi.fn() },
}))
vi.mock("~/helpers/request-cases/execute", () => ({
  executeRequestCase: vi.fn(),
}))

import { getService } from "~/modules/dioc"
import { executeRequestCase } from "~/helpers/request-cases/execute"
import { TestRunnerService } from "../test-runner.service"
import { collectReportSteps } from "~/helpers/test-runner/report"
import { savedReportTab } from "~/helpers/test-runner/saved-report"

const first = { ...newRequestCase(), id: "valid", name: "Valid token" }
const second = { ...newRequestCase(), id: "invalid", name: "Invalid token" }
second.overrides.headers = [
  { key: "Authorization", value: "bad", remove: false },
]
second.assertions[0].expected = "401"
const config = () => ({
  iterations: 1,
  delay: 0,
  stopOnError: false,
  executeScripts: true,
  persistResponses: true,
  keepVariableValues: false,
  requestCases: { source: [first, second] },
})
function fixture(settings = config()) {
  const collection = makeCollection({
    name: "Fixture",
    folders: [],
    headers: [],
    variables: [],
    auth: { authType: "none", authActive: false },
    preRequestScript: "",
    testScript: "",
    requests: [
      {
        ...getDefaultRESTRequest(),
        id: "source",
        _ref_id: "source-ref",
        name: "Chat",
      },
    ],
  })
  const tab = ref({
    id: "case-run",
    document: {
      type: "test-runner",
      collection,
      collectionID: "fixture",
      collectionType: "my-collections",
      config: settings,
      status: "idle",
      isDirty: false,
      request: null,
      testRunnerMeta: {},
    },
  } as any)
  return { tab, collection, settings }
}
beforeEach(() => {
  vi.mocked(executeRequestCase)
    .mockReset()
    .mockImplementation(async (request, entry) => {
      const status = entry.id === "valid" ? 200 : 401
      const body = new TextEncoder().encode(
        '{"error":{"type":"invalid_api_key"}}'
      ).buffer
      return {
        status,
        duration: 12,
        scripts: [],
        assertions: [
          {
            assertion: entry.assertions[0],
            actual: status,
            expected: Number(entry.assertions[0].expected),
            passed: true,
          },
        ],
        response: {
          type: "success",
          statusCode: status,
          statusText: "",
          body,
          headers: [],
          meta: { responseDuration: 12, responseSize: body.byteLength },
          req: request,
        },
      }
    })
})

describe("saved request cases in automation", () => {
  it("resumes the frozen case plan without repeating completed cases", async () => {
    const { tab, collection, settings } = fixture()
    const service = getService(TestRunnerService)
    const stopRef = ref(false)
    await service.runTests(tab, collection, {
      ...settings,
      stopRef,
      onProgress: async () => {
        if (tab.value.document.recovery?.nextRequest === 1) stopRef.value = true
      },
    })
    expect(executeRequestCase).toHaveBeenCalledTimes(1)
    expect(tab.value.document.status).toBe("stopped")
    const restored = ref(JSON.parse(JSON.stringify(tab.value)))
    await service.runTests(restored, collection, {
      ...settings,
      stopRef: ref(false),
      recovery: restored.value.document.recovery,
    })
    expect(executeRequestCase).toHaveBeenCalledTimes(2)
    expect(
      vi.mocked(executeRequestCase).mock.calls.map((call) => call[1].id)
    ).toEqual([first.id, second.id])
    expect(restored.value.document.status).toBe("completed")
    expect(
      collectReportSteps(restored.value.document.iterationResults)
    ).toHaveLength(2)
  })

  it("expands a request into its cases and produces durable, individually named report steps", async () => {
    const { tab, collection, settings } = fixture()
    await getService(TestRunnerService).runTests(tab, collection, {
      ...settings,
      stopRef: ref(false),
    })
    expect(tab.value.document.status).toBe("completed")
    expect(executeRequestCase).toHaveBeenCalledTimes(2)
    expect(
      vi.mocked(executeRequestCase).mock.calls[1][1].overrides.headers[0].value
    ).toBe("bad")
    expect(tab.value.document.testRunnerMeta).toMatchObject({
      totalRequests: 2,
      completedRequests: 2,
      passedTests: 2,
      failedTests: 0,
    })
    const steps = collectReportSteps(tab.value.document.iterationResults)
    expect(
      steps.map((step) => [step.requestName, step.passed, step.statusCode])
    ).toEqual([
      ["Chat · Valid token", true, 200],
      ["Chat · Invalid token", true, 401],
    ])
    expect(steps[1].assertions?.[0].expectResults[0].message).toContain(
      "expected: 401, actual: 401"
    )
    const restored = savedReportTab(
      JSON.parse(
        JSON.stringify({
          id: "saved",
          kind: "automation",
          name: "Fixture",
          createdAt: new Date().toISOString(),
          summary: { completed: 2, failed: 0, elapsedMs: 24 },
          steps,
        })
      )
    )
    expect(
      restored.document.iterationResults?.[0].resultCollection?.requests.map(
        (request) => request.name
      )
    ).toEqual(["Chat · Valid token", "Chat · Invalid token"])
  })

  it("executes only selected cases on every iteration and respects response retention and script switches", async () => {
    const { tab, collection, settings } = fixture({
      ...config(),
      iterations: 2,
      persistResponses: false,
      executeScripts: false,
    })
    const options = {
      ...settings,
      selectedCaseIDs: [second.id],
      stopRef: ref(false),
    }
    await getService(TestRunnerService).runTests(tab, collection, options)
    expect(executeRequestCase).toHaveBeenCalledTimes(2)
    expect(
      vi
        .mocked(executeRequestCase)
        .mock.calls.every(
          (call) =>
            call[1].id === second.id && call[5]?.executeScripts === false
        )
    ).toBe(true)
    const steps = collectReportSteps(tab.value.document.iterationResults)
    expect(
      steps.every(
        (step) => step.passed && step.responseOmitted && !step.response
      )
    ).toBe(true)
    expect(tab.value.document.testRunnerMeta.totalRequests).toBe(2)
  })

  it("rejects an empty case selection instead of silently running the base request", async () => {
    const { tab, collection, settings } = fixture()
    await getService(TestRunnerService).runTests(tab, collection, {
      ...settings,
      selectedCaseIDs: [],
      stopRef: ref(false),
    })
    expect(tab.value.document.status).toBe("error")
    expect(executeRequestCase).not.toHaveBeenCalled()
  })
})
