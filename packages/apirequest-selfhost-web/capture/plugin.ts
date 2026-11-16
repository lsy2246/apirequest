import type { Plugin } from "vite"
import { createCaptureService, prefix, reply } from "./service"

export function workbenchCapture(
  editorOrigin: string,
  backendOrigin: string,
  executable: string,
  certificateDir: string
): Plugin {
  const editor = new URL(editorOrigin)
  const service = createCaptureService(
    editorOrigin,
    backendOrigin,
    executable,
    certificateDir
  )
  return {
    name: "workbench-capture",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.once("close", () => {
        void service.close()
      })
      const close = server.close.bind(server)
      server.close = async () => {
        await service.close()
        await close()
      }
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?", 1)[0]
        if (path !== prefix && !path?.startsWith(`${prefix}/`)) return next()
        // 开发入口继续限制回环；公网服务使用独立的服务端身份验证，不能删除此检查放行。
        if (
          req.headers.host !== editor.host ||
          req.headers["x-workbench-capture"] !== "1" ||
          (req.headers.origin !== undefined &&
            req.headers.origin !== editor.origin) ||
          (req.method === "POST" && req.headers.origin !== editor.origin) ||
          !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
            req.socket.remoteAddress ?? ""
          )
        )
          return reply(res, 403, { error: "forbidden" })
        if (path === `${prefix}/auth`)
          return reply(res, 200, { authenticated: true, local: true })
        await service.handle(req, res)
      })
    },
  }
}
