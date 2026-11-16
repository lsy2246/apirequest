import { describe, expect, it } from "vitest"
import { proxyURLWithCredentials } from "../functional/domain-settings"

describe("proxy URL credentials", () => {
  it("keeps URL-only settings and incomplete drafts unchanged", () => {
    expect(proxyURLWithCredentials()).toBe("")
    for (const url of [
      "",
      "socks5://",
      "socks5://user:pass@localhost:1080",
      "http://127.0.0.1:8080",
    ]) {
      expect(proxyURLWithCredentials({ url })).toBe(url)
    }
  })

  it("preserves existing separate credentials and encodes special characters", () => {
    const auth = { username: "name@公司", password: "p@ss:/?#% 密码" }
    const proxy = { url: "socks5://127.0.0.1:1080", auth }
    const displayed = new URL(proxyURLWithCredentials(proxy))
    expect(decodeURIComponent(displayed.username)).toBe(auth.username)
    expect(decodeURIComponent(displayed.password)).toBe(auth.password)
    expect(displayed.hostname).toBe("127.0.0.1")
    expect(displayed.port).toBe("1080")
    expect(proxy.url).toBe("socks5://127.0.0.1:1080")
    expect(proxy.auth).toEqual(auth)
  })

  it("keeps legacy field precedence over embedded credentials", () => {
    const displayed = new URL(
      proxyURLWithCredentials({
        url: "http://old:old@127.0.0.1:8080",
        auth: { username: "current", password: "current-password" },
      })
    )
    expect(displayed.username).toBe("current")
    expect(displayed.password).toBe("current-password")
  })

  it("preserves intentionally empty legacy credentials", () => {
    const displayed = new URL(
      proxyURLWithCredentials({
        url: "http://old:old@127.0.0.1:8080",
        auth: { username: "current", password: "" },
      })
    )
    expect(displayed.username).toBe("current")
    expect(displayed.password).toBe("")
  })

  it("does not discard an invalid legacy address while editing", () => {
    expect(
      proxyURLWithCredentials({
        url: "socks5://",
        auth: { username: "user", password: "pass" },
      })
    ).toBe("socks5://")
  })
})
