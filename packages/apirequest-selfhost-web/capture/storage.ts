import { createReadStream } from "node:fs"
import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  open,
  appendFile,
  stat,
} from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { createInterface } from "node:readline"

// 与引擎、桌面宿主共用磁盘格式；历史查询只扫描紧凑索引，正文按需分块读取。
const validID = (id: unknown) =>
  typeof id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(id)
export function archivePath(
  root: string,
  session: unknown,
  id?: unknown,
  side?: unknown
) {
  if (
    !validID(session) ||
    (id !== undefined && !validID(id)) ||
    (side !== undefined &&
      !["requestBody", "responseBody"].includes(String(side)))
  )
    throw Error("entry_unavailable")
  return join(
    root,
    "sessions",
    String(session),
    ...(id === undefined ? [] : [String(id)]),
    ...(side === undefined ? [] : [String(side) + ".bin"])
  )
}
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"))
const save = (path: string, value: unknown) =>
  writeFile(path, JSON.stringify(value), { mode: 0o600 })
async function* summaries(folder: string) {
  const stream = createReadStream(join(folder, "index.jsonl"), {
    encoding: "utf8",
  })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      try {
        yield JSON.parse(line)
      } catch {
        /* 活跃会话可能正在追加末行，下一次刷新再读取。 */
      }
    }
  } finally {
    lines.close()
    stream.destroy()
  }
}
async function latestSummary(folder: string, summary: any) {
  // 摘要独立于正文预览；列表刷新只读取当前页的小文件。
  try {
    return await json(join(folder, String(summary.id), "summary.json"))
  } catch {
    return summary
  }
}
function matches(entry: any, input: any) {
  const url = new URL(entry.url)
  const type = String(entry.contentType ?? "").toLowerCase()
  return (
    (!input.hosts?.length || input.hosts.includes(url.host)) &&
    (!input.clients?.length || input.clients.includes(entry.client)) &&
    (!input.search ||
      `${entry.method} ${entry.url} ${entry.status ?? ""}`
        .toLowerCase()
        .includes(String(input.search).toLowerCase())) &&
    (!input.status ||
      Math.floor((entry.status ?? 0) / 100) === Number(input.status)) &&
    (!input.kind ||
      (input.kind === "SSE"
        ? type.includes("event-stream")
        : input.kind === "WebSocket"
          ? entry.status === 101
          : input.kind === "JSON"
            ? type.includes("json")
            : input.kind === "image"
              ? type.startsWith("image/")
              : input.kind === "HTTP2"
                ? String(entry.protocol).includes("2")
                : url.protocol === input.kind + ":"))
  )
}
export async function archiveCommand(
  root: string,
  action: string,
  input: any,
  activeID = ""
): Promise<any> {
  const sessions = join(root, "sessions")
  await mkdir(sessions, { recursive: true, mode: 0o700 })
  if (action === "archive_list") {
    const items = []
    for (const id of await readdir(sessions)) {
      try {
        if (validID(id))
          if (!(await json(join(sessions, id, "session.json"))).importing)
            items.push({
              ...(await json(join(sessions, id, "session.json"))),
              active: id === activeID,
            })
      } catch {
        /* 忽略不完整的初始化目录。 */
      }
    }
    return items.sort((a, b) => b.date - a.date)
  }
  if (action === "archive_create") {
    const id = randomUUID(),
      folder = archivePath(root, id)
    await mkdir(folder, { mode: 0o700 })
    const session = {
      id,
      name: String(input.name ?? "HAR").slice(0, 120),
      date: Date.now(),
      count: 0,
      dropped: 0,
      bytes: 0,
      active: false,
    }
    await save(join(folder, "session.json"), session)
    await writeFile(join(folder, "index.jsonl"), "", { mode: 0o600 })
    return session
  }
  const folder = archivePath(root, input.session)
  if (action === "archive_delete") {
    if (input.session === activeID) throw Error("busy")
    await rm(folder, { recursive: true, force: true })
    return {}
  }
  const manifest = await json(join(folder, "session.json"))
  if (action === "archive_rename") {
    if (input.session === activeID) throw Error("busy")
    manifest.name = String(input.name ?? "")
      .trim()
      .slice(0, 120)
    if (!manifest.name) throw Error("invalid_rules")
    await save(join(folder, "session.json"), manifest)
    return {}
  }
  if (action === "archive_page") {
    let total = 0,
      boundary = 0
    const before =
      typeof input.before === "number" ? Math.max(0, input.before) : Infinity
    const filtered = !!(
      input.hosts?.length ||
      input.clients?.length ||
      input.search ||
      input.kind ||
      input.status
    )
    const hosts = new Set<string>(),
      clients = new Set<string>()
    if (!manifest.count)
      return { entries: [], total: 0, hosts: [], clients: [] }
    for await (const source of summaries(folder)) {
      if (boundary >= before) break
      boundary++
      const entry = filtered ? await latestSummary(folder, source) : source
      if (hosts.size < 1000) hosts.add(new URL(entry.url).host)
      if (entry.client && clients.size < 1000) clients.add(entry.client)
      if (matches(entry, input)) total++
    }
    const offset = Math.max(0, Number(input.offset) || 0),
      limit = Math.min(500, Math.max(1, Number(input.limit) || 200))
    let index = 0,
      scanned = 0
    const entries = []
    for await (const source of summaries(folder)) {
      if (scanned++ >= boundary) break
      const entry = filtered ? await latestSummary(folder, source) : source
      if (!matches(entry, input)) continue
      if (
        index >= Math.max(0, total - offset - limit) &&
        index < total - offset
      )
        entries.push(filtered ? entry : await latestSummary(folder, entry))
      index++
    }
    return {
      entries: entries.reverse(),
      total,
      boundary,
      hosts: [...hosts],
      clients: [...clients],
    }
  }
  if (action === "archive_import") {
    if (input.session === activeID || !validID(input.entry?.id))
      throw Error("invalid_har")
    const entry = { ...input.entry, replayable: false, paused: null }
    const directory = archivePath(root, input.session, entry.id)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    for (const side of ["requestBody", "responseBody"]) {
      const body = entry[side]
      if (body && !body.truncated && (body.base64 || body.text != null)) {
        const data = body.base64
          ? Buffer.from(body.base64, "base64")
          : Buffer.from(body.text)
        await writeFile(
          archivePath(root, input.session, entry.id, side),
          data,
          { mode: 0o600 }
        )
        manifest.bytes += data.length
      }
    }
    await save(join(directory, "entry.json"), entry)
    const {
      requestBody,
      responseBody,
      requestHeaders,
      responseHeaders,
      frames,
      ...summary
    } = entry
    await save(join(directory, "summary.json"), summary)
    await appendFile(
      join(folder, "index.jsonl"),
      JSON.stringify(summary) + "\n",
      { mode: 0o600 }
    )
    manifest.count++
    await save(join(folder, "session.json"), manifest)
    return {}
  }
  const directory = archivePath(root, input.session, input.id)
  if (action === "archive_entry") {
    const entry = await json(join(directory, "entry.json"))
    return {
      ...entry,
      ...(input.live === true && input.session === activeID
        ? {}
        : { paused: null }),
      replayable: entry.originalRequest === true && entry.replayable === true,
    }
  }
  if (action === "archive_frames") {
    const entries = []
    let index = 0
    try {
      const stream = createReadStream(join(directory, "frames.jsonl"))
      const lines = createInterface({ input: stream, crlfDelay: Infinity })
      try {
        for await (const line of lines) {
          if (index++ >= (Number(input.offset) || 0)) {
            entries.push(JSON.parse(line))
            if (entries.length >= 200) break
          }
        }
      } finally {
        lines.close()
        stream.destroy()
      }
    } catch {
      return { entries: [], next: null }
    }
    return { entries, next: entries.length === 200 ? index : null }
  }
  if (action === "archive_body") {
    const path = archivePath(root, input.session, input.id, input.side)
    const file = await open(path, "r")
    try {
      const recorded = (await file.stat()).size,
        expected =
          Number(
            (await json(join(directory, "entry.json")))[input.side]?.size
          ) || 0,
        size = Math.max(recorded, expected),
        offset = Math.max(0, Number(input.offset) || 0),
        buffer = Buffer.alloc(65536)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset)
      return {
        base64: buffer.subarray(0, bytesRead).toString("base64"),
        size,
        next: offset + bytesRead < recorded ? offset + bytesRead : null,
      }
    } finally {
      await file.close()
    }
  }
  throw Error("forbidden")
}

// HAR 导出直接串流到下载响应，完整正文不先拼接成巨大的 JSON 字符串。
export async function* archiveHarChunks(
  root: string,
  input: any
): AsyncGenerator<string> {
  const folder = archivePath(root, input.session)
  yield '{"log":{"version":"1.2","creator":{"name":"ApiRequest","version":"2"},"entries":['
  let first = true
  for await (const summary of summaries(folder)) {
    if (!matches(await latestSummary(folder, summary), input)) continue
    const entry = await json(
      join(archivePath(root, input.session, summary.id), "entry.json")
    )
    if (!entry.responseComplete && !entry.failed) continue
    if (!first) yield ","
    first = false
    const header = (values: any[] = []) =>
      values.map(([name, value]) => ({ name, value }))
    const request = {
      method: entry.method,
      url: entry.url,
      httpVersion: entry.protocol,
      headers: header(entry.requestHeaders),
      cookies: [],
      queryString: [...new URL(entry.url).searchParams].map(
        ([name, value]) => ({ name, value })
      ),
      headersSize: -1,
      bodySize: entry.requestSize ?? entry.requestBody?.size ?? 0,
    }
    const response = {
      status: entry.status ?? 0,
      statusText: "",
      httpVersion: entry.responseProtocol ?? entry.protocol,
      headers: header(entry.responseHeaders),
      cookies: [],
      headersSize: -1,
      bodySize: entry.responseSize ?? entry.responseBody?.size ?? 0,
      redirectURL: "",
    }
    yield JSON.stringify({
      startedDateTime: new Date(entry.startedAt).toISOString(),
      time: entry.elapsedMs ?? 0,
      cache: {},
      timings: {
        send: 0,
        wait: entry.firstByteMs ?? 0,
        receive: Math.max(0, (entry.elapsedMs ?? 0) - (entry.firstByteMs ?? 0)),
        ...entry.timings,
      },
    }).slice(0, -1) +
      ',"request":' +
      JSON.stringify(request).slice(0, -1)
    if (input.includeBodies) {
      const path = archivePath(root, input.session, entry.id, "requestBody")
      const size = await stat(path)
        .then((s) => s.size)
        .catch(() => -1)
      if (size >= 0) {
        yield ',"postData":{"mimeType":' +
          JSON.stringify(
            entry.requestHeaders?.find(
              ([key]: string[]) => key.toLowerCase() === "content-type"
            )?.[1] ?? ""
          ) +
          ',"_encoding":"base64","text":"'
        yield* base64Chunks(path)
        yield '"}'
      }
    }
    yield '},"response":' +
      JSON.stringify(response).slice(0, -1) +
      ',"content":{"size":' +
      response.bodySize +
      ',"mimeType":' +
      JSON.stringify(entry.contentType ?? "")
    if (input.includeBodies) {
      const path = archivePath(root, input.session, entry.id, "responseBody")
      if (
        await stat(path)
          .then(() => true)
          .catch(() => false)
      ) {
        yield ',"encoding":"base64","text":"'
        yield* base64Chunks(path)
        yield '"'
      }
    }
    yield "}}"
    if (input.includeBodies) {
      const file = join(
        archivePath(root, input.session, entry.id),
        "frames.jsonl"
      )
      if (
        await stat(file)
          .then(() => true)
          .catch(() => false)
      ) {
        yield ',"_webSocketMessages":['
        let firstFrame = true
        const lines = createInterface({
          input: createReadStream(file),
          crlfDelay: Infinity,
        })
        try {
          for await (const line of lines) {
            if (!firstFrame) yield ","
            firstFrame = false
            yield line
          }
        } finally {
          lines.close()
        }
        yield "]"
      }
    }
    yield "}"
  }
  yield "]}}"
}
async function* base64Chunks(path: string) {
  let remainder = Buffer.alloc(0)
  for await (const chunk of createReadStream(path, { highWaterMark: 65535 })) {
    const data = Buffer.concat([remainder, chunk as Buffer])
    const end = data.length - (data.length % 3)
    yield data.subarray(0, end).toString("base64")
    remainder = data.subarray(end)
  }
  if (remainder.length) yield remainder.toString("base64")
}
