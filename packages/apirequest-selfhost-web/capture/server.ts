import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createCaptureService } from "./service"

const prefix = "/__workbench_capture"
const hash = (value: string) => createHash("sha256").update(value).digest("hex")

// 管理口只接受配置的同源请求；不依赖客户端可伪造的 forwarded 标头判断 HTTPS。
export function createOwnerAccess(origin: string, secret: string) {
  const expected = new URL(origin)
  if (
    expected.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(expected.hostname)
  )
    throw Error("Public capture management requires HTTPS")
  if (secret.length < 24)
    throw Error("Capture owner secret must contain at least 24 characters")
  const salt = randomBytes(32),
    digest = scryptSync(secret, salt, 32)
  const sessions = new Map<string, { expires: number; seen: number }>()
  let attempts = 0,
    window = 0
  const cookieName =
    expected.protocol === "https:"
      ? "__Host-apirequest-capture"
      : "apirequest-capture"
  const cookie = (value: string, age: number) =>
    `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${expected.protocol === "https:" ? "; Secure" : ""}`
  const send = (res: ServerResponse, status: number, body: object) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    })
    res.end(JSON.stringify(body))
  }
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (
      req.headers.host !== expected.host ||
      req.headers["x-workbench-capture"] !== "1" ||
      (req.headers.origin !== undefined &&
        req.headers.origin !== expected.origin) ||
      (req.method !== "GET" && req.headers.origin !== expected.origin)
    ) {
      send(res, 403, { error: "forbidden" })
      return false
    }
    const now = Date.now()
    for (const [key, item] of sessions)
      if (item.expires < now || item.seen + 86400000 < now) sessions.delete(key)
    const token =
      req.headers.cookie
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(cookieName + "="))
        ?.slice(cookieName.length + 1) ?? ""
    const current = sessions.get(hash(token))
    const path = req.url?.split("?", 1)[0]
    if (path === `${prefix}/auth`) {
      if (req.method === "GET") {
        send(res, 200, { authenticated: !!current, local: false })
        return false
      }
      if (req.method === "DELETE") {
        sessions.delete(hash(token))
        res.setHeader("Set-Cookie", cookie("", 0))
        send(res, 200, { authenticated: false })
        return false
      }
      if (req.method !== "POST") {
        send(res, 405, { error: "forbidden" })
        return false
      }
      if (now - window >= 60000) {
        window = now
        attempts = 0
      }
      // 全局限速不保留无限来源 IP，代理转发场景也无法通过伪造 IP 绕过。
      if (++attempts > 5) {
        res.setHeader("Retry-After", "60")
        send(res, 429, { error: "login_throttled" })
        return false
      }
      let body = ""
      for await (const chunk of req) {
        body += chunk.toString()
        if (body.length > 4096) {
          send(res, 413, { error: "forbidden" })
          return false
        }
      }
      let password = ""
      try {
        password = JSON.parse(body).password
      } catch {
        /* 无效输入与错误凭证统一拒绝。 */
      }
      if (
        typeof password !== "string" ||
        !timingSafeEqual(scryptSync(password, salt, 32), digest)
      ) {
        send(res, 401, { error: "authentication_required" })
        return false
      }
      // 每次认证轮换随机会话；浏览器只保存 HttpOnly Cookie，服务端只存令牌摘要。
      sessions.delete(hash(token))
      if (sessions.size >= 100) sessions.delete(sessions.keys().next().value!)
      const next = randomBytes(32).toString("base64url")
      sessions.set(hash(next), { expires: now + 7 * 86400000, seen: now })
      res.setHeader("Set-Cookie", cookie(next, 7 * 86400))
      send(res, 200, { authenticated: true })
      return false
    }
    if (!current) {
      send(res, 401, { error: "authentication_required" })
      return false
    }
    current.seen = now
    return true
  }
}

export function runCaptureServer() {
  const origin =
    process.env.APIREQUEST_CAPTURE_ORIGIN ?? "http://localhost:3190"
  const secretFile = process.env.APIREQUEST_CAPTURE_OWNER_SECRET_FILE
  const secret = secretFile
    ? readFileSync(secretFile, "utf8").trim()
    : (process.env.APIREQUEST_CAPTURE_OWNER_SECRET ?? "")
  const authorize = createOwnerAccess(origin, secret)
  process.env.APIREQUEST_CAPTURE_SERVER = "true"
  const root = process.env.APIREQUEST_CAPTURE_CA_DIR
  if (!root) throw Error("APIREQUEST_CAPTURE_CA_DIR is required")
  const service = createCaptureService(
    origin,
    process.env.APIREQUEST_CAPTURE_BACKEND_ORIGIN ?? origin,
    process.env.APIREQUEST_CAPTURE_EXECUTABLE ?? "mitmdump",
    root,
    {
      server: true,
      recorder: fileURLToPath(new URL("./engine/recorder.py", import.meta.url)),
    }
  )
  const server = createServer(async (req, res) => {
    try {
      const path = req.url?.split("?", 1)[0]
      if (path !== prefix && !path?.startsWith(prefix + "/")) {
        res.writeHead(404)
        res.end()
        return
      }
      if (await authorize(req, res)) await service.handle(req, res)
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end('{"error":"engine_unavailable"}')
      } else res.destroy()
    }
  })
  server.requestTimeout = 60000
  server.headersTimeout = 15000
  server.listen(
    Number(process.env.APIREQUEST_CAPTURE_CONTROL_PORT ?? 3190),
    process.env.APIREQUEST_CAPTURE_CONTROL_BIND ?? "127.0.0.1"
  )
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    server.close()
    await service.close()
    server.closeAllConnections()
  }
  process.once("SIGTERM", () => void close())
  process.once("SIGINT", () => void close())
  return { server, close }
}

if (process.env.APIREQUEST_CAPTURE_SERVER_ENTRY === "true") runCaptureServer()
