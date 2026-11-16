import { beforeEach, describe, expect, it, vi } from "vitest"
import { webcrypto } from "node:crypto"
const mocks = vi.hoisted(() => ({ api: vi.fn(), open: vi.fn() }))
vi.mock("~/helpers/workbench-mcp", () => ({ workbenchMcpAPI: mocks.api }))
vi.mock("~/platform", () => ({
  platform: { localDesktop: false, kernelIO: { openExternalLink: mocks.open } },
}))
import {
  authorizeGoogle,
  defaultConnection,
  readCloud,
  writeCloud,
} from "../cloud"
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(crypto, "subtle", {
    value: webcrypto.subtle,
    configurable: true,
  })
})
const response = (body: unknown, headers = {}) => ({
  status: 200,
  body: typeof body === "string" ? body : JSON.stringify(body),
  headers,
})
describe("Google Drive connection", () => {
  it("refreshes access tokens and reads the selected application file", async () => {
    const c = {
      ...defaultConnection("google"),
      clientId: "test.apps.googleusercontent.com",
      refreshToken: "REFRESH",
    }
    mocks.api.mockImplementation(async (_path, input) => {
      if (input.url.includes("oauth2.googleapis.com")) {
        expect(new URLSearchParams(input.body).get("refresh_token")).toBe(
          "REFRESH"
        )
        return response({ access_token: "ACCESS", expires_in: 3600 })
      }
      expect(input.headers.Authorization).toBe("Bearer ACCESS")
      if (input.url.includes("/files?"))
        return response({ files: [{ id: "application-file" }] })
      return response("configuration", { etag: '"revision-1"' })
    })
    expect(await readCloud(c)).toEqual({
      text: "configuration",
      version: '"revision-1"',
      fileID: "application-file",
    })
    expect(c.accessToken).toBe("ACCESS")
  })
  it("uploads with a resumable session and the reviewed file version", async () => {
    const c = {
      ...defaultConnection("google"),
      accessToken: "ACCESS",
      expiresAt: Date.now() + 3600000,
    }
    const calls: any[] = []
    mocks.api.mockImplementation(async (_path, input) => {
      calls.push(input)
      if (input.url.includes("/files?"))
        return response({ files: [{ id: "file" }] })
      if (input.url.includes("alt=media"))
        return response("old", { etag: '"v1"' })
      if (input.method === "PATCH")
        return response("", {
          location: "https://www.googleapis.com/upload/session",
        })
      return response({ id: "file" })
    })
    await writeCloud(c, "new", { text: "old", version: '"v1"', fileID: "file" })
    const start = calls.find((c) => c.method === "PATCH")
    expect(start.headers["If-Match"]).toBe('"v1"')
    expect(start.url).toContain("uploadType=resumable")
    expect(calls.at(-1)).toMatchObject({
      method: "PUT",
      body: "new",
      url: "https://www.googleapis.com/upload/session",
    })
  })
  it("refuses to overwrite a file changed after preview", async () => {
    const c = {
      ...defaultConnection("google"),
      accessToken: "ACCESS",
      expiresAt: Date.now() + 3600000,
    }
    mocks.api.mockImplementation(async (_path, input) =>
      input.url.includes("/files?")
        ? response({ files: [{ id: "file" }] })
        : response("changed", { etag: '"v2"' })
    )
    await expect(
      writeCloud(c, "new", { text: "old", version: '"v1"', fileID: "file" })
    ).rejects.toThrow("云端配置已变化")
    expect(
      mocks.api.mock.calls.every(([, input]) => input.method === "GET")
    ).toBe(true)
  })
  it("uses PKCE with an external browser and exchanges the matching verifier", async () => {
    const c = {
      ...defaultConnection("google"),
      clientId: "test.apps.googleusercontent.com",
    }
    let auth: URL | undefined
    mocks.open.mockImplementation(async ({ url }) => {
      auth = new URL(url)
    })
    mocks.api.mockImplementation(async (path, input) => {
      if (path.endsWith("start"))
        return { id: "STATE", redirectUri: "http://127.0.0.1:4567/callback" }
      if (path.endsWith("poll")) {
        expect(input.id).toBe("STATE")
        return { code: "CODE" }
      }
      if (input.url.includes("oauth2.googleapis.com")) {
        const params = new URLSearchParams(input.body)
        expect(params.get("code")).toBe("CODE")
        const hash = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(params.get("code_verifier")!)
        )
        expect(Buffer.from(hash).toString("base64url")).toBe(
          auth?.searchParams.get("code_challenge")
        )
        return response({
          access_token: "ACCESS",
          refresh_token: "REFRESH",
          expires_in: 3600,
        })
      }
      return response({ user: { emailAddress: "me@example.com" } })
    })
    await authorizeGoogle(c)
    expect(auth?.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/drive.file"
    )
    expect(c).toMatchObject({
      accessToken: "ACCESS",
      refreshToken: "REFRESH",
      account: "me@example.com",
    })
  })
})
