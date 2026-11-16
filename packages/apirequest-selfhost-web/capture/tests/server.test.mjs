// 公开控制面的定向回归：鉴权、同源检查、会话轮换和限速均由服务端执行。
import { test } from "node:test"
import assert from "node:assert/strict"
import { createOwnerAccess } from "../../capture-dist/server.mjs"
const origin = "https://capture.example.test"
const secret = "test-owner-secret-for-capture-only"
function request(path, { method = "GET", body, headers = {} } = {}) {
  return {
    url: "/__workbench_capture/" + path,
    method,
    headers: {
      host: "capture.example.test",
      origin,
      "x-workbench-capture": "1",
      ...headers,
    },
    async *[Symbol.asyncIterator]() {
      if (body) yield Buffer.from(JSON.stringify(body))
    },
  }
}
function response() {
  return {
    status: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value
    },
    writeHead(status, headers) {
      this.status = status
      Object.assign(this.headers, headers)
    },
    end(value) {
      this.body = value
    },
  }
}
const login = async (access, headers = {}) => {
  const res = response()
  await access(
    request("auth", { method: "POST", body: { password: secret }, headers }),
    res
  )
  return res
}
test("public management refuses insecure origins and weak owner secrets", () => {
  assert.throws(() => createOwnerAccess("http://capture.example.test", secret))
  assert.throws(() => createOwnerAccess(origin, "short"))
})
test("unauthenticated control and cross-origin requests are denied", async () => {
  const access = createOwnerAccess(origin, secret)
  let res = response()
  assert.equal(
    await access(request("capture_api", { method: "POST" }), res),
    false
  )
  assert.equal(res.status, 401)
  res = response()
  await access(
    request("auth", {
      method: "POST",
      body: { password: secret },
      headers: { origin: "https://evil.example" },
    }),
    res
  )
  assert.equal(res.status, 403)
  res = response()
  await access(request("auth", { headers: { host: "evil.example" } }), res)
  assert.equal(res.status, 403)
})
test("secure cookie session rotates and logout revokes access", async () => {
  const access = createOwnerAccess(origin, secret)
  const first = await login(access)
  assert.equal(first.status, 200)
  const setCookie = first.headers["set-cookie"]
  assert.match(setCookie, /Secure/)
  assert.match(setCookie, /HttpOnly/)
  assert.match(setCookie, /SameSite=Strict/)
  const oldCookie = setCookie.split(";")[0]
  assert.equal(
    await access(
      request("capture_api", {
        method: "POST",
        headers: { cookie: oldCookie },
      }),
      response()
    ),
    true
  )
  const second = await login(access, { cookie: oldCookie })
  assert.notEqual(second.headers["set-cookie"], setCookie)
  assert.equal(
    await access(
      request("capture_api", {
        method: "POST",
        headers: { cookie: oldCookie },
      }),
      response()
    ),
    false
  )
  const cookie = second.headers["set-cookie"].split(";")[0]
  await access(
    request("auth", { method: "DELETE", headers: { cookie } }),
    response()
  )
  assert.equal(
    await access(
      request("capture_api", { method: "POST", headers: { cookie } }),
      response()
    ),
    false
  )
})
test("wrong secrets are rejected and attempts are bounded", async () => {
  const access = createOwnerAccess(origin, secret)
  let res
  for (let index = 0; index < 6; index++) {
    res = response()
    await access(
      request("auth", { method: "POST", body: { password: "wrong" } }),
      res
    )
    assert.equal(res.status, index < 5 ? 401 : 429)
  }
})
test("absolute and idle session expiration are enforced by the server", async () => {
  const access = createOwnerAccess(origin, secret)
  const res = await login(access),
    cookie = res.headers["set-cookie"].split(";")[0]
  const original = Date.now,
    now = Date.now()
  try {
    Date.now = () => now + 86400001
    assert.equal(
      await access(
        request("capture_api", { method: "POST", headers: { cookie } }),
        response()
      ),
      false
    )
  } finally {
    Date.now = original
  }
})

test("active sessions still expire at the absolute seven-day deadline", async () => {
  const access = createOwnerAccess(origin, secret)
  const res = await login(access),
    cookie = res.headers["set-cookie"].split(";")[0]
  const original = Date.now,
    start = Date.now()
  try {
    for (let halfDay = 1; halfDay < 14; halfDay++) {
      Date.now = () => start + halfDay * 43200000
      assert.equal(
        await access(
          request("capture_api", { method: "POST", headers: { cookie } }),
          response()
        ),
        true
      )
    }
    Date.now = () => start + 7 * 86400000 + 1
    assert.equal(
      await access(
        request("capture_api", { method: "POST", headers: { cookie } }),
        response()
      ),
      false
    )
  } finally {
    Date.now = original
  }
})
