import type { HoppCollection } from "@apirequest/data"
import type { TestRunnerRequest } from "~/services/test-runner/test-runner.service"
import type { WorkbenchReport } from "~/composables/workbenchReports"

export const requestHasResult = (request: TestRunnerRequest) =>
  !request.isLoading &&
  request.response?.type !== "loading" &&
  Boolean(
    request.reportResponse ||
    request.response ||
    request.testResults ||
    request.error
  )
export function requestFailed(request: TestRunnerRequest) {
  const status =
    request.reportResponse?.statusCode ??
    (request.response && "statusCode" in request.response
      ? request.response.statusCode
      : undefined)
  const assertions = request.passedTests + request.failedTests
  return Boolean(
    request.error ||
    request.failedTests ||
    request.testResults?.scriptError ||
    (request.response &&
      !["success", "fail", "loading"].includes(request.response.type)) ||
    (request.reportResponse &&
      !["success", "fail", "loading"].includes(request.reportResponse.type)) ||
    (!assertions &&
      ((status !== undefined && status >= 400) ||
        request.response?.type === "fail"))
  )
}
export function resultRequests(
  collection?: HoppCollection
): TestRunnerRequest[] {
  if (!collection) return []
  return [
    ...(collection.requests as TestRunnerRequest[]),
    ...collection.folders.flatMap((folder) => resultRequests(folder)),
  ]
}
export function reportFailureCount(report: WorkbenchReport) {
  return report.steps
    ? report.steps.filter((step) => {
        const assertions =
          (step.passedTests ??
            step.assertions?.reduce((sum, test) => sum + test.passed, 0) ??
            0) +
          (step.failedTests ??
            step.assertions?.reduce((sum, test) => sum + test.failed, 0) ??
            0)
        return (
          !step.passed ||
          (!assertions &&
            (step.response?.statusCode ?? step.statusCode ?? 0) >= 400) ||
          (step.failedTests ?? 0) > 0
        )
      }).length
    : report.summary.failed
}
