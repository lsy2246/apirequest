import { ref } from "vue"
import { platform } from "~/platform"
import { getService } from "~/modules/dioc"
import { invoke } from "@tauri-apps/api/core"
import { NATIVE_STORE_SCOPE } from "~/kernel/store"
import * as E from "fp-ts/Either"
import { PersistenceService } from "~/services/persistence"
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
    bodyEncoding?: "base64"
    bodyTruncated?: boolean
  }
  testResults?: import("~/helpers/types/HoppTestResult").HoppTestResult
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
  events?: { at: string; action: string; details?: unknown }[]
  recovery?: import("~/services/test-runner/test-runner.service").ManualRunRecovery
  canResume?: boolean
  uncertainRequest?: { name: string; iteration: number }
  runTabID?: string
  updatedAt?: string
  notification?: import("~/helpers/notification-channels").NotificationDelivery
  backendStored?: boolean
  errorDetails?: { code: string; data: unknown }[]
  trigger?: "schedule"
  createdAt: string
  summary: { completed: number; failed: number; elapsedMs: number }
  automation?: {
    totalRequests?: number
    status: string
    passedTests: number
    failedTests: number
    totalTests: number
  }
  steps?: WorkbenchReportStep[]
  load?: LoadTestReport
}
const reports = ref<WorkbenchReport[]>([])
const storageError = ref("")
let ready: Promise<void> | undefined
let pendingWrite = Promise.resolve()
const storageKey = "workbench-reports-v1"
const reportScope = `${NATIVE_STORE_SCOPE}.reports.v2`
type StoredReport = WorkbenchReport | { id: string; deleted: true }
let deletedIDs = new Set<string>()
let database: Promise<IDBDatabase> | undefined

function browserDB() {
  database ??= new Promise((resolve, reject) => {
    const open = indexedDB.open("apirequest-reports", 1)
    open.onupgradeneeded = () =>
      open.result.createObjectStore("reports", { keyPath: "id" })
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => {
      database = undefined
      reject(open.error)
    }
  })
  return database
}
async function browserReports(value?: StoredReport): Promise<StoredReport[]> {
  const db = await browserDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("reports", value ? "readwrite" : "readonly")
    const store = tx.objectStore("reports")
    const request = value ? store.put(value) : store.getAll()
    tx.oncomplete = () =>
      resolve(value ? [] : (request.result as StoredReport[]))
    tx.onerror = tx.onabort = () =>
      reject(tx.error ?? new Error("Report storage failed"))
  })
}
async function write(report: StoredReport) {
  if (!platform.localDesktop) {
    await browserReports(report)
    return
  }
  await invoke("workbench_store", {
    action: { type: "put", scope: reportScope, key: report.id, value: report },
  })
}
function validate(values: unknown): WorkbenchReport[] {
  return Array.isArray(values)
    ? values.filter(
        (item) =>
          item &&
          typeof item.id === "string" &&
          ["load", "automation"].includes(item.kind) &&
          typeof item.name === "string" &&
          typeof item.summary?.completed === "number"
      )
    : []
}
const inProgress = (report: WorkbenchReport) =>
  ["running", "pausing", "paused"].includes(report.automation?.status ?? "")
async function load() {
  // Read failures must not be treated as an empty history and overwrite saved reports.
  const legacy = await getService(PersistenceService).get<string>(storageKey)
  if (E.isLeft(legacy)) throw new Error(legacy.left.message)
  const previous = validate(legacy.right ? JSON.parse(legacy.right) : [])
  let values: StoredReport[]
  if (platform.localDesktop) {
    values = []
    for (let skip = 0; ; skip += 100) {
      const page = await invoke<StoredReport[]>("workbench_store", {
        action: { type: "page", scope: reportScope, skip, take: 100 },
      })
      values.push(...page)
      if (page.length < 100) break
    }
  } else values = await browserReports()
  deletedIDs = new Set(
    values
      .filter((value) => value && "deleted" in value && value.deleted === true)
      .map((value) => value.id)
  )
  const byID = new Map(
    validate(values)
      .filter((report) => !deletedIDs.has(report.id))
      .map((report) => [report.id, report])
  )
  for (const report of previous)
    if (!byID.has(report.id) && !deletedIDs.has(report.id)) {
      await write(report)
      byID.set(report.id, report)
    }
  // A restarted process cannot resume an old in-memory execution. Keep all recorded results.
  for (const report of byID.values())
    if (inProgress(report)) {
      report.automation = { ...report.automation!, status: "interrupted" }
      report.canResume = !!report.recovery
      report.uncertainRequest = report.recovery?.inFlight
      await write(report)
    }
  reports.value = [...byID.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  )
}
export function useWorkbenchReports() {
  ready ??= load().catch((error) => {
    storageError.value = String(error instanceof Error ? error.message : error)
    ready = undefined
    throw error
  })
  // Consumers can show the shared error without an unhandled rejection on mount.
  void ready.catch(() => {})
  const currentReady = ready
  const add = async (report: WorkbenchReport) => {
    const snapshot: WorkbenchReport = JSON.parse(JSON.stringify(report))
    try {
      await currentReady
    } catch (error) {
      // Keep this execution exportable even when existing history cannot be read.
      reports.value = [
        snapshot,
        ...reports.value.filter((item) => item.id !== report.id),
      ]
      throw error
    }
    if (deletedIDs.has(report.id)) return
    reports.value = [
      snapshot,
      ...reports.value.filter((item) => item.id !== report.id),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const operation = pendingWrite
      .catch(() => {})
      .then(async () => {
        if (!deletedIDs.has(report.id)) await write(snapshot)
      })
    pendingWrite = operation
    try {
      await operation
      storageError.value = ""
    } catch (error) {
      storageError.value = String(
        error instanceof Error ? error.message : error
      )
      throw error
    }
  }
  const remove = async (id: string) => {
    await currentReady
    const operation = pendingWrite
      .catch(() => {})
      .then(async () => {
        const report = reports.value.find((item) => item.id === id)
        if (
          report &&
          ["running", "pausing"].includes(report.automation?.status ?? "")
        )
          throw new Error("Cannot delete an active report")
        // Erase the content and retain only the ID so legacy migration cannot restore it.
        await write({ id, deleted: true })
        deletedIDs.add(id)
        reports.value = reports.value.filter((item) => item.id !== id)
      })
    pendingWrite = operation
    await operation
  }
  return { reports, ready: currentReady, add, remove, storageError }
}

export function downloadWorkbenchReport(
  report: WorkbenchReport | LoadTestReport
) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ ...report, recovery: undefined }, null, 2)], {
      type: "application/json",
    })
  )
  const link = document.createElement("a")
  link.href = url
  link.download = `report-${report.id}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
