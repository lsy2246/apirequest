import { describe, expect, it, vi } from "vitest"
import {
  getDefaultRESTRequest,
  HoppRESTRequest,
  isEqualHoppRESTRequest,
} from "@apirequest/data"
vi.mock("~/newstore/settings", () => ({
  settingsStore: { value: { ENCODE_MODE: "disable" } },
}))
import { preProcessRelayRequest } from "../functional/process-request"
import { queryEncodingEnabled } from "../rest/request-settings"
import { formatRequestQuery } from "../rest/request-query"
const template = () =>
  ({
    id: 1,
    url: "http://example.test/path",
    method: "GET",
    version: "HTTP/1.1",
    headers: {},
    params: [
      ["q", "a&b"],
      ["path", "%2Fready"],
    ],
  }) as any

describe("per-request query encoding", () => {
  it("persists the setting in request data and detects dirty settings", () => {
    const base = getDefaultRESTRequest(),
      request = { ...base, queryEncoding: false }
    const result = HoppRESTRequest.safeParse(
      JSON.parse(JSON.stringify(request))
    )
    expect(result.type).toBe("ok")
    if (result.type === "ok") expect(result.value.queryEncoding).toBe(false)
    expect(isEqualHoppRESTRequest(base, request)).toBe(false)
  })
  it("keeps legacy disabled defaults while explicit request values take precedence", () => {
    expect(queryEncodingEnabled({})).toBe(false)
    expect(queryEncodingEnabled({ queryEncoding: true })).toBe(true)
  })
  it("encodes reserved characters when enabled and preserves raw separators when disabled", () => {
    const enabled = preProcessRelayRequest(template(), "enable"),
      disabled = preProcessRelayRequest(template(), "disable")
    expect(enabled.url).toContain("q=a%26b")
    expect(enabled.url).toContain("path=%2Fready")
    expect(disabled.url).toContain("q=a&b")
    expect(preProcessRelayRequest(enabled, "disable").url).toBe(enabled.url)
  })
  it("matches the displayed URL to the explicit request setting", () => {
    const request = {
      ...getDefaultRESTRequest(),
      endpoint: "http://example.test",
      params: [{ key: "q", value: "a&b", active: true, description: "" }],
    }
    expect(formatRequestQuery({ ...request, queryEncoding: true })).toContain(
      "q=a%26b"
    )
    expect(formatRequestQuery({ ...request, queryEncoding: false })).toContain(
      "q=a&b"
    )
  })
})

it("normalizes empty query parameters for the native request bridge without changing the URL", () => {
  const input = {
    id: 1,
    url: "http://localhost:1080/mock/test",
    method: "GET",
    version: "HTTP/1.1",
    params: [],
  } as unknown as Parameters<typeof preProcessRelayRequest>[0]
  const result = preProcessRelayRequest(input, "enable")
  expect(result.params).toEqual({})
  expect(result.url).toBe(input.url)
  expect(input.params).toEqual([])
})
