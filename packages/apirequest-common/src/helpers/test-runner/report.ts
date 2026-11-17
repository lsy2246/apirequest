import { requestFailed } from "~/helpers/runner/outcome"
import type { HoppCollection } from "@apirequest/data"
import type { TestRunnerIterationResult } from "~/helpers/tab/document"
import type { TestRunnerRequest } from "~/services/test-runner/test-runner.service"
import type {
  HoppTestData,
  HoppTestResult,
} from "~/helpers/types/HoppTestResult"
import type { HoppRESTResponse } from "~/helpers/types/HoppRESTResponse"
import type { WorkbenchReportStep } from "~/composables/workbenchReports"

export function reportError(
  value: unknown,
  seen = new Set<unknown>()
): unknown {
  if (typeof value === "bigint") return String(value)
  if (value === null || typeof value !== "object") return value
  if (seen.has(value)) return "[Circular]"
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => reportError(item, seen))
  const error = value as Record<string, unknown>,
    result: Record<string, unknown> = {}
  for (const key of [
    "name",
    "message",
    "code",
    "errno",
    "syscall",
    "address",
    "port",
    "stack",
    "cause",
    "errors",
  ]) {
    if (error[key] !== undefined) result[key] = reportError(error[key], seen)
  }
  for (const [key, item] of Object.entries(error)) {
    if (
      !Object.hasOwn(result, key) &&
      !["config", "request", "response"].includes(key)
    )
      result[key] = reportError(item, seen)
  }
  return result
}

export function summarizeRunnerResponse(
  response: HoppRESTResponse,
  persistResponse = true
) {
  const received = response.type === "success" || response.type === "fail"
  let savedResponse: WorkbenchReportStep["response"]
  if (received && persistResponse) {
    const bytes = new Uint8Array(response.body)
    const chunks: string[] = []
    for (let offset = 0; offset < bytes.length; offset += 32768)
      chunks.push(
        String.fromCharCode(...bytes.subarray(offset, offset + 32768))
      )
    const body = btoa(chunks.join(""))
    savedResponse = {
      statusCode: response.statusCode,
      statusText: response.statusText,
      headers: response.headers,
      body,
      bodyEncoding: "base64",
    }
  }
  const errorDetails: NonNullable<WorkbenchReportStep["errorDetails"]> =
    "error" in response
      ? [{ code: response.type, data: reportError(response.error) }]
      : []
  return {
    type: response.type,
    detailsRecorded: true,
    response: savedResponse,
    responseOmitted: received && !persistResponse,
    errorDetails,
    ...(received
      ? {
          statusCode: response.statusCode,
          elapsedMs: response.meta.responseDuration,
        }
      : {}),
  }
}

export function emptyRunnerTestResult(): HoppTestResult {
  return {
    description: "",
    expectResults: [],
    tests: [],
    scriptError: false,
    consoleEntries: [],
    envDiff: {
      global: { additions: [], deletions: [], updations: [] },
      selected: { additions: [], deletions: [], updations: [] },
    },
  }
}
export function summarizeRunnerFailure(
  error: unknown,
  code: string
): ReturnType<typeof summarizeRunnerResponse> {
  return {
    type: "network_fail",
    detailsRecorded: true,
    response: undefined,
    responseOmitted: false,
    errorDetails: [{ code, data: reportError(error) }],
  }
}

function collectAssertions(
  test: HoppTestData,
  parent = ""
): NonNullable<WorkbenchReportStep["assertions"]> {
  const descriptor = [parent, test.description].filter(Boolean).join(" / ")
  return [
    ...(test.expectResults.length
      ? [
          {
            descriptor,
            passed: test.expectResults.filter((r) => r.status === "pass")
              .length,
            failed: test.expectResults.filter((r) => r.status !== "pass")
              .length,
            expectResults: test.expectResults.map((r) => ({
              status: r.status,
              message: r.message,
            })),
          },
        ]
      : []),
    ...test.tests.flatMap((child) => collectAssertions(child, descriptor)),
  ]
}

export function collectReportSteps(
  iterations: TestRunnerIterationResult[]
): WorkbenchReportStep[] {
  const steps: WorkbenchReportStep[] = []
  function visit(
    collection: HoppCollection,
    path: string[],
    iteration: number
  ) {
    for (const item of collection.requests) {
      const request = item as TestRunnerRequest
      if (
        request.isLoading ||
        (!request.reportResponse &&
          !request.response &&
          !request.testResults &&
          !request.error)
      )
        continue
      const response =
        request.reportResponse ??
        (request.response
          ? summarizeRunnerResponse(request.response)
          : undefined)
      const errors: string[] = []
      if (request.error) errors.push("REQUEST_ERROR")
      if (request.testResults?.scriptError) errors.push("TEST_SCRIPT_ERROR")
      if (request.failedTests) errors.push("TESTS_FAILING")
      const received = response?.type === "success" || response?.type === "fail"
      if (response && !received && response.type !== "loading")
        errors.push(response.type)
      if (
        response?.errorDetails?.some(
          (error) => error.code === "SKIPPED_UNKNOWN"
        )
      )
        errors.splice(0, errors.length, "SKIPPED_UNKNOWN")
      steps.push({
        name: [...path, ...(request.folderPath ?? []), request.name].join(
          " / "
        ),
        requestName: request.name,
        method: "method" in request ? request.method : "POST",
        endpoint: "endpoint" in request ? request.endpoint : request.url,
        iteration,
        passed: !requestFailed(request),
        elapsedMs: response?.elapsedMs,
        statusCode: response?.statusCode,
        passedTests: request.passedTests ?? 0,
        failedTests: request.failedTests ?? 0,
        errors: [...new Set(errors)],
        detailsRecorded: true,
        errorDetails: [
          ...(response?.errorDetails ?? []),
          ...(request.testResults?.scriptErrorDetails !== undefined
            ? [
                {
                  code: "TEST_SCRIPT_ERROR",
                  data: reportError(request.testResults.scriptErrorDetails),
                },
              ]
            : []),
          ...(request.error && !response?.errorDetails?.length
            ? [{ code: "REQUEST_ERROR", data: request.error }]
            : []),
        ],
        response: response?.response,
        responseOmitted: response?.responseOmitted,
        testResults: request.testResults ?? undefined,
        assertions: request.testResults
          ? collectAssertions(request.testResults)
          : [],
      })
    }
    for (const folder of collection.folders)
      visit(folder, [...path, folder.name], iteration)
  }
  for (const iteration of iterations) {
    if (iteration.resultCollection)
      visit(
        iteration.resultCollection,
        [String(iteration.iteration), iteration.resultCollection.name],
        iteration.iteration
      )
  }
  return steps
}
