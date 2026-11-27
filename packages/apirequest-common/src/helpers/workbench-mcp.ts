import type { AutomationConfig } from "@apirequest/data"
import { serviceLimitMessage } from "./service-limit-error"
import { platform } from "~/platform"

export type McpProposal = {
  id: string
  status: string
  createdAt: number
  expiresAt: number
  automatic?: boolean
  change: {
    entity: string
    operation: string
    reason: string
    id?: string
    data?: unknown
  }
  changedFields?: string[]
  before: unknown
  after: unknown
  result?: unknown
  error?: string
}
export type SavedWorkbenchPlan = {
  id: string
  name: string
  collectionID?: string
  requestID?: string
  environmentID?: string
  config?: Partial<AutomationConfig> & {
    mode?: "requests" | "duration"
    concurrency?: number
    requests?: number
    durationSeconds?: number
    timeoutMs?: number
  }
  url?: string
  protocols?: string[]
}

export type AutomationScheduleRule =
  | { type: "interval"; minutes: number }
  | { type: "daily"; time: string; timezone: string }
  | { type: "weekly"; time: string; timezone: string; weekday: number }

export type AutomationSchedule = {
  planID: string
  environmentID: string | null
  rule: AutomationScheduleRule | null
  draftRule?: AutomationScheduleRule | null
  nextRunAt: number | null
}

export const workbenchSchedulesAvailable = () =>
  !import.meta.env.VITE_WORKBENCH_NATIVE && !platform.localDesktop

export async function workbenchMcpAPI<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  if (import.meta.env.VITE_WORKBENCH_NATIVE || platform.localDesktop) {
    const { nativeMcpAPI } = await import("./native-workbench-mcp")
    return nativeMcpAPI<T>(path, body)
  }
  const base = import.meta.env.VITE_BACKEND_API_URL.replace(/\/$/, "")
  const send = () =>
    fetch(`${base}/workbench-mcp/${path}`, {
      credentials: "include",
      cache: "no-store",
      signal,
      method: body === undefined ? "GET" : "POST",
      headers: {
        "X-Workbench-Local": "1",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  let response = await send()
  // 仅在实际过期时重新领取原有本机会话，不将 MCP 令牌放入浏览器存储。
  if (response.status === 401) {
    await platform.auth.performAuthInit()
    response = await send()
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(
      serviceLimitMessage(response.status, data, response.headers?.get("Retry-After")) ??
        (typeof data.message === "string" ? data.message : `HTTP ${response.status}`)
    )
  }
  return response.json()
}

/** Continue only when the server advances the offset. */
export async function listWorkbenchConfigs<T>(
  kind: string,
  signal?: AbortSignal
): Promise<T[]> {
  const path = `configs/${encodeURIComponent(kind)}`
  const items: T[] = []
  let offset = 0
  for (;;) {
    const page = await workbenchMcpAPI<{ items: T[]; nextOffset?: number | null }>(
      offset === 0 ? path : `${path}?offset=${offset}`, undefined, signal
    )
    items.push(...page.items)
    if (page.nextOffset == null) return items
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset)
      throw new Error("配置列表未返回下一页，请重试")
    offset = page.nextOffset
  }
}
