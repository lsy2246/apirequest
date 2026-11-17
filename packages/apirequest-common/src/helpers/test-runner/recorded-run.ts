import { ref } from "vue"
import { cloneDeep } from "lodash-es"
import type { HoppCollection, HoppCollectionVariable } from "@apirequest/data"
import type { HoppTab } from "~/services/tab"
import type {
  HoppTestRunnerDocument,
  TestRunnerConfig,
} from "~/helpers/tab/document"
import { getService } from "~/modules/dioc"
import {
  TestRunnerService,
  type ManualRunRecovery,
} from "~/services/test-runner/test-runner.service"
import {
  useWorkbenchReports,
  type WorkbenchReport,
  type WorkbenchReportStep,
} from "~/composables/workbenchReports"
import { collectReportSteps, reportError } from "./report"
import { savedReportTab } from "./saved-report"

export function startRecordedRun(
  tab: HoppTab<HoppTestRunnerDocument>,
  collection: HoppCollection,
  config: TestRunnerConfig,
  ancestors: {
    pre?: string[]
    test?: string[]
    variables?: HoppCollectionVariable[]
  } = {},
  previous?: WorkbenchReport,
  recovery?: ManualRunRecovery
) {
  const { add } = useWorkbenchReports()
  const runningTab = ref(tab)
  const id = previous?.id ?? crypto.randomUUID()
  const createdAt = previous?.createdAt ?? new Date().toISOString()
  const started = performance.now()
  return Promise.resolve(
    getService(TestRunnerService).runTests(
      runningTab,
      collection,
      {
        ...config,
        stopRef: ref(false),
        recovery,
        onProgress: async () => {
          const doc = runningTab.value.document
          const steps = collectReportSteps(doc.iterationResults ?? [])
          const status = doc.status === "stopped" ? "paused" : doc.status
          const checkpoint = status === "completed" ? undefined : doc.recovery
          await add({
            id,
            kind: "automation",
            name: collection.name,
            createdAt,
            runTabID: runningTab.value.id,
            updatedAt: new Date().toISOString(),
            environmentID: doc.environmentID,
            environmentName: doc.environmentName,
            source: {
              collectionID: doc.collectionID,
              config: cloneDeep(config),
            },
            recovery: checkpoint,
            canResume: !!checkpoint,
            uncertainRequest:
              status === "error" ? checkpoint?.inFlight : undefined,
            events: previous?.events,
            errorDetails: doc.runError
              ? [{ code: "RUNNER_ERROR", data: reportError(doc.runError) }]
              : [],
            steps,
            summary: {
              completed: steps.length,
              failed:
                steps.filter((step) => !step.passed).length +
                (doc.runError ? 1 : 0),
              elapsedMs:
                (previous?.summary.elapsedMs ?? 0) +
                performance.now() -
                started,
            },
            automation: {
              status,
              totalRequests: doc.testRunnerMeta.totalRequests,
              passedTests: doc.testRunnerMeta.passedTests,
              failedTests: doc.testRunnerMeta.failedTests,
              totalTests: doc.testRunnerMeta.totalTests,
            },
          })
        },
      },
      ancestors.pre,
      ancestors.test,
      ancestors.variables
    )
  )
}

export function resumeRecordedRun(
  report: WorkbenchReport,
  choice?: "retry" | "skip",
  existingTab?: HoppTab<HoppTestRunnerDocument>
) {
  const runner = getService(TestRunnerService)
  const tabID = report.runTabID ?? `resume-${report.id}`
  if (runner.hasRun(tabID)) {
    runner.resumeRun(tabID)
    return
  }
  if (!report.recovery)
    throw new Error("This older report has no recovery snapshot")
  const recovery = cloneDeep(report.recovery)
  if (recovery.inFlight && !choice)
    throw new Error("Choose whether to retry or skip the unknown request")
  const saved = cloneDeep(report)
  if (recovery.inFlight && choice === "skip") {
    const entry = recovery.plan[recovery.nextRequest]
    const request = entry.request
    const step: WorkbenchReportStep = {
      name: `${recovery.iteration + 1} / ${recovery.collection.name} / ${request.name}`,
      requestName: request.name,
      iteration: recovery.iteration + 1,
      method: "method" in request ? request.method : "POST",
      endpoint: "endpoint" in request ? request.endpoint : request.url,
      passed: false,
      errors: ["SKIPPED_UNKNOWN"],
      detailsRecorded: true,
      errorDetails: [
        {
          code: "SKIPPED_UNKNOWN",
          data: "Skipped after interruption; original outcome is unknown",
        },
      ],
    }
    saved.steps = [...(saved.steps ?? []), step]
    recovery.nextRequest++
  }
  saved.events = [
    ...(saved.events ?? []),
    {
      at: new Date().toISOString(),
      action: choice ?? "resume",
      details: saved.errorDetails,
    },
  ]
  recovery.inFlight = undefined
  const restored = savedReportTab(saved)
  const tab = existingTab ?? restored
  if (existingTab) existingTab.document = restored.document
  tab.id = tabID
  tab.document.collection = recovery.collection
  tab.document.config = recovery.config
  // The checkpoint includes the dataset, frozen request plan and environment scopes.
  const task = startRecordedRun(
    tab,
    recovery.collection,
    recovery.config,
    {},
    saved,
    recovery
  )
  void task.catch((error) =>
    console.error("Could not resume automation report", error)
  )
}
