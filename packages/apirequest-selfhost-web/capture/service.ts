import { Readable } from "node:stream"
import { archiveCommand, archivePath, archiveHarChunks } from "./storage"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import type { IncomingMessage, ServerResponse } from "node:http"
import { createCaptureEvents } from "./events"

export const prefix = "/__workbench_capture"
const marker = "APIREQUEST_CAPTURE "
const proxyPort = 18888
const script = fileURLToPath(new URL("./recorder.py", import.meta.url))

export function reply(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  })
  res.end(JSON.stringify(value))
}

async function readBody(req: IncomingMessage, limit = 1024 * 1024) {
  let input = ""
  for await (const chunk of req) {
    input += chunk.toString()
    if (input.length > limit) throw new Error("invalid_rules")
  }
  return input ? JSON.parse(input) : {}
}

export function createCaptureService(
  editorOrigin: string,
  backendOrigin: string,
  executable: string,
  certificateDir: string,
  serviceOptions: { server?: boolean; recorder?: string } = {}
) {
  const events = createCaptureEvents()
  const editor = new URL(editorOrigin)
  const backend = new URL(backendOrigin)
  const internalPorts = new Set([
    3000,
    3001,
    3170,
    3171,
    Number(editor.port),
    Number(backend.port),
  ])
  const internalHosts = new Set([
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    editor.hostname.replace(/^\[|\]$/g, ""),
    backend.hostname.replace(/^\[|\]$/g, ""),
  ])
  let management: ChildProcess | undefined
  let child: ChildProcess | undefined
  let state: "stopped" | "starting" | "running" | "stopping" = "stopped"
  let archiveID = ""
  let archiveStatus: unknown
  let proxy = `http://127.0.0.1:${proxyPort}`
  let captureMode = "system"
  let endpoint = ""
  const pending = new Map<
    string,
    (reply: { error?: string; result?: unknown }) => void
  >()
  let error = ""
  let startupTimer: ReturnType<typeof setTimeout> | undefined
  let stopTimer: ReturnType<typeof setTimeout> | undefined

  const stop = () => {
    if (!child || state === "stopping") return
    const process = child
    state = "stopping"
    events.publish()
    clearTimeout(startupTimer)
    process.stdin?.end()
    stopTimer = setTimeout(() => process.kill("SIGKILL"), 45000)
    stopTimer.unref()
  }

  const start = (input: Record<string, never> = {}) => {
    if (Object.keys(input).length) throw Error("invalid_target")
    if (child || management) return false
    // 独立配置目录保存 CA 和磁盘归档；同一监听端口自动识别 HTTP 与 SOCKS5。
    mkdirSync(certificateDir, { recursive: true, mode: 0o700 })
    error = ""
    proxy = `http://127.0.0.1:${proxyPort}`
    captureMode = "control"
    endpoint = ""
    state = "starting"
    events.publish()
    archiveID = ""
    archiveStatus = undefined
    const process = spawn(
      executable,
      [
        "--quiet",
        "--set",
        "server=false",
        "--set",
        `confdir=${certificateDir}`,
        "--set",
        "connection_strategy=lazy",
        "--set",
        "ssl_insecure=false",
        "--set",
        "termlog_verbosity=error",
        "-s",
        serviceOptions.recorder ?? script,
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...globalThis.process.env,
          APIREQUEST_CAPTURE_INTERNAL_HOSTS: JSON.stringify([...internalHosts]),
          APIREQUEST_CAPTURE_INTERNAL_PORTS: JSON.stringify([...internalPorts]),
          APIREQUEST_CAPTURE_EXCLUDED_PIDS: JSON.stringify([
            globalThis.process.pid,
          ]),
          APIREQUEST_CAPTURE_SERVER: String(serviceOptions.server ?? false),
          APIREQUEST_CAPTURE_MANAGE: "",
          APIREQUEST_CAPTURE_PORT: String(proxyPort),
          APIREQUEST_CAPTURE_CONFIG: certificateDir,
        },
      }
    )
    child = process
    // 引擎日志可能含目标地址。界面使用固定错误码，正文与错误详情均不写盘。
    process.stderr.resume()
    process.stdin.on("error", () => {})
    const lines = createInterface({
      input: process.stdout,
      crlfDelay: Infinity,
    })
    lines.on("line", (line) => {
      if (child !== process || !line.startsWith(marker)) return
      try {
        const {
          callID,
          result,
          error: commandError,
          ready,
          archiveID: readyArchiveID,
          ...event
        } = JSON.parse(line.slice(marker.length))
        if (typeof callID === "string") {
          pending.get(callID)?.({ result, error: commandError })
        } else if (event.archiveStatus) {
          archiveStatus = event.archiveStatus
        } else if (event.fatalError) {
          error = [
            "archive_failed",
            "engine_unavailable",
            "system_unavailable",
            "existing_pac",
            "network_service_required",
            "invalid_capture_mode",
            "invalid_processes",
            "local_unavailable",
            "local_start_failed",
            "capture_cleanup_failed",
          ].includes(event.fatalError)
            ? event.fatalError
            : "engine_unavailable"
          stop()
        } else if (ready && state === "starting") {
          state = "running"
          archiveID = readyArchiveID ?? ""
          endpoint = event.endpoint ?? ""
          clearTimeout(startupTimer)
        }
        if (typeof callID !== "string") events.publish()
      } catch {
        // 引擎的诊断输出不会影响会话。
      }
    })
    process.once("error", () => {
      error = "engine_unavailable"
      events.publish()
    })
    process.once("close", () => {
      if (state !== "stopping" && !error) error = "engine_exited"
      for (const done of pending.values()) done({ error: "engine_exited" })
      child = undefined
      state = "stopped"
      clearTimeout(startupTimer)
      clearTimeout(stopTimer)
      lines.close()
      events.publish()
    })
    startupTimer = setTimeout(() => {
      error = "engine_exited"
      stop()
    }, 20000)
    startupTimer.unref()
    return true
  }

  const command = (action: string, body: unknown) => {
    const input = child?.stdin
    if (state !== "running" || !input?.writable)
      return Promise.reject(new Error("engine_unavailable"))
    if (pending.size >= 16) return Promise.reject(new Error("busy"))
    const callID = randomUUID()
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => done({ error: "engine_exited" }), 45000)
      const done = ({
        result,
        error,
      }: {
        result?: unknown
        error?: string
      }) => {
        clearTimeout(timer)
        pending.delete(callID)
        if (error) reject(new Error(error))
        else resolve(result)
      }
      pending.set(callID, done)
      input.write(JSON.stringify({ callID, action, body }) + "\n", (error) => {
        if (error) done({ error: "engine_exited" })
      })
    })
  }

  const manage = async (action: string, body: object) => {
    if (state === "running") return command(action, body)
    if (child || management) throw Error("busy")
    mkdirSync(certificateDir, { recursive: true, mode: 0o700 })
    return new Promise<unknown>((resolve, reject) => {
      const process = spawn(
        executable,
        [
          "--quiet",
          "--set",
          "server=false",
          "--set",
          `confdir=${certificateDir}`,
          "-s",
          serviceOptions.recorder ?? script,
        ],
        {
          stdio: ["ignore", "pipe", "ignore"],
          env: {
            ...globalThis.process.env,
            APIREQUEST_CAPTURE_CONFIG: certificateDir,
            APIREQUEST_CAPTURE_MANAGE: JSON.stringify(action),
          },
        }
      )
      management = process
      let result: { result?: unknown; error?: string } | undefined
      const lines = createInterface({
        input: process.stdout!,
        crlfDelay: Infinity,
      })
      lines.on("line", (line) => {
        if (line.startsWith(marker)) {
          try {
            result = JSON.parse(line.slice(marker.length))
          } catch {}
        }
      })
      const timer = setTimeout(() => process.kill("SIGKILL"), 45000)
      process.once("error", () => {
        result = { error: "engine_unavailable" }
      })
      process.once("close", () => {
        clearTimeout(timer)
        management = undefined
        lines.close()
        if (!result || result.error)
          reject(Error(result?.error || "system_unavailable"))
        else resolve(result.result)
      })
    })
  }

  let captureStartup: Promise<void> | undefined
  const ensureCapture = async () => {
    if (captureMode === "control" && state === "running") return
    if (!captureStartup) {
      captureStartup = (async () => {
        if (child) throw Error("busy")
        if (!start()) throw Error("busy")
        captureMode = "control"
        const deadline = Date.now() + 20000
        while (state !== "running") {
          if (error || state === "stopped" || Date.now() > deadline)
            throw Error(error || "engine_unavailable")
          await new Promise((resolve) => setTimeout(resolve, 30))
        }
      })().finally(() => {
        captureStartup = undefined
      })
    }
    await captureStartup
  }
  const close = async () => {
    events.close()
    const current = child,
      managed = management
    const exits = [current, managed]
      .filter(Boolean)
      .map(
        (process) => new Promise<void>((done) => process!.once("close", done))
      )
    stop()
    managed?.kill()
    await Promise.all(exits)
  }
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const path = req.url?.split("?", 1)[0] ?? ""
    const action = path.slice(prefix.length)
    if (action === "/events" && req.method === "GET") {
      events.stream(res)
      return
    }
    if (action === "/capture_api" && req.method === "POST") {
      try {
        await ensureCapture()
        const body = await readBody(req, 90 * 1024 * 1024)
        if (
          !body ||
          typeof body !== "object" ||
          typeof body.action !== "string" ||
          Object.keys(body).some((key) => !["action", "input"].includes(key)) ||
          (body.input !== undefined &&
            (!body.input ||
              typeof body.input !== "object" ||
              Array.isArray(body.input)))
        )
          throw Error("invalid_target")
        const result = await command("capture_api", body)
        if (
          [
            "record",
            "stop",
            "new_session",
            "capture_settings",
            "configure",
            "resume",
            "clear",
            "replay",
            "archive_delete",
            "archive_rename",
            "data_import",
          ].includes(body.action)
        )
          events.publish()
        return reply(res, 200, result)
      } catch (failure) {
        const code = (failure as Error).message
        return reply(res, code === "revision_conflict" ? 409 : 400, {
          error: /^[a-z_]+$/.test(code) ? code : "engine_unavailable",
        })
      }
    }
    if (
      serviceOptions.server &&
      !["/certificate", "/archive_download"].includes(action)
    )
      return reply(res, 403, { error: "forbidden" })
    if (req.method === "GET") {
      if (action === "")
        return reply(res, 200, {
          state,
          archiveID,
          archiveStatus,
          error,
          proxy,
          mode: captureMode,
          endpoint,
        })
      if (action === "/certificate") {
        try {
          return reply(res, 200, {
            pem: readFileSync(
              join(certificateDir, "mitmproxy-ca-cert.pem"),
              "utf8"
            ),
          })
        } catch {
          return reply(res, 404, { error: "certificate_unavailable" })
        }
      }
      try {
        return reply(
          res,
          200,
          await archiveCommand(
            certificateDir,
            "archive_entry",
            { session: archiveID, id: action.slice(1), live: true },
            state === "running" ? archiveID : ""
          )
        )
      } catch {
        return reply(res, 404, { error: "entry_unavailable" })
      }
    }
    if (req.method !== "POST") return reply(res, 405, { error: "forbidden" })
    try {
      if (action === "/archive_download") {
        const body = await readBody(req)
        if (body.format === "har") {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          })
          const stream = Readable.from(archiveHarChunks(certificateDir, body))
          stream.on("error", () => res.destroy())
          res.on("close", () => stream.destroy())
          stream.pipe(res)
          return
        }
        const path = archivePath(
          certificateDir,
          body.session,
          body.id,
          body.side
        )
        const file = await stat(path)
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": file.size,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        })
        const stream = createReadStream(path)
        stream.on("error", () => res.destroy())
        res.on("close", () => stream.destroy())
        stream.pipe(res)
        return
      }
      if (
        [
          "/archive_create",
          "/archive_import",
          "/archive_delete",
          "/archive_rename",
        ].includes(action)
      ) {
        // 归档写操作只走单机控制器，不能绕过活动会话保护和修订检查。
        return reply(res, 404, { error: "forbidden" })
      }
      if (action.startsWith("/archive_")) {
        const body = await readBody(req)
        const result = await archiveCommand(
          certificateDir,
          action.slice(1),
          body,
          state === "running" || state === "stopping" ? archiveID : ""
        )
        // 删除当前已停止的会话时一并释放引用，实时页不再查询已删除的目录。
        if (action === "/archive_delete" && body.session === archiveID) {
          archiveID = ""
          archiveStatus = undefined
        }
        return reply(res, 200, result)
      }
      if (
        [
          "/system_status",
          "/system_restore",
          "/certificate_status",
          "/certificate_install",
          "/certificate_remove",
        ].includes(action)
      ) {
        return reply(
          res,
          200,
          await manage(action.slice(1), await readBody(req))
        )
      }
      if (action === "/start") {
        if (!start(await readBody(req)))
          return reply(res, 409, { error: "busy" })
      } else if (action === "/stop") stop()
      else if (action === "/clear") {
        if (state === "running") await command("clear", {})
      } else if (
        [
          "/connection_info",
          "/session_status",
          "/configure",
          "/resume",
          "/replay",
          "/system_status",
          "/system_enable",
          "/system_restore",
          "/certificate_status",
          "/certificate_install",
          "/certificate_remove",
        ].includes(action)
      ) {
        return reply(
          res,
          200,
          await command(action.slice(1), await readBody(req))
        )
      } else return reply(res, 404, { error: "forbidden" })
    } catch (failure) {
      const failureCode = (failure as NodeJS.ErrnoException).code
      const code =
        failureCode === "ENOENT"
          ? "entry_unavailable"
          : ["EACCES", "ENOSPC", "EIO"].includes(failureCode ?? "")
            ? "archive_failed"
            : (failure as Error).message
      return reply(res, 400, {
        error: /^[a-z_]+$/.test(code) ? code : "engine_unavailable",
      })
    }
    return reply(res, 200, { state })
  }
  return { handle, close }
}
