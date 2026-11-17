import { getDefaultRESTRequest, makeCollection } from "@apirequest/data"
import type { HoppCollection } from "@apirequest/data"
import type { WorkbenchReport } from "~/composables/workbenchReports"
import type {
  HoppTestRunnerDocument,
  TestRunnerIterationResult,
} from "~/helpers/tab/document"
import type { TestRunnerRequest } from "~/services/test-runner/test-runner.service"
import type { HoppTab } from "~/services/tab"
import { emptyRunnerTestResult } from "./report"

const collection = (
  name: string,
  requests: TestRunnerRequest[] = []
): HoppCollection =>
  makeCollection({
    name,
    folders: [],
    requests,
    headers: [],
    auth: { authType: "none", authActive: false },
    variables: [],
    description: null,
    preRequestScript: "",
    testScript: "",
  })

/** Rebuild only recorded results; this document is never executed or registered as an editor tab. */
export function savedReportTab(
  report: WorkbenchReport
): HoppTab<HoppTestRunnerDocument> {
  const groups = new Map<number, TestRunnerRequest[]>()
  for (const [index, step] of (report.steps ?? []).entries()) {
    const request = {
      ...getDefaultRESTRequest(),
      name: step.requestName ?? step.name,
      method: step.method ?? "",
      endpoint: step.endpoint ?? "",
    }
    const testResults = step.testResults
      ? JSON.parse(JSON.stringify(step.testResults))
      : emptyRunnerTestResult()
    if (!step.testResults)
      testResults.tests = (step.assertions ?? []).map((test) => ({
        description: test.descriptor,
        expectResults: test.expectResults.map((result) => ({
          status: result.status as "pass" | "fail" | "error",
          message: result.message,
        })),
        tests: [],
      }))
    const error = step.errorDetails?.length
      ? step.errorDetails
          .map((item) =>
            typeof item.data === "string"
              ? item.data
              : JSON.stringify(item.data, null, 2)
          )
          .join("\n")
      : step.errors.join("\n")
    const body = step.response
      ? step.response.bodyEncoding === "base64"
        ? Uint8Array.from(atob(step.response.body), (char) =>
            char.charCodeAt(0)
          )
        : new TextEncoder().encode(step.response.body)
      : undefined
    const result: TestRunnerRequest = {
      ...request,
      type: "test-response",
      runnerRequestID: `saved-${index}`,
      passedTests:
        step.passedTests ??
        step.assertions?.reduce((sum, test) => sum + test.passed, 0) ??
        0,
      failedTests:
        step.failedTests ??
        step.assertions?.reduce((sum, test) => sum + test.failed, 0) ??
        0,
      testResults,
      isLoading: false,
      error: error || undefined,
      response:
        step.response && body
          ? {
              type: "success",
              statusCode: step.response.statusCode,
              statusText: step.response.statusText,
              headers: step.response.headers,
              body: body.buffer as ArrayBuffer,
              meta: {
                responseDuration: step.elapsedMs ?? 0,
                responseSize: body.byteLength,
              },
              req: request,
            }
          : error
            ? {
                type: "network_fail",
                error: step.errorDetails?.[0]?.data ?? error,
                req: request,
              }
            : null,
      reportResponse: {
        type:
          step.response || step.responseOmitted ? "success" : "network_fail",
        detailsRecorded: step.detailsRecorded === true,
        response: step.response,
        responseOmitted: step.responseOmitted === true,
        errorDetails: step.errorDetails ?? [],
        elapsedMs: step.elapsedMs,
        statusCode: step.statusCode,
      },
    }
    const iteration = step.iteration ?? 1
    if (!groups.has(iteration)) groups.set(iteration, [])
    groups.get(iteration)!.push(result)
  }
  const iterations: TestRunnerIterationResult[] = [...groups].map(
    ([iteration, requests]) => ({
      iteration,
      resultCollection: collection(report.name, requests),
      meta: {
        totalRequests: requests.length,
        completedRequests: requests.length,
        totalTime: requests.reduce(
          (sum, request) => sum + (request.reportResponse?.elapsedMs ?? 0),
          0
        ),
        passedTests: requests.reduce(
          (sum, request) => sum + request.passedTests,
          0
        ),
        failedTests: requests.reduce(
          (sum, request) => sum + request.failedTests,
          0
        ),
        totalTests: requests.reduce(
          (sum, request) => sum + request.passedTests + request.failedTests,
          0
        ),
      },
    })
  )
  const first = iterations[0]?.resultCollection?.requests[0] as
    TestRunnerRequest | undefined
  return {
    id: `report-${report.id}`,
    document: {
      type: "test-runner",
      isDirty: false,
      status: ["running", "pausing", "paused"].includes(
        report.automation?.status ?? ""
      )
        ? (report.automation!.status as "running" | "pausing" | "paused")
        : report.automation?.status === "interrupted"
          ? "stopped"
          : report.automation?.status === "stopped"
            ? "stopped"
            : report.errorDetails?.length ||
                !["completed", "passed", "failed"].includes(
                  report.automation?.status ?? "completed"
                )
              ? "error"
              : "completed",
      collection: collection(report.name),
      collectionID: report.source?.collectionID ?? "",
      collectionType: "my-collections",
      environmentID: report.environmentID,
      environmentName: report.environmentName ?? "—",
      config: {
        ...(report.source?.config ?? {
          iterations: groups.size || 1,
          delay: 0,
          stopOnError: false,
          persistResponses: true,
          keepVariableValues: false,
        }),
        persistResponses: true,
      },
      iterationResults: iterations,
      resultCollection: iterations[0]?.resultCollection,
      request: first ?? null,
      selectedRequestPath: first
        ? `${iterations[0].iteration}::request-folder-0/0`
        : undefined,
      selectedIteration: 0,
      testRunnerMeta: {
        totalRequests:
          report.automation?.totalRequests ?? report.summary.completed,
        completedRequests: report.summary.completed,
        totalTime: (report.steps ?? []).reduce(
          (sum, step) => sum + (step.elapsedMs ?? 0),
          0
        ),
        passedTests: report.automation?.passedTests ?? 0,
        failedTests: report.automation?.failedTests ?? 0,
        totalTests: report.automation?.totalTests ?? 0,
      },
    },
  }
}
