import { afterEach, describe, expect, it, vi } from "vitest"
import { ReadableStream } from "node:stream/web"
import { subscribeWorkbench } from "../workbench-realtime.service"

const stops: (() => void)[] = []
afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("workbench shared transport", () => {
  it("shares one source connection and closes it after the last subscriber leaves", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>
    let signal!: AbortSignal
    const fetch = vi.fn(
      async (_url: string, options: { signal: AbortSignal }) => {
        signal = options.signal
        return {
          ok: true,
          headers: new Headers({ "content-type": "text/event-stream" }),
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              stream =
                controller as unknown as ReadableStreamDefaultController<Uint8Array>
              signal.addEventListener(
                "abort",
                () => controller.error(new Error("aborted")),
                { once: true }
              )
            },
          }),
        }
      }
    )
    vi.stubGlobal("fetch", fetch)
    const a = vi.fn(),
      b = vi.fn()
    const stopA = subscribeWorkbench("capture", ["capture"], a)
    const stopB = subscribeWorkbench("capture", ["capture"], b)
    stops.push(stopA, stopB)
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(1)
    stream.enqueue(
      new TextEncoder().encode(
        `data: ${JSON.stringify({ schemaVersion: 1, source: "capture", epoch: "a", seq: 0, topic: "capture", kind: "resync" })}\n\n`
      )
    )
    await vi.waitFor(() => expect(a).toHaveBeenCalledTimes(2))
    expect(b).toHaveBeenCalledTimes(2)
    stopA()
    expect(signal.aborted).toBe(false)
    const online = vi.spyOn(navigator, "onLine", "get")
    online.mockReturnValue(false)
    window.dispatchEvent(new Event("offline"))
    expect(signal.aborted).toBe(true)
    online.mockReturnValue(true)
    window.dispatchEvent(new Event("online"))
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(signal.aborted).toBe(false)
    stopB()
    expect(signal.aborted).toBe(true)
    stops.length = 0
  })
})
