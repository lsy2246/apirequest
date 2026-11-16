import { invoke } from "@tauri-apps/api/core";
import { notifyWorkbenchChange } from "~/services/workbench-realtime.service";
import { listen } from "@tauri-apps/api/event";
import { isEqual } from "lodash-es";
import { z } from "zod";
import { applyConfig, configurations, domains, nativeGuide, newConfigID, prepareChange, publishedDocumentation, readLocal, redact, writeLocal } from "./native-workbench-config";

const proposalKey = "workbench-native-proposals"
const approvalPolicyKey = "workbench-native-approval-required"
const approvalRequired = async () =>
  (await readLocal<boolean>(approvalPolicyKey)) !== false
const ttl = 24 * 60 * 60 * 1000
const maxProposals = 200
const changeSchema = z
  .object({
    entity: domains,
    operation: z.enum(["create", "update", "delete"]),
    id: z.string().min(1).max(256).optional(),
    data: z.record(z.unknown()).optional(),
    reason: z.string().trim().min(1).max(2000),
    idempotencyKey: z.string().regex(/^[\w.-]{8,128}$/),
  })
  .strict()

type Input = z.infer<typeof changeSchema>
type Config = { id: string } & Record<string, unknown>
type Proposal = {
  id: string
  status:
    | "pending"
    | "applying"
    | "applied"
    | "rejected"
    | "expired"
    | "conflict"
    | "failed"
  automatic?: boolean
  createdAt: number
  expiresAt: number
  change: Input & { id: string }
  before?: Config
  after?: Config
  result?: unknown
  error?: string
}

let operations = Promise.resolve()
function serialize<T>(operation: () => Promise<T>) {
  const current = operations.then(operation)
  operations = current.then(
    () => undefined,
    () => undefined
  )
  return current
}

async function proposals() {
  const entries = (await readLocal<Proposal[]>(proposalKey)) ?? []
  return entries.map((entry) =>
    entry.status === "pending" && entry.expiresAt <= Date.now()
      ? { ...entry, status: "expired" as const }
      : entry
  )
}

function proposalView(proposal: Proposal, external: boolean) {
  const { idempotencyKey: _key, data, ...change } = proposal.change
  const fields = data ? Object.keys(data) : []
  // 审批界面只展示本次提交的值。未改动的认证、正文等配置不进入预览。
  const select = (value?: Config) =>
    value &&
    (change.operation === "delete"
      ? { id: value.id, name: value.name, title: value.title }
      : Object.fromEntries(
          Object.entries(value).filter(([key]) => fields.includes(key))
        ))
  const view = {
    ...proposal,
    change,
    changedFields: fields,
    before: redact(select(proposal.before)),
    after: external ? redact(select(proposal.after)) : select(proposal.after),
    result: redact(proposal.result),
  }
  return view
}

async function propose(args: unknown) {
  const input = changeSchema.parse(args)
  if ((input.operation === "create") === Boolean(input.id))
    throw new Error("Supply id only for update or delete")
  if ((input.operation === "delete") === Boolean(input.data))
    throw new Error("Supply data only for create or update")
  const entries = await proposals()
  const existing = entries.find(
    (entry) => entry.change.idempotencyKey === input.idempotencyKey
  )
  if (existing) {
    const prior = {
      ...existing.change,
      id: input.operation === "create" ? undefined : existing.change.id,
    }
    if (
      !isEqual(
        JSON.parse(JSON.stringify(prior)),
        JSON.parse(JSON.stringify(input))
      )
    )
      throw new Error("Idempotency key already used for a different change")
    return proposalView(existing, true)
  }
  if (
    entries.filter((entry) => entry.status === "pending").length >= maxProposals
  ) {
    throw new Error("Review the pending proposals first")
  }
  const change = { ...input, id: input.id ?? newConfigID(input.entity) }
  const value = input.id
    ? (await configurations(input.entity)).find(({ id }) => id === input.id)
        ?.data
    : undefined
  const before = value
    ? (JSON.parse(JSON.stringify(value)) as Config)
    : undefined
  const after = await prepareChange(change, before)
  const automatic = !(await approvalRequired())
  const proposal: Proposal = {
    id: crypto.randomUUID(),
    status: "pending",
    automatic,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttl,
    change,
    before,
    after,
  }
  const pending = entries.filter((entry) => entry.status === "pending")
  const settled = entries.filter((entry) => entry.status !== "pending")
  await writeLocal(
    proposalKey,
    [proposal, ...pending, ...settled].slice(0, maxProposals)
  )
  if (automatic) return decide(proposal.id, true, true)
  return proposalView(proposal, true)
}

async function decide(id: string, approve: boolean, external = false) {
  const entries = await proposals()
  const proposal = entries.find((entry) => entry.id === id)
  if (!proposal) throw new Error("Proposal does not exist")
  if (proposal.status !== "pending") return proposalView(proposal, external)
  if (!approve) proposal.status = "rejected"
  else {
    const { change } = proposal
    const current = (await configurations(change.entity)).find(
      (item) => item.id === change.id
    )?.data
    if (
      !isEqual(
        current ? JSON.parse(JSON.stringify(current)) : undefined,
        proposal.before
      )
    ) {
      proposal.status = "conflict"
      proposal.error = "Configuration changed after preview"
    } else {
      // 先记录执行中的状态。进程中断后，同一个幂等键不会自动再次写入。
      proposal.status = "applying"
      await writeLocal(proposalKey, entries)
      try {
        const after = await prepareChange(change, current)
        const result = await applyConfig(change, current, after)
        proposal.status = "applied"
        proposal.result = {
          id: result && typeof result === "object" ? result.id : change.id,
        }
      } catch (error) {
        proposal.status = "failed"
        proposal.error = error instanceof Error ? error.message : String(error)
      }
    }
  }
  await writeLocal(proposalKey, entries)
  return proposalView(proposal, external)
}

async function tool(name: string, args: Record<string, unknown>) {
  if (name === "read_local_document")
    return publishedDocumentation(String(args.id))
  if (name === "workbench_help")
    return { ...nativeGuide, approvalRequired: await approvalRequired() }
  if (name === "workbench_propose_change") return propose(args)
  if (name === "workbench_change_status") {
    const proposal = (await proposals()).find(
      ({ id }) => id === args.proposalID
    )
    if (!proposal) throw new Error("Proposal does not exist")
    return proposalView(proposal, true)
  }
  const entity = domains.parse(args.entity)
  const entries = await configurations(entity)
  if (name === "workbench_get") {
    const item = entries.find(({ id }) => id === args.id)
    if (!item) throw new Error("Configuration does not exist")
    return { id: item.id, data: redact(item.data) }
  }
  const offset = z.number().int().nonnegative().default(0).parse(args.offset)
  const limit = z.number().int().min(1).max(100).default(50).parse(args.limit)
  return {
    items: entries
      .slice(offset, offset + limit)
      .map((item) => ({ id: item.id, data: redact(item.data) })),
    nextOffset: offset + limit < entries.length ? offset + limit : null,
  }
}

export async function startNativeMcp() {
  // HTTP 侧只能发起这五个工具，审批仅由下面的桌面页面调用。
  await listen<{ id: string; name: string; args: Record<string, unknown> }>(
    "workbench-mcp-call",
    ({ payload }) => {
      void serialize(async () => {
        try {
          const value = await tool(payload.name, payload.args)
          if (payload.name === "workbench_propose_change") {
            notifyWorkbenchChange("ai")
            notifyWorkbenchChange("plans")
          }
          await invoke("workbench_mcp_reply", { id: payload.id, value })
        } catch (error) {
          await invoke("workbench_mcp_reply", {
            id: payload.id,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }).catch(console.error)
    }
  )
}

async function nativeMcpOperation<T>(path: string, body: unknown): Promise<T> {
  return serialize(async () => {
    if (path === "state") {
      const access = await invoke<{ enabled: boolean }>("workbench_mcp_access")
      return {
        ...access,
        approvalRequired: await approvalRequired(),
        proposals: (await proposals()).map((entry) =>
          proposalView(entry, false)
        ),
        guide: nativeGuide,
      } as T
    }
    if (path === "access") {
      return invoke<T>("workbench_mcp_access", {
        enabled: z.object({ enabled: z.boolean() }).parse(body).enabled,
      })
    }
    if (path === "approval-policy") {
      const { required } = z.object({ required: z.boolean() }).parse(body)
      await writeLocal(approvalPolicyKey, required)
      return { approvalRequired: required } as T
    }
    const [section, id, action] = path.split("/")
    if (section === "proposals" && action === "decision") {
      return (await decide(
        decodeURIComponent(id),
        z.object({ approve: z.boolean() }).parse(body).approve
      )) as T
    }
    if (section === "documentation") {
      const collectionID = decodeURIComponent(id)
      const existing = (await configurations("documentation")).find(
        ({ data }) => data.collectionID === collectionID
      )
      if (action === "link") {
        if (!existing) return null as T
        return invoke<T>("workbench_documentation_url", { id: existing.id })
      }
      if (action === "unpublish" && existing) {
        await applyConfig(
          { entity: "documentation", operation: "delete", id: existing.id },
          existing.data,
          undefined
        )
        return null as T
      }
      if (action === "publish") {
        const data = z
          .object({ title: z.string().trim().min(1).max(300) })
          .parse(body)
        const change = {
          entity: "documentation" as const,
          operation: existing ? ("update" as const) : ("create" as const),
          id: existing?.id ?? newConfigID("documentation"),
          data: { ...data, collectionID },
        }
        const after = await prepareChange(change, existing?.data)
        await applyConfig(change, existing?.data, after)
        return invoke<T>("workbench_documentation_url", { id: change.id })
      }
    }
    if (section === "configs") {
      const entries = await configurations(domains.parse(id))
      if (!action) return { items: entries.map(({ data }) => data) } as T
      const item = entries.find(
        ({ id: itemId }) => itemId === decodeURIComponent(action)
      )
      if (!item) throw new Error("Configuration does not exist")
      if (body !== undefined) {
        if (id !== "automation") throw new Error("Unsupported local operation")
        const data = z
          .object({
            environmentID: z.string().min(1).optional(),
            config: z.record(z.unknown()),
          })
          .strict()
          .parse(body)
        const change = {
          entity: "automation" as const,
          operation: "update" as const,
          id: item.id,
          data,
        }
        const after = await prepareChange(change, item.data)
        await applyConfig(change, item.data, after)
        return after as T
      }
      if (id === "request")
        return { request: item.data, collectionID: item.data.collectionID } as T
      return item.data as T
    }
    throw new Error("Unsupported local operation")
  })
}

export async function nativeMcpAPI<T>(path: string, body: unknown): Promise<T> {
  const result = await nativeMcpOperation<T>(path, body)
  if (body !== undefined) {
    notifyWorkbenchChange("ai")
    notifyWorkbenchChange("plans")
  }
  return result
}
