export type WorkbenchEvent = {
  schemaVersion: 1
  source: string
  epoch: string
  seq: number
  topic: string
  kind: "invalidate" | "resync"
  scopeId?: string
}

export function parseWorkbenchEvent(value: unknown): WorkbenchEvent {
  const event = value as WorkbenchEvent
  if (
    !event ||
    event.schemaVersion !== 1 ||
    typeof event.source !== "string" ||
    typeof event.epoch !== "string" ||
    !Number.isSafeInteger(event.seq) ||
    event.seq < 0 ||
    typeof event.topic !== "string" ||
    !["invalidate", "resync"].includes(event.kind)
  )
    throw new Error("invalid_event")
  return event
}

// Decode incrementally: network chunks may split UTF-8 characters, lines or events.
export async function readWorkbenchEvents(
  body: ReadableStream<Uint8Array>,
  receive: (event: WorkbenchEvent) => void
) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ""
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      pending += decoder.decode(value, { stream: true })
      let match: RegExpExecArray | null
      while ((match = /\r?\n\r?\n/.exec(pending))) {
        const block = pending.slice(0, match.index)
        pending = pending.slice(match.index + match[0].length)
        if (block.length > 65536) throw new Error("event_too_large")
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n")
        if (data) receive(parseWorkbenchEvent(JSON.parse(data)))
      }
      if (pending.length > 65536) throw new Error("event_too_large")
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
