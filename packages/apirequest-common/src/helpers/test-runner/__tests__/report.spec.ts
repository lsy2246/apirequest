import { describe, expect, it } from "vitest"
import { collectReportSteps } from "../report"
import type { TestRunnerIterationResult } from "~/helpers/tab/document"

describe("saved automation request outcomes", () => {
  it("records nested outcomes per iteration with actual responses and errors, without copying request headers", () => {
    const collection = {
      name: "Suite",
      requests: [],
      folders: [
        {
          name: "Folder",
          folders: [],
          requests: [
            {
              name: "Read",
              endpoint: "https://private.example?token=secret",
              headers: [{ value: "header-secret" }],
              method: "GET",
              response: {
                type: "success",
                statusCode: 200,
                body: new TextEncoder().encode("actual payload").buffer,
                statusText: "OK",
                headers: [],
                meta: { responseDuration: 42 },
              },
              testResults: { description: "", tests: [], expectResults: [] },
              passedTests: 2,
              failedTests: 0,
            },
            {
              name: "Fail",
              error: "actual transport error",
              response: {
                type: "network_fail",
                error: new Error("connect ECONNREFUSED 127.0.0.1:9999"),
              },
              passedTests: 0,
              failedTests: 0,
            },
            { name: "Pending", isLoading: true },
            { name: "Never started" },
          ],
        },
      ],
    }
    const steps = collectReportSteps([
      { iteration: 1, resultCollection: collection },
      { iteration: 2, resultCollection: collection },
    ] as unknown as TestRunnerIterationResult[])
    expect(steps).toHaveLength(4)
    expect(steps[0]).toMatchObject({
      name: "1 / Suite / Folder / Read",
      passed: true,
      statusCode: 200,
      elapsedMs: 42,
      passedTests: 2,
    })
    expect(steps[1]).toMatchObject({
      passed: false,
      errors: ["REQUEST_ERROR", "network_fail"],
    })
    expect(steps[2].name).toBe("2 / Suite / Folder / Read")
    expect(steps[0].response?.body).toBe("actual payload")
    expect(JSON.stringify(steps[1].errorDetails)).toContain("ECONNREFUSED")
    expect(JSON.stringify(steps)).not.toContain("header-secret")
    expect(steps[0].endpoint).toBe("https://private.example?token=secret")
    expect(steps[0].method).toBe("GET")
  })
  it("keeps HTTP status and timing when response persistence is disabled", () => {
    const collection = {
      name: "Suite",
      folders: [],
      requests: [
        {
          name: "Read",
          folderPath: ["Nested"],
          response: null,
          reportResponse: { type: "fail", statusCode: 503, elapsedMs: 80 },
          testResults: { description: "", tests: [], expectResults: [] },
          passedTests: 0,
          failedTests: 0,
        },
      ],
    }
    const steps = collectReportSteps([
      { iteration: 1, resultCollection: collection },
    ] as unknown as TestRunnerIterationResult[])
    expect(steps[0]).toMatchObject({
      name: "1 / Suite / Nested / Read",
      passed: false,
      statusCode: 503,
      elapsedMs: 80,
    })
  })
  it("marks failed assertions, HTTP failures and script errors as failed requests", () => {
    const collection = {
      name: "Suite",
      folders: [],
      requests: [
        {
          name: "Assert",
          response: null,
          testResults: { description: "", tests: [], expectResults: [] },
          passedTests: 1,
          failedTests: 3,
        },
        {
          name: "HTTP",
          response: {
            type: "fail",
            statusCode: 500,
            meta: { responseDuration: 10 },
          },
        },
        {
          name: "Script",
          testResults: {
            scriptError: true,
            description: "",
            tests: [],
            expectResults: [],
          },
        },
      ],
    }
    const steps = collectReportSteps([
      { iteration: 1, resultCollection: collection },
    ] as unknown as TestRunnerIterationResult[])
    expect(steps.every((step) => !step.passed)).toBe(true)
    expect(steps[0].errors).toEqual(["TESTS_FAILING"])
    expect(steps[1].statusCode).toBe(500)
    expect(steps[2].errors).toEqual(["TEST_SCRIPT_ERROR"])
  })
})
