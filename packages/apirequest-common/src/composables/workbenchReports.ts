import { ref } from "vue"
import { getService } from "~/modules/dioc"
import { Store } from "~/kernel/store"
import * as E from "fp-ts/Either"
import { PersistenceService, STORE_NAMESPACE } from "~/services/persistence"
import type { LoadTestReport } from "~/helpers/load-test/runner"

export type WorkbenchReportStep = {
  name: string
  requestName?: string
  method?: string
  endpoint?: string
  iteration?: number
  passed: boolean
  elapsedMs?: number
  statusCode?: number
  passedTests?: number
  failedTests?: number
  errors: string[]
  detailsRecorded?: boolean
  errorDetails?: { code: string; data: unknown }[]
  response?: {
    statusCode: number
    statusText: string
    headers: { key: string; value: string }[]
    body: string
    bodyTruncated?: boolean
  }
  responseOmitted?: boolean
  assertions?: {
    descriptor: string
    passed: number
    failed: number
    expectResults: { status: string; message: string }[]
  }[]
}

export type WorkbenchReport = {
  id: string
  kind: "load" | "automation"
  name: string
  environmentID?: string | null
  environmentName?: string
  source?: {
    collectionID: string
    config: import("~/helpers/tab/document").TestRunnerConfig
  }
  trigger?: "schedule"
  createdAt: string
  summary: { completed: number; failed: number; elapsedMs: number }
  automation?: {
    status: string
    passedTests: number
    failedTests: number
    totalTests: number
  }
  steps?: WorkbenchReportStep[]
  load?: LoadTestReport
}
const reports = ref<WorkbenchReport[]>([])
let ready: Promise<void> | undefined
let pendingWrite = Promise.resolve()
const storageKey = "workbench-reports-v1"

export function useWorkbenchReports() {
  const persistence = getService(PersistenceService)
  ready ??= persistence
    .getNullable<string>(storageKey)
    .then((raw) => {
      try {
        const values: unknown = raw ? JSON.parse(raw) : []
        if (Array.isArray(values))
          reports.value = values
            .filter(
              (item) =>
                item &&
                typeof item.id === "string" &&
                ["load", "automation"].includes(item.kind) &&
                typeof item.name === "string" &&
                typeof item.summary?.completed === "number"
            )
            .slice(0, 20)
      } catch {
        reports.value = []
      }
    })
    .catch(() => {
      reports.value = []
    })
  const add = async (report: WorkbenchReport) => {
    await ready
    // 串行保存执行结果，避免多个完成回调互相覆盖。
    reports.value = [
      report,
      ...reports.value.filter((item) => item.id !== report.id),
    ].slice(0, 20)
    const value = JSON.stringify(reports.value)
    pendingWrite = pendingWrite
      .catch(() => {})
      .then(async () => {
        const saved = await Store.set(STORE_NAMESPACE, storageKey, value)
        if (E.isLeft(saved))
          throw new Error("Failed to persist workbench report")
      })
    await pendingWrite
  }
  return { reports, ready, add }
}

export function downloadWorkbenchReport(
  report: WorkbenchReport | LoadTestReport
) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" })
  )
  const link = document.createElement("a")
  link.href = url
  link.download = `report-${report.id}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
