import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const fixture = vi.hoisted(() => ({
  storage: new Map<string, unknown>(),
  records: new Map<string, Record<string, unknown>>(),
  replies: new Map<string, (value: unknown) => void>(),
  listener: undefined as
    | undefined
    | ((event: {
        payload: { id: string; name: string; args: Record<string, unknown> }
      }) => void),
  apply: vi.fn(),
}))
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, payload: any) => {
    if (command === "workbench_mcp_reply")
      fixture.replies.get(payload.id)?.(payload)
    if (command === "workbench_mcp_access") return { enabled: true }
  }),
}))
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name, callback) => {
    fixture.listener = callback
    return () => {}
  }),
}))
vi.mock("~/services/workbench-realtime.service", () => ({
  notifyWorkbenchChange: vi.fn(),
}))
vi.mock("../native-workbench-config", async () => {
  const { z } = await import("zod")
  return {
    domains: z.enum([
      "collection",
      "request",
      "environment",
      "documentation",
      "mock",
      "automation",
      "load_test",
      "websocket",
    ]),
    nativeGuide: {},
    newConfigID: () => crypto.randomUUID(),
    readLocal: async (key: string) => structuredClone(fixture.storage.get(key)),
    writeLocal: async (key: string, value: unknown) => {
      fixture.storage.set(key, structuredClone(value))
    },
    configurations: async (entity: string) =>
      [...fixture.records.entries()]
        .filter(([key]) => key.startsWith(entity + ":"))
        .map(([, data]) => ({ id: data.id, data: structuredClone(data) })),
    prepareChange: async (change: any, before: unknown) =>
      change.operation === "delete"
        ? undefined
        : { ...Object(before), ...change.data, id: change.id },
    applyConfig: fixture.apply,
    redact: (value: unknown) => value,
    publishedDocumentation: vi.fn(),
  }
})
import { nativeMcpAPI, startNativeMcp } from "../native-workbench-mcp"

beforeAll(startNativeMcp)
beforeEach(() => {
  fixture.storage.clear()
  fixture.records.clear()
  fixture.replies.clear()
  fixture.apply.mockReset()
  fixture.records.set("documentation:existing", {
    id: "existing",
    title: "Document",
  })
  fixture.records.set("websocket:existing", { id: "existing", name: "Socket" })
  fixture.apply.mockImplementation(
    async (change: any, _before: unknown, after: unknown) => {
      const key = `${change.entity}:${change.id}`
      if (change.operation === "delete") fixture.records.delete(key)
      else
        fixture.records.set(
          key,
          structuredClone(after) as Record<string, unknown>
        )
      return { id: change.id }
    }
  )
})
function propose(change: Record<string, unknown>, key = crypto.randomUUID()) {
  const id = crypto.randomUUID()
  return new Promise<any>((resolve, reject) => {
    fixture.replies.set(id, (reply: any) => {
      fixture.replies.delete(id)
      reply.error ? reject(new Error(reply.error)) : resolve(reply.value)
    })
    fixture.listener!({
      payload: {
        id,
        name: "workbench_propose_change",
        args: { ...change, reason: "Approval regression", idempotencyKey: key },
      },
    })
  })
}
const cases = [
  {
    entity: "documentation",
    operation: "create",
    data: { title: "New document", collectionID: "collection" },
  },
  {
    entity: "documentation",
    operation: "update",
    id: "existing",
    data: { title: "Updated document" },
  },
  { entity: "documentation", operation: "delete", id: "existing" },
  { entity: "websocket", operation: "delete", id: "existing" },
  {
    entity: "collection",
    operation: "create",
    data: { name: "New collection" },
  },
]
describe("native approval policy", () => {
  it.each(cases)(
    "automatically applies $entity $operation when approval is off",
    async (change) => {
      await nativeMcpAPI("approval-policy", { required: false })
      const result = await propose(change)
      expect(result).toMatchObject({ automatic: true, status: "applied" })
      expect(fixture.apply).toHaveBeenCalledTimes(1)
      expect((await nativeMcpAPI<any>("state", undefined)).proposals).toEqual([
        expect.objectContaining({
          id: result.id,
          status: "applied",
          automatic: true,
        }),
      ])
    }
  )
  it.each(cases)(
    "queues $entity $operation when approval is on",
    async (change) => {
      await nativeMcpAPI("approval-policy", { required: true })
      expect(await propose(change)).toMatchObject({
        automatic: false,
        status: "pending",
      })
      expect(fixture.apply).not.toHaveBeenCalled()
    }
  )
  it("does not repeat an automatically executed deletion on retry", async () => {
    await nativeMcpAPI("approval-policy", { required: false })
    const key = crypto.randomUUID(),
      first = await propose(cases[2], key)
    expect(await propose(cases[2], key)).toMatchObject({
      id: first.id,
      status: "applied",
    })
    expect(fixture.apply).toHaveBeenCalledTimes(1)
  })
  it("requires approval by default and after restoring the switch", async () => {
    expect(await propose(cases[0])).toMatchObject({ status: "pending" })
    await nativeMcpAPI("approval-policy", { required: false })
    expect(await propose(cases[3])).toMatchObject({ status: "applied" })
    await nativeMcpAPI("approval-policy", { required: true })
    expect(await propose(cases[2])).toMatchObject({ status: "pending" })
    expect(fixture.apply).toHaveBeenCalledTimes(1)
  })
  it("records a failed automatic write", async () => {
    await nativeMcpAPI("approval-policy", { required: false })
    fixture.apply.mockRejectedValueOnce(new Error("Write failed"))
    expect(await propose(cases[2])).toMatchObject({
      automatic: true,
      status: "failed",
    })
  })
})
