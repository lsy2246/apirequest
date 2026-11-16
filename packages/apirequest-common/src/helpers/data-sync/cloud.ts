import { invoke } from "@tauri-apps/api/core";
import { platform } from "~/platform";
import { workbenchMcpAPI } from "~/helpers/workbench-mcp";

export type Connection = {
  provider: "webdav" | "google"
  url: string
  username: string
  password: string
  fileName: string
  clientId: string
  clientSecret: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  account?: string
}
export const defaultConnection = (
  provider: Connection["provider"]
): Connection => ({
  provider,
  url: "",
  username: "",
  password: "",
  fileName: "apirequest-config.json",
  clientId: "",
  clientSecret: "",
})
type Reply = { status: number; headers: Record<string, string>; body: string }
type HTTP = {
  provider: Connection["provider"]
  url: string
  method: string
  headers?: Record<string, string>
  body?: string
}
const native = () =>
  Boolean(platform.localDesktop || import.meta.env.VITE_WORKBENCH_NATIVE)
export async function bridge<T>(action: string, body: unknown = {}) {
  return native()
    ? invoke<T>("workbench_cloud", { action, body })
    : workbenchMcpAPI<T>(`data/${action}`, body)
}
async function http(input: HTTP) {
  return bridge<Reply>("http", input)
}
function failure(reply: Reply) {
  if (reply.status === 401 || reply.status === 403)
    throw new Error("同步源拒绝访问，请检查账号、应用密码或重新授权 Google")
  if (reply.status === 409 || reply.status === 412)
    throw new Error("云端配置已变化，请重新预览后同步")
  if (reply.status >= 300 && reply.status < 400)
    throw new Error("同步地址发生重定向，请填写最终地址")
  throw new Error(`同步服务返回 HTTP ${reply.status}`)
}
function validateFileName(value: string) {
  if (
    !value ||
    value.length > 100 ||
    !value.endsWith(".json") ||
    value.startsWith(".") ||
    Array.from(value).some(
      (char) => char.charCodeAt(0) < 32 || [47, 92].includes(char.charCodeAt(0))
    )
  )
    throw new Error("同步文件名必须以 .json 结尾，不能包含路径")
}
function davURL(c: Connection) {
  const url = new URL(c.url)
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("请填写有效的 WebDAV 目录地址")
  validateFileName(c.fileName)
  url.pathname =
    url.pathname.replace(/\/?$/, "/") + encodeURIComponent(c.fileName)
  return url.href
}
function basic(c: Connection) {
  const bytes = new TextEncoder().encode(`${c.username}:${c.password}`)
  let value = ""
  for (const b of bytes) value += String.fromCharCode(b)
  return { Authorization: `Basic ${btoa(value)}` }
}
const tokenURL = "https://oauth2.googleapis.com/token"
async function token(c: Connection) {
  if (c.accessToken && (c.expiresAt ?? 0) > Date.now() + 60000)
    return c.accessToken
  if (!c.refreshToken) throw new Error("请先连接 Google Drive")
  const response = await http({
    provider: "google",
    url: tokenURL,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.clientId,
      ...(c.clientSecret ? { client_secret: c.clientSecret } : {}),
      refresh_token: c.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  })
  if (response.status !== 200) failure(response)
  const data = JSON.parse(response.body)
  if (!data.access_token) throw new Error("Google 授权已失效，请重新连接")
  c.accessToken = data.access_token
  c.expiresAt = Date.now() + Number(data.expires_in ?? 3600) * 1000
  if (data.refresh_token) c.refreshToken = data.refresh_token
  return c.accessToken!
}
const bytes64 = (bytes: Uint8Array) => {
  let s = ""
  for (const byte of bytes) s += String.fromCharCode(byte)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
export async function authorizeGoogle(
  c: Connection,
  signal?: AbortSignal,
  onOpen?: (url: string) => void
) {
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(c.clientId))
    throw new Error("请填写桌面应用的 Google OAuth Client ID")
  const verifier = bytes64(crypto.getRandomValues(new Uint8Array(48))),
    challenge = bytes64(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier)
        )
      )
    )
  const flow = await bridge<{ id: string; redirectUri: string }>("oauth/start")
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  auth.search = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: flow.redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    prompt: "consent",
    state: flow.id,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString()
  let completed = false
  try {
    onOpen?.(auth.href)
    await platform.kernelIO.openExternalLink({ url: auth.href })
    const deadline = Date.now() + 290000
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("已取消 Google 授权")
      const result = await bridge<{
        pending: boolean
        code?: string
        error?: string
      }>("oauth/poll", { id: flow.id })
      if (result.error) throw new Error(result.error)
      if (result.code) {
        const response = await http({
          provider: "google",
          url: tokenURL,
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: c.clientId,
            ...(c.clientSecret ? { client_secret: c.clientSecret } : {}),
            code: result.code,
            redirect_uri: flow.redirectUri,
            code_verifier: verifier,
            grant_type: "authorization_code",
          }).toString(),
        })
        if (response.status !== 200) failure(response)
        const data = JSON.parse(response.body)
        if (!data.access_token || !data.refresh_token)
          throw new Error("Google 未授予离线访问权限，请重新连接并允许授权")
        const connected = {
          ...c,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
          account: "",
        }
        const about = await http({
          provider: "google",
          url: "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)",
          method: "GET",
          headers: { Authorization: `Bearer ${connected.accessToken}` },
        })
        const account =
          about.status === 200
            ? JSON.parse(about.body).user?.emailAddress
            : undefined
        if (!account) throw new Error("无法确认 Google 账号，请重新连接")
        connected.account = account
        Object.assign(c, connected)
        completed = true
        return
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
    throw new Error("Google 授权超时，请重新连接")
  } finally {
    if (!completed)
      await bridge("oauth/poll", { id: flow.id, cancel: true }).catch(() => {})
  }
}
async function googleFile(c: Connection) {
  validateFileName(c.fileName)
  const auth = { Authorization: `Bearer ${await token(c)}` }
  const q = `trashed = false and name = '${c.fileName.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`
  const response = await http({
    provider: "google",
    url: `https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q, fields: "files(id,name)", pageSize: "100" })}`,
    method: "GET",
    headers: auth,
  })
  if (response.status !== 200) failure(response)
  const files = JSON.parse(response.body).files as { id: string }[]
  if (files.length > 1)
    throw new Error("Google Drive 中有多个同名同步文件，请更换同步文件名")
  return { file: files[0], auth }
}
export type Remote = {
  text: string | null
  version: string | null
  fileID?: string
}
export async function readCloud(c: Connection): Promise<Remote> {
  if (c.provider === "webdav") {
    const reply = await http({
      provider: "webdav",
      url: davURL(c),
      method: "GET",
      headers: basic(c),
    })
    if (reply.status === 404) return { text: null, version: null }
    if (reply.status !== 200) failure(reply)
    if (!reply.headers.etag)
      throw new Error("此 WebDAV 服务未提供 ETag，无法防止覆盖并发修改")
    return { text: reply.body, version: reply.headers.etag }
  }
  const { file, auth } = await googleFile(c)
  if (!file) return { text: null, version: null }
  const reply = await http({
    provider: "google",
    url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,
    method: "GET",
    headers: auth,
  })
  if (reply.status !== 200) failure(reply)
  return {
    text: reply.body,
    version: reply.headers.etag ?? null,
    fileID: file.id,
  }
}
export async function testCloud(c: Connection) {
  // PROPFIND 仅检查用户指定目录，不把「文件尚未创建」误判为连接成功。
  if (c.provider === "webdav") {
    davURL(c)
    const reply = await http({
      provider: "webdav",
      url: c.url,
      method: "PROPFIND",
      headers: { ...basic(c), Depth: "0" },
    })
    if (![200, 207].includes(reply.status)) failure(reply)
  } else await googleFile(c)
}
export async function writeCloud(
  c: Connection,
  text: string,
  expected: Remote
) {
  if (c.provider === "webdav") {
    const reply = await http({
      provider: "webdav",
      url: davURL(c),
      method: "PUT",
      headers: {
        ...basic(c),
        "Content-Type": "application/json",
        ...(expected.text === null
          ? { "If-None-Match": "*" }
          : { "If-Match": expected.version! }),
      },
      body: text,
    })
    if (![200, 201, 204].includes(reply.status)) failure(reply)
    return
  }
  const latest = await readCloud(c)
  if (latest.text !== expected.text || latest.fileID !== expected.fileID)
    throw new Error("云端配置已变化，请重新预览后同步")
  const auth = { Authorization: `Bearer ${await token(c)}` }
  // 可见配置文件，只访问应用创建的文件；大附件统一使用可恢复上传。
  const reply = await http({
    provider: "google",
    url: expected.fileID
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(expected.fileID)}?uploadType=resumable`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`,
    method: expected.fileID ? "PATCH" : "POST",
    headers: {
      ...auth,
      "Content-Type": "application/json",
      "X-Upload-Content-Type": "application/json",
      ...(expected.version ? { "If-Match": expected.version } : {}),
    },
    body: JSON.stringify({ name: c.fileName }),
  })
  if (![200, 201].includes(reply.status)) failure(reply)
  const location = reply.headers.location
  if (!location || new URL(location).origin !== "https://www.googleapis.com")
    throw new Error("Google 未返回有效上传地址")
  const uploaded = await http({
    provider: "google",
    url: location,
    method: "PUT",
    headers: { ...auth, "Content-Type": "application/json" },
    body: text,
  })
  if (![200, 201].includes(uploaded.status)) failure(uploaded)
}
