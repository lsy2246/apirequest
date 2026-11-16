import { invoke } from "@tauri-apps/api/core"
import { HoppRESTReqBody, type HoppRESTRequest } from "@apirequest/data"
import { getDefaultRESTRequest } from "~/helpers/rest/default"

export type CaptureSummary = {
  sequence?: number
  application?: string
  processId?: number
  sessionId?: string
  id: string
  method: string
  url: string
  protocol: string
  startedAt: number
  status?: number
  firstByteMs?: number
  elapsedMs?: number
  failed?: boolean
  paused?: "request" | "response" | null
  originalRequest?: boolean
  replayable?: boolean
  contentType?: string
  requestSize?: number
  responseSize?: number
  client?: string
  server?: string
}

export type CaptureBody = {
  text: string | null
  size: number
  truncated: boolean
  base64?: string
  offset?: number
}
export type CaptureHeaders = [string, string][]
export type CaptureEntry = CaptureSummary & {
  urlTruncated?: boolean
  requestHeaders: CaptureHeaders
  requestHeadersTruncated?: boolean
  requestTrailers?: CaptureHeaders
  responseHeaders?: CaptureHeaders
  responseProtocol?: string
  requestBody?: CaptureBody
  responseBody?: CaptureBody
  requestComplete?: boolean
  responseComplete?: boolean
  timingOffsets?: Partial<
    Record<"dns" | "connect" | "ssl" | "send" | "wait" | "receive", number>
  >
  timings?: Partial<
    Record<
      "dns" | "connect" | "ssl" | "send" | "wait" | "receive",
      number | null
    >
  >
  ruleTrace?: { action: string; name: string; match: string }[]
  frameCount?: number
  frames?: CaptureFrame[]
}
export type CaptureFrame = {
  outgoing: boolean
  text: string | null
  size: number
  timestamp?: number
  base64?: string
}
export type CaptureMode = "system" | "local"
export type CaptureConnection = {
  mode: CaptureMode
  endpoint?: string | null
  processes: string[]
}
export type CaptureState = {
  revision: number
  systemProxy: boolean
  service: string
  server: boolean
  capabilities: { local: boolean }

  recording?: boolean
  mode?: CaptureMode
  endpoint?: string
  archiveID?: string
  archiveStatus?: { dropped: number }
  state: "stopped" | "starting" | "running" | "stopping"
  error: string
  proxy: string
}

export async function captureAPI<T>(
  path = "",
  body?: object,
  signal?: AbortSignal
): Promise<T> {
  if (import.meta.env.VITE_WORKBENCH_NATIVE) {
    try {
      return await invoke<T>("workbench_capture", {
        action: path.replace(/^\//, ""),
        body,
      })
    } catch (error) {
      throw new Error(typeof error === "string" ? error : "engine_unavailable")
    }
  }
  const response = await fetch(`/__workbench_capture${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "X-Workbench-Capture": "1",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal,
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || !result)
    throw new Error(result?.error || "engine_unavailable")
  return result
}

function parseCaptureURL(value: string) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export function captureToRequest(
  entry: CaptureEntry
): HoppRESTRequest | undefined {
  if (
    !entry.requestComplete ||
    entry.urlTruncated ||
    entry.requestHeadersTruncated
  )
    return
  const url = parseCaptureURL(entry.url)
  if (
    !url ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    return
  const source = entry.requestBody
  if (source?.truncated || source?.text === null) return
  if (
    entry.requestHeaders.some(
      ([key, value]) =>
        key.toLowerCase() === "content-encoding" &&
        value.toLowerCase() !== "identity"
    )
  )
    return
  const contentType = entry.requestHeaders.find(
    ([key]) => key.toLowerCase() === "content-type"
  )?.[1]
  const type = contentType?.split(";", 1)[0].trim().toLowerCase()
  const body = source?.size
    ? HoppRESTReqBody.safeParse({
        contentType: type || "text/plain",
        body: source.text,
      })
    : HoppRESTReqBody.safeParse({ contentType: null, body: null })
  if (
    !body.success ||
    Array.isArray(body.data.body) ||
    (source?.size && typeof body.data.body !== "string")
  )
    return
  // 长度、传输和代理头由工作台重新生成，原始认证头随请求配置保留。
  const connectionHeaders = new Set([
    "host",
    "content-length",
    "connection",
    "proxy-connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
    "te",
    "trailer",
  ])
  return {
    ...getDefaultRESTRequest(),
    name: `${entry.method} ${url.pathname}`,
    method: entry.method,
    endpoint: entry.url,
    headers: entry.requestHeaders
      .filter(([key]) => !connectionHeaders.has(key.toLowerCase()))
      .map(([key, value]) => ({ key, value, active: true, description: "" })),
    body: body.data,
  }
}

const contentType = (headers?: CaptureHeaders) =>
  headers?.find(([key]) => key.toLowerCase() === "content-type")?.[1] ?? ""

export function captureHar(
  entries: CaptureEntry | CaptureEntry[],
  includeBodies = false
) {
  const headers = (values?: CaptureHeaders) =>
    (values ?? []).map(([name, value]) => ({ name, value }))
  const content = (body?: CaptureBody, complete = true) => {
    if (!includeBodies || !body) return {}
    if (body.base64) return { text: body.base64, encoding: "base64" }
    return body.text === null
      ? {}
      : { text: body.text, ...(body.truncated ? { _truncated: true } : {}) }
  }
  return {
    log: {
      version: "1.2",
      creator: { name: "ApiRequest", version: "1" },
      entries: (Array.isArray(entries) ? entries : [entries]).map((entry) => {
        const url = new URL(entry.url)
        const elapsed = entry.elapsedMs ?? entry.firstByteMs ?? 0
        const { encoding, ...requestContent } = content(
          entry.requestBody,
          entry.requestComplete
        )
        return {
          startedDateTime: new Date(entry.startedAt).toISOString(),
          time: elapsed,
          request: {
            method: entry.method,
            url: entry.url,
            httpVersion: entry.protocol,
            cookies: [],
            headers: headers(entry.requestHeaders),
            ...(entry.requestHeadersTruncated
              ? { _headersTruncated: true }
              : {}),
            queryString: [...url.searchParams].map(([name, value]) => ({
              name,
              value,
            })),
            headersSize: -1,
            bodySize: entry.requestBody?.size ?? -1,
            ...("text" in requestContent
              ? {
                  postData: {
                    mimeType: contentType(entry.requestHeaders),
                    ...requestContent,
                    ...(encoding ? { _encoding: encoding } : {}),
                  },
                }
              : {}),
          },
          response: {
            status: entry.status ?? 0,
            statusText: "",
            httpVersion: entry.responseProtocol ?? entry.protocol,
            cookies: [],
            headers: headers(entry.responseHeaders),
            redirectURL: "",
            content: {
              size: entry.responseBody?.size ?? 0,
              mimeType: contentType(entry.responseHeaders),
              ...content(
                entry.responseBody,
                entry.responseComplete ?? entry.elapsedMs !== undefined
              ),
            },
            headersSize: -1,
            bodySize: entry.responseBody?.size ?? -1,
          },
          cache: {},
          timings: {
            ...entry.timings,
            send: entry.timings?.send ?? 0,
            wait: entry.firstByteMs ?? elapsed,
            receive: Math.max(0, elapsed - (entry.firstByteMs ?? elapsed)),
          },
          ...(includeBodies && entry.frames?.length
            ? { _webSocketMessages: entry.frames }
            : {}),
        }
      }),
    },
  }
}

export type SavedCapture = {
  id: string
  name: string
  date: number
  entries: CaptureEntry[]
}

export async function savedCaptures<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("apirequest-capture", 1)
    request.onupgradeneeded = () =>
      request.result.createObjectStore("sessions", { keyPath: "id" })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction("sessions", mode)
      const request = operation(transaction.objectStore("sessions"))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

export type CaptureArchive = {
  id: string
  name: string
  date: number
  count: number
  bytes: number
  dropped: number
  active: boolean
}
export type CaptureColumnFilter =
  string | string[] | { min?: number; max?: number }
export type CaptureColumnFilters = Partial<Record<string, CaptureColumnFilter>>
export type CapturePage = {
  methods?: string[]
  applications?: string[]
  boundary?: number
  entries: CaptureSummary[]
  total: number
  hosts: string[]
  clients: string[]
}
export type CaptureRule = {
  action: "pause_request" | "pause_response" | "rewrite" | "local" | "network"
  enabled: boolean
  name: string
  match: string
  method: string
  value: string
  status: number
  contentType: string
  delayMs: number
  loss: number
}
export function newCaptureRule(): CaptureRule {
  return {
    action: "pause_request",
    enabled: true,
    name: "",
    match: "/api/",
    method: "",
    value: "",
    status: 200,
    contentType: "application/json",
    delayMs: 500,
    loss: 0,
  }
}
export function captureKind(entry: CaptureSummary): string {
  const type = (entry.contentType ?? "").toLowerCase()
  return entry.status === 101
    ? "WebSocket"
    : type.includes("event-stream")
      ? "SSE"
      : type.includes("json")
        ? "JSON"
        : type.startsWith("image/")
          ? "image"
          : new URL(entry.url).protocol.replace(":", "")
}
export function parseCaptureEvents(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n\n")
    .slice(0, -1)
    .filter(Boolean)
    .map((block, index) => {
      const event = { id: "", event: "message", data: "", index }
      const data: string[] = []
      for (const line of block.split("\n")) {
        if (line.startsWith(":")) continue
        const split = line.indexOf(":")
        const key = split < 0 ? line : line.slice(0, split)
        let value = split < 0 ? "" : line.slice(split + 1)
        if (value.startsWith(" ")) value = value.slice(1)
        if (key === "data") data.push(value)
        else if (key === "event" || key === "id") event[key] = value
      }
      event.data = data.join("\n")
      return event
    })
    .filter((event) => event.data)
}

// 本机控制与磁盘归档共用一个接口，不再传递设备标识或接入凭据。
export const captureControl = <T>(
  action: string,
  input: object = {},
  signal?: AbortSignal
) => captureAPI<T>("/capture_api", { action, input }, signal)
