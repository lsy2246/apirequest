import type { AutomationConfig } from "@apirequest/data"
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
      typeof data.message === "string"
        ? data.message
        : `HTTP ${response.status}`
    )
  }
  return response.json()
}
