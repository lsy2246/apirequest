import { randomUUID } from "node:crypto"
import type { ServerResponse } from "node:http"

export function createCaptureEvents() {
  const epoch = randomUUID()
  let seq = 0
  const clients = new Set<ServerResponse>()
  const send = (response: ServerResponse, kind: "invalidate" | "resync") => {
    if (response.destroyed || response.writableEnded) {
      clients.delete(response)
      return
    }
    const event = {
      schemaVersion: 1,
      source: "capture",
      epoch,
      seq,
      topic: "capture",
      kind,
    }
    if (
      !response.write(`id: ${epoch}:${seq}\ndata: ${JSON.stringify(event)}\n\n`)
    ) {
      clients.delete(response)
      response.end()
    }
  }
  return {
    publish() {
      ++seq
      for (const response of clients) send(response, "invalidate")
    },
    stream(response: ServerResponse) {
      if (clients.size >= 16) {
        response.writeHead(503)
        response.end()
        return
      }
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      })
      response.flushHeaders()
      clients.add(response)
      send(response, "resync")
      const heartbeat = setInterval(() => {
        if (!response.write(": heartbeat\n\n")) response.end()
      }, 15000)
      const lease = setTimeout(() => response.end(), 5 * 60000)
      heartbeat.unref()
      lease.unref()
      response.once("close", () => {
        clearInterval(heartbeat)
        clearTimeout(lease)
        clients.delete(response)
      })
    },
    close() {
      for (const response of clients) response.end()
      clients.clear()
    },
  }
}
