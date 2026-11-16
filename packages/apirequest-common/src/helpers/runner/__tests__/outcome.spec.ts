import { describe, expect, it } from "vitest"
import { requestFailed, requestHasResult, reportFailureCount } from "../outcome"
import type { TestRunnerRequest } from "~/services/test-runner/test-runner.service"
describe("request outcome filters", () => {
  it.each([
    { status: 200, failed: false },
    { status: 201, failed: false },
    { status: 404, failed: true },
    { status: 500, failed: true },
  ])(
    "classifies HTTP $status even without assertions",
    ({ status, failed }) => {
      const request = {
        response: { type: "success", statusCode: status },
        testResults: { expectResults: [], tests: [] },
        failedTests: 0,
      } as unknown as TestRunnerRequest
      expect(requestHasResult(request)).toBe(true)
      expect(requestFailed(request)).toBe(failed)
    }
  )
  it("allows assertions to verify expected HTTP errors and derives old report counts from recorded HTTP results", () => {
    expect(
      requestFailed({
        passedTests: 1,
        failedTests: 0,
        response: { type: "success", statusCode: 404 },
      } as TestRunnerRequest)
    ).toBe(false)
    expect(
      reportFailureCount({
        summary: { failed: 0 },
        steps: [
          { passed: true, statusCode: 404 },
          { passed: true, statusCode: 200 },
        ],
      } as any)
    ).toBe(1)
    expect(
      reportFailureCount({
        summary: { failed: 0 },
        steps: [
          { passed: true, statusCode: 404, passedTests: 1, failedTests: 0 },
        ],
      } as any)
    ).toBe(0)
  })
  it("does not classify pending requests as passed and includes assertion and transport failures", () => {
    expect(requestHasResult({ isLoading: true } as TestRunnerRequest)).toBe(
      false
    )
    expect(requestFailed({ failedTests: 1 } as TestRunnerRequest)).toBe(true)
    expect(
      requestFailed({ response: { type: "network_fail" } } as TestRunnerRequest)
    ).toBe(true)
  })
})
