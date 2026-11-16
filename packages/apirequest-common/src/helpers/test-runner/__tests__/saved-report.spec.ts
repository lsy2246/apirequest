import { describe, expect, it } from "vitest"
import { savedReportTab } from "../saved-report"
import { requestFailed } from "~/helpers/runner/outcome"
import type { WorkbenchReport } from "~/composables/workbenchReports"
import type { TestRunnerRequest } from "~/services/test-runner/test-runner.service"

const report: WorkbenchReport = {
  id: "saved",
  name: "Suite",
  kind: "automation",
  createdAt: "2026-11-13T00:00:00Z",
  environmentID: "env-test",
  environmentName: "Test",
  summary: { completed: 2, failed: 1, elapsedMs: 200 },
  automation: {
    status: "completed",
    totalTests: 1,
    passedTests: 0,
    failedTests: 1,
  },
  steps: [
    {
      name: "Suite/read",
      requestName: "Read",
      method: "GET",
      endpoint: "http://fixture/read",
      iteration: 1,
      passed: false,
      elapsedMs: 3,
      statusCode: 404,
      errors: [],
      response: {
        statusCode: 404,
        statusText: "Not Found",
        headers: [{ key: "content-type", value: "application/json" }],
        body: '{"error":"missing"}',
      },
      assertions: [
        {
          descriptor: "Status",
          passed: 0,
          failed: 1,
          expectResults: [
            { status: "fail", message: "expected 404 to equal 200" },
          ],
        },
      ],
    },
    {
      name: "Suite/create",
      requestName: "Create",
      method: "POST",
      endpoint: "http://fixture/create",
      iteration: 2,
      passed: true,
      elapsedMs: 7,
      statusCode: 201,
      errors: [],
      response: {
        statusCode: 201,
        statusText: "Created",
        headers: [],
        body: '{"id":7}',
      },
    },
  ],
}
describe("saved report in the collection runner", () => {
  it("restores iterations, selected response, request metadata, assertions and request timing from the same snapshot", () => {
    const before = JSON.stringify(report)
    const tab = savedReportTab(report),
      doc = tab.document
    expect(doc.status).toBe("completed")
    expect(doc.iterationResults?.map((item) => item.iteration)).toEqual([1, 2])
    expect(doc.testRunnerMeta.totalTime).toBe(10)
    expect(doc.environmentName).toBe("Test")
    expect(doc.environmentID).toBe("env-test")
    const first = doc.request!
    expect(first.name).toBe("Read")
    expect(first.response?.type).toBe("success")
    if (first.response?.type !== "success")
      throw new Error("Expected recorded HTTP response")
    expect(first.response.statusCode).toBe(404)
    expect(new TextDecoder().decode(first.response.body)).toBe(
      '{"error":"missing"}'
    )
    expect(first.testResults?.tests[0].expectResults[0].message).toBe(
      "expected 404 to equal 200"
    )
    expect(requestFailed(first)).toBe(true)
    const second = doc.iterationResults![1].resultCollection!
      .requests[0] as TestRunnerRequest
    expect(requestFailed(second)).toBe(false)
    expect("method" in second && second.method).toBe("POST")
    if (second.response?.type !== "success")
      throw new Error("Expected second HTTP response")
    expect(second.response.statusCode).toBe(201)
    expect(new TextDecoder().decode(second.response.body)).toBe('{"id":7}')
    expect(JSON.stringify(report)).toBe(before)
  })
  it("preserves original transport errors and leaves missing HTTP data absent", () => {
    const tab = savedReportTab({
      ...report,
      steps: [
        {
          name: "Unavailable",
          passed: false,
          errors: ["REQUEST_ERROR"],
          errorDetails: [
            {
              code: "REQUEST_ERROR",
              data: { message: "connect ECONNREFUSED", code: "ECONNREFUSED" },
            },
          ],
        },
      ],
    })
    expect(tab.document.request?.response?.type).toBe("network_fail")
    expect(tab.document.request?.error).toContain("ECONNREFUSED")
    expect(
      tab.document.request &&
        "method" in tab.document.request &&
        tab.document.request.method
    ).toBe("")
    expect(
      tab.document.request &&
        "endpoint" in tab.document.request &&
        tab.document.request.endpoint
    ).toBe("")
  })
})
