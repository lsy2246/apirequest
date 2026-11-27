/** Read only known transport fields; never mistake an HTTP status for a network error. */
export function requestErrorFeedback(error: unknown): {
  kind: "cancelled" | "timeout" | "network" | "service-limit"
  detail: string
} {
  if (error === "cancellation") return { kind: "cancelled", detail: "" }
  if (!error || typeof error !== "object") {
    return { kind: "network", detail: typeof error === "string" ? error : "" }
  }
  const value = error as Record<string, unknown>
  // Interceptors wrap the transport error alongside their localized message.
  if (value.error && typeof value.error === "object") {
    return requestErrorFeedback(value.error)
  }
  const detail = [value.message, value.cause, value.code]
    .filter((part): part is string => typeof part === "string")
    .join("\n")
  if (localRelayStatus(value)) return { kind: "service-limit", detail }
  if (
    value.kind === "timeout" ||
    value.code === "ETIMEDOUT" ||
    value.name === "TimeoutError"
  ) {
    return { kind: "timeout", detail }
  }
  if (
    value.kind === "cancelled" ||
    value.kind === "cancellation" ||
    value.name === "AbortError"
  ) {
    return { kind: "cancelled", detail }
  }
  return { kind: "network", detail }
}


export function localRelayStatus(error: unknown): 413 | 429 | 503 | undefined {
  if (!error || typeof error !== "object" || !("cause" in error)) return
  const cause = error.cause
  if (!cause || typeof cause !== "object" || !("localRelayStatus" in cause)) return
  const status = cause.localRelayStatus
  if (status === 413 || status === 429 || status === 503) return status
}
