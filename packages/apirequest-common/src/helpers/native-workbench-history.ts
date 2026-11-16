import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { reactive } from "vue";
import type { HistoryResultKind, HistoryResultPolicy, HistoryResultSnapshot } from "./workbench-history-results";

const archivePaths = reactive(new Map<string, string>())
const day = 86_400_000

export function nativeHistory<T>(action: Record<string, unknown>) {
  return invoke<T>("workbench_history", { action })
}

export function nativeHistoryURL(path: string) {
  const file = archivePaths.get(path)
  return file ? convertFileSrc(file) : "about:blank"
}

export function downloadNativeHistory(id: string, attachment?: string) {
  return nativeHistory({ type: "download", id, attachment })
}

export async function nativeHistoryAPI<T>(path: string, options?: RequestInit) {
  const input =
    typeof options?.body === "string" ? JSON.parse(options.body) : {}
  if (path === "policy") {
    const policy = await nativeHistory<
      Omit<HistoryResultPolicy, "lastCleanupAt" | "lastCleanup"> & {
        lastCleanupAt: number | null
        lastCleanup: { count: number; bytes: number } | null
      }
    >(
      options?.method === "PUT"
        ? { type: "set_policy", policy: input }
        : { type: "policy" }
    )
    return {
      ...policy,
      lastCleanupAt:
        policy.lastCleanupAt === null
          ? null
          : new Date(policy.lastCleanupAt).toISOString(),
      lastCleanup: policy.lastCleanup && {
        count: policy.lastCleanup.count,
        bytes: String(policy.lastCleanup.bytes),
      },
    } as T
  }
  if (path === "cleanup" || path === "cleanup/preview") {
    const report = await nativeHistory<{
      count: number
      bytes: number
      revision: string
    }>({
      type: path === "cleanup" ? "cleanup" : "preview",
      criteria: { before: Date.now() - input.days * day, kind: input.kind },
      revision: input.expected?.revision,
    })
    return { ...report, bytes: String(report.bytes) } as T
  }
  if (path.includes("/"))
    throw new Error("Unsupported desktop history operation")
  const item = await nativeHistory<{
    result: {
      kind: HistoryResultKind
      metadata: unknown
      cleanedAt: number | null
      files: {
        id: string
        name: string
        contentType: string
        bytes: number
        isBody: boolean
      }[]
    }
    paths: Record<string, string>
  } | null>({ type: "detail", id: decodeURIComponent(path) })
  if (!item) return { state: "missing" } as T
  if (item.result.cleanedAt !== null) return { state: "cleaned" } as T
  const attachments = []
  let size = 0
  for (const file of item.result.files) {
    if (file.isBody) {
      archivePaths.set(`${path}/body`, item.paths[file.id])
      size = file.bytes
    } else {
      archivePaths.set(
        `${path}/attachments/${encodeURIComponent(file.id)}`,
        item.paths[file.id]
      )
      attachments.push({ ...file, size: String(file.bytes) })
    }
  }
  return {
    state: "saved",
    kind: item.result.kind,
    size: String(size),
    metadata: item.result.metadata,
    attachments,
    canAttach: false,
  } as T
}

export async function archiveNativeHistory(
  id: string,
  snapshot: HistoryResultSnapshot
) {
  const policy = await nativeHistory<HistoryResultPolicy>({ type: "policy" })
  if (!policy.enabled) return
  const { body, ...metadata } = snapshot
  const contentType =
    metadata.headers.find(({ key }) => key.toLowerCase() === "content-type")
      ?.value ?? "application/octet-stream"
  const mime = contentType.split(";", 1)[0].trim().toLowerCase()
  let kind: HistoryResultKind = "file"
  if (mime.endsWith("/json") || mime.endsWith("+json")) kind = "json"
  else if (
    mime.startsWith("text/") ||
    mime.endsWith("/xml") ||
    mime.endsWith("+xml")
  )
    kind = "text"
  else if (mime.startsWith("image/")) kind = "image"
  else if (mime.startsWith("video/")) kind = "video"
  const extension = mime.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "bin"
  const envelope = JSON.stringify({
    kind,
    metadata: { ...metadata, contentType },
    contentType,
    name: `response.${extension}`,
    savedAt: Date.now(),
  })
  // Rust 收到二进制帧后分块写盘，避免将大响应序列化成 JSON 字节数组。
  const bytes = await new Blob([
    envelope,
    "\n",
    new Uint8Array(body),
  ]).arrayBuffer()
  await invoke("workbench_archive_body", bytes, {
    headers: { "x-workbench-history-id": id },
  })
}
