import { afterEach, describe, expect, it, vi } from "vitest"
import { Blob as NodeBlob } from "node:buffer"
import { gzipSync, deflateSync } from "node:zlib"
import {
  captureBodyDownload,
  loadCaptureEntryBodies,
  readCaptureBody,
} from "../workbench-capture-body"
import type { CaptureEntry } from "../workbench-capture"

const entry = (
  headers: [string, string][],
  text: string | null = null
): CaptureEntry => ({
  id: "fixture",
  method: "POST",
  url: "https://example.com/file",
  protocol: "HTTP/1.1",
  startedAt: 0,
  requestHeaders: headers,
  responseHeaders: headers,
  requestBody: { text, size: 12, truncated: false },
  responseBody: { text, size: 12, truncated: false },
})
describe("抓包正文下载", () => {
  it("请求和响应根据正文类型选择扩展名，保留未知二进制回退", () => {
    expect(
      captureBodyDownload(
        entry([["Content-Type", "application/problem+json; charset=utf-8"]]),
        "requestBody"
      ).filename
    ).toBe("request.json")
    expect(
      captureBodyDownload(
        entry([["Content-Type", "image/png"]]),
        "responseBody"
      ).filename
    ).toBe("response.png")
    expect(captureBodyDownload(entry([]), "responseBody").filename).toBe(
      "response.bin"
    )
    expect(
      captureBodyDownload(entry([], '{"ok":true}'), "requestBody").filename
    ).toBe("request.json")
  })
  it("使用 UTF-8 附件文件名并移除服务端路径，非法转义回退普通名称", () => {
    const headers: [string, string][] = [
      [
        "Content-Disposition",
        "attachment; filename=plain.json; filename*=UTF-8''..%2F%E6%8A%A5%E5%91%8A.json",
      ],
    ]
    expect(captureBodyDownload(entry(headers), "responseBody").filename).toBe(
      "报告.json"
    )
    headers[0][1] = "attachment; filename=plain.json; filename*=UTF-8''%ZZ"
    expect(captureBodyDownload(entry(headers), "responseBody").filename).toBe(
      "plain.json"
    )
  })
  it("下载原始压缩字节时保留压缩后缀，不冒充解压后的 JSON", () => {
    const source = entry([
      ["Content-Type", "application/json"],
      ["Content-Encoding", "gzip"],
    ])
    expect(captureBodyDownload(source, "responseBody")).toEqual({
      filename: "response.json.gz",
      type: "application/gzip",
    })
  })
  it("媒体响应可沿用 URL 文件名，请求正文不沿用响应文件名", () => {
    const source = entry([["Content-Type", "video/mp4"]])
    source.url = "https://example.com/movie.mp4?token=private"
    expect(captureBodyDownload(source, "responseBody").filename).toBe(
      "movie.mp4"
    )
    expect(captureBodyDownload(source, "requestBody").filename).toBe(
      "request.mp4"
    )
  })
})

describe("抓包完整正文", () => {
  afterEach(() => vi.unstubAllGlobals())
  const pages = (data: Buffer) =>
    vi.fn(async (offset: number) => {
      const end = Math.min(data.length, offset + 65536)
      return {
        base64: data.subarray(offset, end).toString("base64"),
        size: data.length,
        next: end < data.length ? end : null,
      }
    })
  it("自动读完请求和响应，跨分页的中文、尾部和 JSON 不丢失", async () => {
    const request = JSON.stringify({
      value: "x".repeat(65525) + "中文".repeat(80000),
      end: "request-end",
    })
    const response = JSON.stringify({
      value: "y".repeat(800000),
      end: "response-end",
    })
    const readers = {
      requestBody: pages(Buffer.from(request)),
      responseBody: pages(Buffer.from(response)),
    }
    const source = entry([["Content-Type", "application/json"]])
    source.requestBody = {
      text: request.slice(0, 100),
      size: Buffer.byteLength(request),
      truncated: true,
    }
    source.responseBody = {
      text: response.slice(0, 100),
      size: Buffer.byteLength(response),
      truncated: true,
    }
    source.requestComplete = source.responseComplete = true
    const read = vi.fn((side: "requestBody" | "responseBody", offset: number) =>
      readers[side](offset)
    )
    const result = await loadCaptureEntryBodies(source, read)
    expect(result.requestBody?.text).toBe(request)
    expect(result.responseBody?.text).toBe(response)
    expect(JSON.parse(result.requestBody!.text!).end).toBe("request-end")
    expect(JSON.parse(result.responseBody!.text!).end).toBe("response-end")
    expect(result.requestBody?.truncated).toBe(false)
    expect(result.responseBody?.truncated).toBe(false)
    expect(Buffer.from(result.responseBody!.base64!, "base64").toString()).toBe(
      response
    )
    read.mockClear()
    const cached = await loadCaptureEntryBodies(source, read, result)
    expect(read).not.toHaveBeenCalled()
    expect(cached.requestBody).toBe(result.requestBody)
    const nextResponse = Buffer.from(response + "tail")
    source.responseBody.size = nextResponse.length
    readers.responseBody = pages(nextResponse)
    const refreshed = await loadCaptureEntryBodies(source, read, cached)
    expect(refreshed.responseBody?.text).toBe(response + "tail")
    expect(read.mock.calls.every(([side]) => side === "responseBody")).toBe(
      true
    )
  })
  it.each(["gzip", "deflate"] as const)(
    "完整解压 %s 正文，并保留原始压缩字节",
    async (encoding) => {
      vi.stubGlobal("Blob", NodeBlob)
      const text = JSON.stringify({
        value: "中文".repeat(3000000),
        end: "compressed-end",
      })
      const compressed = (encoding === "gzip" ? gzipSync : deflateSync)(
        Buffer.from(text)
      )
      const body = await readCaptureBody(pages(compressed), [
        ["Content-Encoding", encoding],
      ])
      expect(body.text).toBe(text)
      expect(body.truncated).toBe(false)
      expect(Buffer.from(body.base64!, "base64")).toEqual(compressed)
    }
  )
  it("快速切换请求后停止读取旧正文", async () => {
    let current = true
    const read = vi.fn(async () => {
      current = false
      return { base64: btoa("old"), size: 100000, next: 3 }
    })
    await expect(
      readCaptureBody(read, [], () => current)
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(read).toHaveBeenCalledTimes(1)
  })
  it("损坏的正文不会被标为完整，也不会在无进展的分页上循环", async () => {
    const body = await readCaptureBody(async () => ({
      base64: btoa("part"),
      size: 100,
      next: null,
    }))
    expect(body.truncated).toBe(true)
    await expect(
      readCaptureBody(async () => ({ base64: "", size: 100, next: 0 }))
    ).rejects.toThrow("Invalid capture body offset")
  })
})
