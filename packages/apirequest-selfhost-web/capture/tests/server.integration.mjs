// 使用真实引擎验证生产控制入口；专用目录和端口在 finally 中回收，不改系统设置。
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { once } from "node:events"
import { createServer, request as httpRequest } from "node:http"
import { runCaptureServer } from "../../capture-dist/server.mjs"
const root = await mkdtemp(join(tmpdir(), "capture-server-"))
const secret = "synthetic-capture-owner-secret-for-test"
const executable = process.argv[2]
assert.ok(executable, "需要 mitmdump 路径")
const origin = "http://localhost:31998"
Object.assign(process.env, {
  APIREQUEST_CAPTURE_ORIGIN: origin,
  APIREQUEST_CAPTURE_OWNER_SECRET: secret,
  APIREQUEST_CAPTURE_CA_DIR: root,
  APIREQUEST_CAPTURE_EXECUTABLE: executable,
  APIREQUEST_CAPTURE_CONTROL_PORT: "0",
})
const fixture = createServer((req, res) => res.end("upstream"))
fixture.listen(0, "127.0.0.1")
await once(fixture, "listening")
const service = runCaptureServer()
await once(service.server, "listening")
const address = service.server.address()
async function api(path, body, cookie, extra = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: address.port,
        path: "/__workbench_capture/" + path,
        method: body === undefined ? "GET" : "POST",
        headers: {
          Host: "localhost:31998",
          Origin: origin,
          "X-Workbench-Capture": "1",
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
          ...extra,
        },
      },
      (response) => {
        let data = ""
        response.setEncoding("utf8")
        response.on("data", (chunk) => (data += chunk))
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            data: JSON.parse(data),
          })
        )
      }
    )
    request.on("error", reject)
    if (body !== undefined) request.end(JSON.stringify(body))
    else request.end()
  })
}
try {
  assert.equal((await api("capture_api", { action: "status" })).status, 401)
  const first = await api("auth", { password: secret })
  const second = await api("auth", { password: secret })
  const a = first.headers["set-cookie"][0].split(";")[0],
    b = second.headers["set-cookie"][0].split(";")[0]
  const call = async (action, input = {}, cookie = a) => {
    const response = await api("capture_api", { action, input }, cookie)
    assert.equal(response.status, 200, response.data.error)
    return response.data
  }
  let state = await call("status")
  assert.ok(state.server)
  assert.equal(state.state, "stopped")
  assert.ok(!Object.hasOwn(state, "devices"))
  state = await call("capture_settings", {
    revision: state.revision,
    mode: "system",
    systemProxy: false,
    service: "",
  })
  assert.equal((await call("status", {}, b)).revision, state.revision)
  assert.equal(
    (
      await api("capture_api", { action: "status" }, a, {
        Origin: "https://evil.example",
      })
    ).status,
    403
  )
  assert.equal(
    (
      await api(
        "capture_api",
        {
          action: "capture_settings",
          input: { revision: 0, mode: "system", systemProxy: false },
        },
        a
      )
    ).status,
    409
  )
  assert.equal(
    (await api("capture_api", { action: "device_save", input: {} }, a)).status,
    400
  )
  assert.equal(
    (
      await api(
        "capture_api",
        {
          action: "capture_settings",
          input: {
            revision: state.revision,
            mode: "wireguard",
            systemProxy: false,
          },
        },
        a
      )
    ).status,
    400
  )
  assert.equal(
    (await api("capture_api", { action: "certificate_install", input: {} }, a))
      .status,
    400
  )
  assert.equal((await api("system_enable", {}, a)).status, 403)
  console.log(
    "PASS production authentication, shared single capture settings, CSRF rejection, revision conflicts and removed device/tunnel actions"
  )
} finally {
  await service.close()
  fixture.closeAllConnections()
  await new Promise((resolve) => fixture.close(resolve))
  await rm(root, { recursive: true, force: true })
}
