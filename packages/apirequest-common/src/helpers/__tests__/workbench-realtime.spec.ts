import { describe, expect, it } from "vitest"
import { ReadableStream } from "node:stream/web"
import { readWorkbenchEvents } from "../workbench-realtime"

const event = {
  schemaVersion: 1,
  source: "backend",
  epoch: "session",
  seq: 1,
  topic: "审批",
  kind: "invalidate",
}
function stream(bytes: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      bytes.forEach((chunk) => controller.enqueue(chunk))
      controller.close()
    },
  }) as unknown as globalThis.ReadableStream<Uint8Array>
}
describe("workbench event stream", () => {
  it("decodes split UTF-8, CRLF boundaries and multiple events without treating heartbeats as changes", async () => {
    const bytes = new TextEncoder().encode(
      `: heartbeat\r\n\r\ndata: ${JSON.stringify(event)}\r\n\r\ndata: ${JSON.stringify({ ...event, seq: 2 })}\n\n`
    )
    const received: unknown[] = []
    await readWorkbenchEvents(
      stream([...bytes].map((byte) => new Uint8Array([byte]))),
      (value) => received.push(value)
    )
    expect(received).toEqual([event, { ...event, seq: 2 }])
  })
  it("rejects invalid envelopes and oversized unfinished frames", async () => {
    await expect(
      readWorkbenchEvents(
        stream([new TextEncoder().encode('data: {"schemaVersion":2}\n\n')]),
        () => {}
      )
    ).rejects.toThrow("invalid_event")
    await expect(
      readWorkbenchEvents(stream([new Uint8Array(65537).fill(65)]), () => {})
    ).rejects.toThrow("event_too_large")
  })
})
