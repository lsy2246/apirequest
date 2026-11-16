import { reactive, ref } from "vue";
import { parseWorkbenchEvent, readWorkbenchEvents, type WorkbenchEvent } from "~/helpers/workbench-realtime";

export type LiveSource = "capture" | "backend"
type Status = "connecting" | "live" | "reconnecting" | "offline"
type Subscriber = { source: LiveSource; topics: string[]; receive: () => void }
type Connection = { controller: AbortController; close?: () => void }
const subscribers = new Set<Subscriber>()
const connections = new Map<string, Connection>()
export const liveStatus = reactive<Record<string, Status>>({})
export const captureAuthenticationRequired = ref(false)

const native = () =>
  !!import.meta.env.VITE_WORKBENCH_NATIVE ||
  window.__APIREQUEST_NATIVE__ === true
export const liveSourceKey = (source: LiveSource) =>
  native() ? "desktop" : source

function deliver(source: string, event: WorkbenchEvent) {
  for (const subscriber of subscribers) {
    if (liveSourceKey(subscriber.source) !== source) continue
    if (event.kind === "resync" || subscriber.topics.includes(event.topic))
      subscriber.receive()
  }
}

// JS-owned desktop configuration changes use the same invalidation path as IPC.
export function notifyWorkbenchChange(topic: string) {
  if (!native()) return
  for (const subscriber of subscribers) {
    if (subscriber.source === "backend" && subscriber.topics.includes(topic))
      subscriber.receive()
  }
}

function stop(key: string) {
  const connection = connections.get(key)
  if (!connection) return
  connections.delete(key)
  connection.controller.abort()
  connection.close?.()
  liveStatus[key] = "offline"
}

function connect(key: string, source: LiveSource) {
  if (connections.has(key)) return
  if (key !== "desktop" && !navigator.onLine) {
    liveStatus[key] = "offline"
    return
  }
  const connection: Connection = { controller: new AbortController() }
  connections.set(key, connection)
  const signal = connection.controller.signal
  liveStatus[key] = "connecting"
  if (key === "desktop") {
    void import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        const close = await listen("workbench-event", ({ payload }) => {
          if (signal.aborted) return
          try {
            deliver(key, parseWorkbenchEvent(payload))
          } catch {
            /* Ignore other IPC payloads. */
          }
        })
        if (signal.aborted) return close()
        connection.close = close
        liveStatus[key] = "live"
        deliver(key, {
          schemaVersion: 1,
          source: key,
          epoch: "",
          seq: 0,
          topic: "*",
          kind: "resync",
        })
      })
      .catch(() => {
        if (!signal.aborted) liveStatus[key] = "offline"
      })
    return
  }
  void (async () => {
    let attempts = 0
    while (!signal.aborted) {
      try {
        const capture = source === "capture"
        const url = capture
          ? "/__workbench_capture/events"
          : `${import.meta.env.VITE_BACKEND_API_URL.replace(/\/$/, "")}/workbench-mcp/events`
        const send = () =>
          fetch(url, {
            credentials: "include",
            cache: "no-store",
            signal,
            headers: capture
              ? { "X-Workbench-Capture": "1" }
              : { "X-Workbench-Local": "1" },
          })
        let response = await send()
        if (response.status === 401 && !capture) {
          const { platform } = await import("~/platform")
          await platform.auth.performAuthInit()
          if (signal.aborted) break
          response = await send()
        }
        if (capture && response.status === 401)
          captureAuthenticationRequired.value = true
        if (
          !response.ok ||
          !response.body ||
          !response.headers.get("content-type")?.includes("text/event-stream")
        )
          throw new Error("stream_unavailable")
        let ready = false
        let epoch = "",
          seq = -1
        await readWorkbenchEvents(response.body, (event) => {
          if (signal.aborted) return
          if (!ready) {
            ready = true
            attempts = 0
            liveStatus[key] = "live"
          }
          if (
            event.epoch === epoch &&
            event.seq <= seq &&
            event.kind !== "resync"
          )
            return
          // A source epoch change or missed invalidation requires a complete reread.
          if (epoch && (epoch !== event.epoch || event.seq > seq + 1))
            deliver(key, { ...event, kind: "resync" })
          else deliver(key, event)
          epoch = event.epoch
          seq = event.seq
        })
        if (!signal.aborted) throw new Error("stream_closed")
      } catch {
        if (signal.aborted) break
        liveStatus[key] = "reconnecting"
        const delay =
          Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)) +
          Math.random() * 300
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer)
            signal.removeEventListener("abort", done)
            resolve()
          }
          const timer = setTimeout(done, delay)
          signal.addEventListener("abort", done, { once: true })
        })
      }
    }
  })()
}

export function subscribeWorkbench(
  source: LiveSource,
  topics: string[],
  receive: () => void
) {
  const subscriber = { source, topics, receive }
  subscribers.add(subscriber)
  const key = liveSourceKey(source)
  connect(key, source)
  // Every subscription starts with an up-to-date snapshot.
  receive()
  return () => {
    subscribers.delete(subscriber)
    if (![...subscribers].some((entry) => liveSourceKey(entry.source) === key))
      stop(key)
  }
}

const offline = () => {
  if (!native()) for (const key of connections.keys()) stop(key)
}
const online = () => {
  for (const subscriber of subscribers)
    connect(liveSourceKey(subscriber.source), subscriber.source)
}
window.addEventListener("offline", offline)
window.addEventListener("online", online)

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    window.removeEventListener("offline", offline)
    window.removeEventListener("online", online)
    for (const key of connections.keys()) stop(key)
  })
