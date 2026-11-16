import { platform } from "~/platform"

export type RuleServer = {
  id: string
  name: string
  url: string
  isActive: boolean
  kind: "single" | "collection"
  revision: number
  options?: MockOptions
  states?: Record<string, string>
  rules: MockRulePreview[]
}
export type MockRulePreview = Pick<
  MockRule,
  | "id"
  | "name"
  | "enabled"
  | "method"
  | "path"
  | "exhausted"
  | "secure"
  | "pathMode"
  | "priority"
  | "expiresAt"
  | "scenario"
> & {
  hits: number
  steps: Pick<
    MockRule["steps"][number],
    "action" | "statusCode" | "times" | "delayMs"
  >[]
}
export type MockRule = {
  id: string
  name: string
  enabled: boolean
  method: string
  path: string
  secure?: boolean | null
  pathMode?: "template" | "exact" | "glob" | "regex"
  priority?: number
  expiresAt?: string | null
  scenario?: { name: string; requiredState: string; nextState: string }
  conditions: {
    source: "query" | "header" | "body" | "cookie"
    operator?:
      | "equals"
      | "not_equals"
      | "contains"
      | "regex"
      | "exists"
      | "absent"
      | "gt"
      | "gte"
      | "lt"
      | "lte"
      | "json_contains"
      | "json_schema"
      | "jsonpath"
      | "xpath"
    namespaces?: Record<string, string>
    key: string
    value: string
  }[]
  steps: {
    action:
      | "http"
      | "disconnect"
      | "sse"
      | "file"
      | "forward"
      | "websocket"
      | "script"
      | "callback"
    cookies?: string[]
    script?: { code: string; timeoutMs: number }
    callback?: {
      url: string
      headers: Record<string, string>
      timeoutMs: number
    }
    template?: boolean
    forward?: MockForward
    websocket?: MockWebSocket
    intervalMs: number
    disconnectAfter: boolean
    statusCode: number
    times: number
    delayMs: number | null
    headers: Record<string, string>
    body: string
    file?: {
      name: string
      contentType: string
      data: string
      disposition: "inline" | "attachment"
    }
  }[]
  exhausted: "repeat_last" | "loop" | "fallthrough"
}
export type MockRuleState = {
  kind?: "single" | "collection"
  revision: number
  rules: MockRule[]
  hits: Record<string, number>
  states?: Record<string, string>
  options?: MockOptions
}

export function mockRuleStatus(rule: MockRulePreview, active: boolean) {
  if (rule.expiresAt && Date.parse(rule.expiresAt) <= Date.now())
    return "expired"
  if (!rule.enabled) return "disabled"
  if (!active) return "paused"
  if (
    rule.exhausted === "fallthrough" &&
    rule.hits >= rule.steps.reduce((sum, step) => sum + step.times, 0)
  )
    return "exhausted"
  return "active"
}

export function nextMockStep(rule: MockRulePreview) {
  const total = rule.steps.reduce((sum, step) => sum + step.times, 0)
  if (rule.exhausted === "fallthrough" && rule.hits >= total) return undefined
  let remaining =
    rule.exhausted === "loop"
      ? (rule.hits % total) + 1
      : Math.min(rule.hits + 1, total)
  return rule.steps.find((step) => (remaining -= step.times) <= 0)
}
export type MockRuleLog = {
  id: string
  requestMethod: string
  requestPath: string
  responseStatus: number
  responseTime: number
  executedAt: string
  mockMatch?: {
    ruleID?: string
    unmatched?: boolean
    name?: string
    hit?: number
    step?: number
    action?: MockRule["steps"][number]["action"]
    trace?: MockTrace[]
    upstream?: string
    recorded?: boolean
    requestTruncated?: boolean
    bodyTruncated?: boolean
  }
}

export async function mockRuleAPI<T>(path = "", data?: unknown): Promise<T> {
  if (window.__APIREQUEST_NATIVE__) {
    const { invoke } = await import("@tauri-apps/api/core")
    return invoke<T>("workbench_mock_rules", {
      path,
      data: data ?? null,
      write: data !== undefined,
    })
  }
  const base = import.meta.env.VITE_BACKEND_API_URL.replace(/\/$/, "")
  const url = `${base}/workbench-mock-rules${path ? `/${path}` : ""}`
  const send = () =>
    fetch(url, {
      credentials: "include",
      cache: "no-store",
      method: data === undefined ? "GET" : "POST",
      headers: {
        "X-Workbench-Local": "1",
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    })
  let response = await send()
  if (response.status === 401) {
    await platform.auth.performAuthInit()
    response = await send()
  }
  const payload = await response.json()
  if (!response.ok)
    throw new Error(payload.message || `HTTP ${response.status}`)
  return payload as T
}

export type MockForward = {
  url: string
  path?: string
  method?: string
  headers: Record<string, string>
  removeHeaders: string[]
  timeoutMs: number
  preserveQuery: boolean
}
export type MockMessage = string | { type: "binary"; data: string }
export type MockWebSocket = {
  messages: MockMessage[]
  matchers: {
    operator: "equals" | "contains" | "regex" | "any"
    value: string
    replies: MockMessage[]
    type?: "text" | "binary" | "any"
    close?: boolean
  }[]
  closeCode: number
}
export type MockOptions = { recording?: boolean; fallback?: MockForward }
export type MockTrace = {
  ruleID: string
  name: string
  matched: boolean
  reasons: {
    code: string
    field?: string
    actual?: unknown
    expected?: unknown
  }[]
}
export type MockRequest = {
  method: string
  path: string
  headers: Record<string, string>
  body: unknown
  rawBody?: string
  protocol?: "http" | "websocket"
}
export type MockLogDetail = MockRuleLog & {
  requestHeaders: Record<string, string>
  requestQuery?: Record<string, unknown>
  requestBody?: unknown
  responseHeaders: Record<string, string>
  responseBody?: unknown
}
export const defaultForward = (): MockForward => ({
  url: "",
  path: "",
  method: "",
  headers: {},
  removeHeaders: [],
  timeoutMs: 30000,
  preserveQuery: true,
})
export const defaultWebSocket = (): MockWebSocket => ({
  messages: ["connected"],
  matchers: [],
  closeCode: 1000,
})
