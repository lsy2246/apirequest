import { describe, expect, it } from "vitest"
import {
  captureHar,
  parseCaptureEvents,
  type CaptureEntry,
} from "../workbench-capture"

describe("抓包内容契约", () => {
  it("SSE 保留多行数据与事件 ID，忽略注释和未终止事件", () => {
    expect(
      parseCaptureEvents(
        ":ping\r\nid: 9\r\nevent: delta\r\ndata: first\r\ndata: second\r\n\r\ndata: unfinished"
      )
    ).toEqual([{ index: 0, id: "9", event: "delta", data: "first\nsecond" }])
  })
  it("HAR 导出完整保留二进制正文、认证头和原始查询参数", () => {
    const source: CaptureEntry = {
      id: "test",
      method: "POST",
      url: "https://example.com/upload?token=secret&a=1&a=2",
      protocol: "HTTP/2",
      startedAt: 1700000000000,
      status: 200,
      requestHeaders: [
        ["Authorization", "Bearer secret"],
        ["Content-Type", "application/octet-stream"],
      ],
      responseHeaders: [
        ["Set-Cookie", "session=secret"],
        ["Content-Type", "image/png"],
      ],
      requestBody: { text: null, size: 3, truncated: false, base64: "AP/+" },
      responseBody: { text: null, size: 3, truncated: false, base64: "AP/+" },
      requestComplete: true,
      responseComplete: true,
    }
    const exported = captureHar(source, true).log.entries[0]
    expect(new URL(exported.request.url).searchParams.get("token")).toBe(
      "secret"
    )
    expect(new URL(exported.request.url).searchParams.getAll("a")).toEqual([
      "1",
      "2",
    ])
    expect(exported.request.headers).toContainEqual({
      name: "Authorization",
      value: "Bearer secret",
    })
    expect(exported.response.headers).toContainEqual({
      name: "Set-Cookie",
      value: "session=secret",
    })
    expect(exported.request.postData?.text).toBe("AP/+")
    expect(exported.response.content.text).toBe("AP/+")
  })
})
