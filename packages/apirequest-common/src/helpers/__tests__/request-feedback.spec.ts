import { describe, expect, it } from "vitest"
import { requestErrorFeedback } from "../request-feedback"

describe("request transport feedback", () => {
  it("recognizes wrapped relay timeouts without parsing localized messages", () => {
    expect(
      requestErrorFeedback({
        humanMessage: { heading: () => "Error" },
        error: { kind: "timeout", message: "Target request timed out" },
      })
    ).toEqual({ kind: "timeout", detail: "Target request timed out" })
    expect(
      requestErrorFeedback(new DOMException("Timed out", "TimeoutError")).kind
    ).toBe("timeout")
  })

  it("shows cancellations as a neutral state", () => {
    expect(requestErrorFeedback("cancellation").kind).toBe("cancelled")
    expect(
      requestErrorFeedback(new DOMException("Aborted", "AbortError")).kind
    ).toBe("cancelled")
  })

  it("extracts useful details without dumping arbitrary request objects", () => {
    expect(
      requestErrorFeedback({
        kind: "network",
        message: "Connection failed",
        cause: "ECONNREFUSED",
        request: { headers: { Authorization: "secret" } },
      })
    ).toEqual({ kind: "network", detail: "Connection failed\nECONNREFUSED" })
    expect(requestErrorFeedback(null)).toEqual({ kind: "network", detail: "" })
  })
})
