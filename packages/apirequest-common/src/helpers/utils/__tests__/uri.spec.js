import { describe, expect, test } from "vitest"
import { parseUrlAndPath } from "../uri"

describe("parseUrlAndPath", () => {
  test("has url and path fields", () => {
    const result = parseUrlAndPath("https://example.com/")

    expect(result).toHaveProperty("url")
    expect(result).toHaveProperty("path")
  })

  test("parses out URL correctly", () => {
    const result = parseUrlAndPath("https://example.com/test/page")

    expect(result.url).toBe("https://example.com")
  })
  test("parses out Path correctly", () => {
    const result = parseUrlAndPath("https://example.com/test/page")

    expect(result.path).toBe("/test/page")
  })
})
