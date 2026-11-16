import type { RelayResponse } from "@apirequest/kernel";
import { platform } from "~/platform";
import { archiveNativeHistory, nativeHistoryAPI, nativeHistoryURL } from "./native-workbench-history";

export type HistoryResultKind = "json" | "text" | "image" | "video" | "file"
export type HistoryCleanupReport = { count: number; bytes: string }

export type HistoryResultPolicy = {
  enabled: boolean
  autoCleanup: boolean
  retentionDays: number
  excludedRequestIds: string[]
  lastCleanupAt: string | null
  lastCleanup: HistoryCleanupReport | null
}

type HistoryResultMetadata = {
  requestId?: string
  statusCode?: number
  statusText?: string
  duration?: number
  headers: { key: string; value: string }[]
  contentType: string
}

export type HistoryResultDetail =
  | {
      state: "missing" | "cleaned"
      summary?: { statusCode?: number | null; duration?: number | null }
    }
  | {
      state: "saved"
      kind: HistoryResultKind
      size: string
      metadata: HistoryResultMetadata
      canAttach: boolean
      attachments: {
        id: string
        name: string
        contentType: string
        size: string
      }[]
    }

export type HistoryResultSnapshot = {
  requestId?: string
  statusCode: number
  statusText: string
  duration: number
  headers: { key: string; value: string }[]
  body: ArrayBuffer | Uint8Array
}

// 正文只在当次同步任务中持有，不进入浏览器的历史列表缓存。
export const historyResultSnapshots = new WeakMap<
  object,
  HistoryResultSnapshot
>()

export function captureHistoryResult<T extends object>(
  entry: T,
  snapshot?: HistoryResultSnapshot
): T {
  if (
    snapshot &&
    (import.meta.env.VITE_WORKBENCH_NATIVE ||
      window.__APIREQUEST_NATIVE__ ||
      platform.auth.localSessionState?.value === "ready")
  ) {
    historyResultSnapshots.set(entry, snapshot)
  }
  return entry
}

export function captureGraphqlHistoryResult<T extends { response: string }>(
  entry: T,
  requestId: string | undefined,
  response?: RelayResponse,
  duration = 0
): T {
  if (
    !response ||
    (!(import.meta.env.VITE_WORKBENCH_NATIVE || window.__APIREQUEST_NATIVE__) &&
      platform.auth.localSessionState?.value !== "ready")
  )
    return entry
  return captureHistoryResult(
    { ...entry, response: "" },
    {
      requestId,
      statusCode: response.status,
      statusText: response.statusText,
      duration,
      headers: Object.entries(response.headers ?? {}).map(([key, value]) => ({
        key,
        value: String(value),
      })),
      body: response.body.body,
    }
  )
}

export function historyResultURL(path: string) {
  if (import.meta.env.VITE_WORKBENCH_NATIVE || window.__APIREQUEST_NATIVE__)
    return nativeHistoryURL(path)
  return `${import.meta.env.VITE_BACKEND_API_URL}/workbench-history-results/${path}`
}

export async function historyResultAPI<T>(path: string, options?: RequestInit) {
  if (import.meta.env.VITE_WORKBENCH_NATIVE || window.__APIREQUEST_NATIVE__)
    return nativeHistoryAPI<T>(path, options)
  const response = await fetch(historyResultURL(path), {
    credentials: "include",
    ...options,
  })
  if (!response.ok)
    throw new Error(`History results request failed (${response.status})`)
  return (await response.json()) as T
}

let pendingPolicy: Promise<HistoryResultPolicy> | undefined
export const pendingHistoryResults = new Map<string, Promise<void>>()

export function uploadHistoryResult(
  historyId: string,
  snapshot: HistoryResultSnapshot
) {
  const pending = persistHistoryResult(historyId, snapshot).finally(() => {
    pendingHistoryResults.delete(historyId)
  })
  pendingHistoryResults.set(historyId, pending)
  return pending
}

async function persistHistoryResult(
  historyId: string,
  snapshot: HistoryResultSnapshot
) {
  try {
    if (import.meta.env.VITE_WORKBENCH_NATIVE || window.__APIREQUEST_NATIVE__) {
      await archiveNativeHistory(historyId, snapshot)
      return
    }
    pendingPolicy ??= historyResultAPI<HistoryResultPolicy>("policy").finally(
      () => {
        pendingPolicy = undefined
      }
    )
    if (!(await pendingPolicy).enabled) return
    const { body, ...metadata } = snapshot
    const contentType =
      metadata.headers.find(({ key }) => key.toLowerCase() === "content-type")
        ?.value ?? "application/octet-stream"
    await historyResultAPI(encodeURIComponent(historyId), {
      method: "PUT",
      body: new Blob(
        [
          JSON.stringify({ ...metadata, contentType }) + "\n",
          body instanceof ArrayBuffer ? body : new Uint8Array(body),
        ],
        {
          type: "application/octet-stream",
        }
      ),
    })
  } catch {
    // 保存结果和接口执行独立，写盘失败不重试原请求。
    console.warn("Could not save the history result")
  }
}

export function formatBytes(value: string) {
  const bytes = Number(value)
  for (const [scale, unit] of [
    [2 ** 30, "GiB"],
    [2 ** 20, "MiB"],
    [2 ** 10, "KiB"],
  ] as const) {
    if (bytes >= scale) return `${(bytes / scale).toFixed(1)} ${unit}`
  }
  return `${value} B`
}
