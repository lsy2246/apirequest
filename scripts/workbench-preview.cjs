// 本地验收用回显服务，不连接外部 API；HTTP、GraphQL、WebSocket 共用一个可清理的进程。
const http = require("node:http")
const path = require("node:path")
const root = path.resolve(__dirname, "..")
const vite = require.resolve("vite/package.json", { paths: [path.join(root, "packages/apirequest-selfhost-web")] })
const { WebSocketServer } = require(require.resolve("ws", { paths: [path.dirname(vite)] }))
const { buildSchema, graphql } = require(require.resolve("graphql", { paths: [path.join(root, "packages/apirequest-backend")] }))
const schema = buildSchema("type Profile { name: String!, role: String! } type Query { hello: String!, profile: Profile! }")
let completed = 0
let active = 0
let maximum = 0
const timers = new Set()
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin
  if (["http://127.0.0.1:3000", "http://localhost:3000"].includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin)
  res.setHeader("Access-Control-Allow-Headers", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return }
  const url = new URL(req.url, "http://127.0.0.1:3188")
  if (url.pathname === "/metrics") { res.end(JSON.stringify({ completed, active, maximum })); return }
  maximum = Math.max(maximum, ++active)
  let timer
  res.once("close", () => { active--; if (timer) { clearTimeout(timer); timers.delete(timer) } })
  let body = ""
  try {
    // 验收夹具只接受小型文本请求；资源限制不影响工作台正式请求能力。
    for await (const chunk of req) {
      body += chunk
      if (body.length > 65536) { res.writeHead(413); res.end(); return }
    }
    if (url.pathname === "/graphql") {
      const input = JSON.parse(body || "{}")
      const result = await graphql({ schema, source: input.query || "{ hello }", variableValues: input.variables, rootValue: { hello: "GraphQL 本地验证成功", profile: () => ({ name: "本地测试用户", role: "开发者" }) } })
      completed++; res.end(JSON.stringify(result)); return
    }
    const delay = Math.min(10000, Math.max(0, Number(url.searchParams.get("delay")) || 25))
    timer = setTimeout(() => {
      timers.delete(timer)
      if (!res.destroyed) { completed++; res.end(JSON.stringify({ success: true, message: "接口请求成功", data: { name: "本地测试用户", role: "开发者" }, method: req.method, path: url.pathname })) }
    }, delay)
    timers.add(timer)
  } catch { if (!res.destroyed) { res.writeHead(400); res.end('{"error":"invalid request"}') } }
})
const ws = new WebSocketServer({ server })
ws.on("connection", client => client.on("message", (data, binary) => client.send(binary ? data : `收到消息：${data}`, { binary })))
server.listen(3188, "127.0.0.1", () => console.log(`本地验收服务 http://127.0.0.1:3188，PID ${process.pid}`))
const close = () => {
  for (const timer of timers) clearTimeout(timer)
  for (const client of ws.clients) client.terminate()
  ws.close()
  server.close(() => process.exit(0))
  server.closeAllConnections()
}
process.once("SIGTERM", close)
process.once("SIGINT", close)
