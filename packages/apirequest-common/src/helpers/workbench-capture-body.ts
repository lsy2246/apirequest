import type {
  CaptureBody,
  CaptureEntry,
  CaptureHeaders,
} from "./workbench-capture"

type BodyPage = { base64: string; size: number; next: number | null }
type BodySide = "requestBody" | "responseBody"

export async function decodeCaptureBytes(
  data: Uint8Array,
  headers?: CaptureHeaders
) {
  const encoding = headers
    ?.find(([key]) => key.toLowerCase() === "content-encoding")?.[1]
    .trim()
    .toLowerCase()
  if (encoding !== "gzip" && encoding !== "deflate") return data
  const stream = new Blob([new Uint8Array(data).buffer])
    .stream()
    .pipeThrough(new DecompressionStream(encoding))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// 传输仍分块读取，显示、查找、复制和对比使用拼接后的完整正文。
export async function readCaptureBody(
  read: (offset: number) => Promise<BodyPage>,
  headers?: CaptureHeaders,
  isCurrent: () => boolean = () => true
): Promise<CaptureBody> {
  const chunks: string[] = []
  let offset = 0,
    length = 0,
    size = 0
  do {
    if (!isCurrent()) throw new DOMException("Aborted", "AbortError")
    const page = await read(offset)
    if (!isCurrent()) throw new DOMException("Aborted", "AbortError")
    const chunk = atob(page.base64)
    chunks.push(chunk)
    length += chunk.length
    size = page.size
    if (page.next === null) break
    if (page.next !== offset + chunk.length || page.next <= offset)
      throw new Error("Invalid capture body offset")
    offset = page.next
  } while (true)
  const binary = chunks.join("")
  const data = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  let text: string | null = null
  try {
    const decoded = await decodeCaptureBytes(data, headers)
    const value = new TextDecoder("utf-8", { fatal: true }).decode(decoded)
    if (!value.includes("\0")) text = value
  } catch {
    // 二进制和未完成的压缩流保留完整原始字节。
  }
  if (!isCurrent()) throw new DOMException("Aborted", "AbortError")
  return {
    text,
    base64: btoa(binary),
    size,
    truncated: length < size,
  }
}

export async function loadCaptureEntryBodies(
  entry: CaptureEntry,
  read: (side: BodySide, offset: number) => Promise<BodyPage>,
  previous?: CaptureEntry,
  isCurrent: () => boolean = () => true
): Promise<CaptureEntry> {
  const result = { ...entry }
  await Promise.all(
    (["requestBody", "responseBody"] as const).map(async (side) => {
      if (!entry[side]?.size) return
      const headersKey =
        side === "requestBody" ? "requestHeaders" : "responseHeaders"
      const completeKey =
        side === "requestBody" ? "requestComplete" : "responseComplete"
      const cached = previous?.[side]
      if (
        previous?.id === entry.id &&
        previous.sessionId === entry.sessionId &&
        cached &&
        !cached.truncated &&
        cached.size === entry[side]?.size &&
        previous[completeKey] === entry[completeKey] &&
        JSON.stringify(previous[headersKey]) ===
          JSON.stringify(entry[headersKey])
      ) {
        result[side] = cached
        return
      }
      result[side] = await readCaptureBody(
        (offset) => read(side, offset),
        entry[headersKey],
        isCurrent
      )
    })
  )
  return result
}

const extensions: Record<string, string> = {
  "application/json": "json",
  "application/xml": "xml",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/gzip": "gz",
  "application/javascript": "js",
  "application/x-www-form-urlencoded": "txt",
  "text/plain": "txt",
  "text/html": "html",
  "text/css": "css",
  "text/csv": "csv",
  "text/xml": "xml",
  "text/event-stream": "txt",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "video/webm": "webm",
}

export function captureBodyDownload(
  entry: CaptureEntry,
  side: "requestBody" | "responseBody"
) {
  const headers =
    side === "requestBody" ? entry.requestHeaders : entry.responseHeaders
  const header = (name: string) =>
    headers?.find(([key]) => key.toLowerCase() === name)?.[1] ?? ""
  let type = (
    header("content-type") ||
    (side === "responseBody" ? entry.contentType : "") ||
    ""
  )
    .split(";")[0]
    .trim()
    .toLowerCase()
  if (!type && entry[side]?.text != null) {
    try {
      JSON.parse(entry[side]!.text!)
      type = "application/json"
    } catch {
      type = "text/plain"
    }
  }
  const extension =
    extensions[type] ||
    (type.endsWith("+json") ? "json" : type.endsWith("+xml") ? "xml" : "bin")
  const disposition = header("content-disposition")
  const encoded = disposition.match(
    /(?:^|;)\s*filename\*\s*=\s*UTF-8'[^']*'([^;]+)/i
  )
  const plain = disposition.match(
    /(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]*))/i
  )
  let filename = plain?.[1] ?? plain?.[2] ?? ""
  if (encoded) {
    try {
      filename = decodeURIComponent(encoded[1].trim())
    } catch {}
  }
  // 不使用服务端路径或控制字符作为下载名；未声明文件名时按正文类型命名。
  filename =
    filename
      .split(/[\\/]/)
      .pop()
      ?.replace(/[\x00-\x1f\x7f<>:"|?*]/g, "_")
      .replace(/^\.+|[. ]+$/g, "")
      .trim()
      .slice(0, 180) || ""
  if (!filename && side === "responseBody") {
    try {
      const segment = decodeURIComponent(
        new URL(entry.url).pathname.split("/").pop() || ""
      )
      if (
        segment.toLowerCase().endsWith("." + extension) &&
        /^[\p{L}\p{N}_. -]+$/u.test(segment)
      )
        filename = segment.slice(0, 180)
    } catch {}
  }
  filename ||= `${side === "requestBody" ? "request" : "response"}.${extension}`
  // 下载保留磁盘原始字节，压缩正文追加压缩后缀，避免把 gzip 数据误标为可直接打开的 JSON。
  const encoding = header("content-encoding").trim().toLowerCase()
  const compression = (
    { gzip: "gz", deflate: "deflate", br: "br", zstd: "zst" } as Record<
      string,
      string
    >
  )[encoding]
  if (compression && !filename.toLowerCase().endsWith("." + compression))
    filename += "." + compression
  return {
    filename,
    type: compression
      ? encoding === "gzip"
        ? "application/gzip"
        : "application/octet-stream"
      : type || "application/octet-stream",
  }
}
