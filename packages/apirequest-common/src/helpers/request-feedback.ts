/** Read only known transport fields; never mistake an HTTP status for a network error. */
export function requestErrorFeedback(error: unknown): {
  kind: "cancelled" | "timeout" | "network"
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
