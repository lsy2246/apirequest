import type { RequestRunnerResponse } from "../interfaces/response";

// Axios errors carry request configuration; retain the actual error and causes without copying request credentials.
export function reportError(
  value: unknown,
  seen = new Set<unknown>()
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => reportError(item, seen));
  const error = value as Record<string, unknown>;
  const fields = [
    "name",
    "message",
    "code",
    "errno",
    "syscall",
    "address",
    "port",
    "stack",
    "cause",
    "errors",
  ];
  const result: Record<string, unknown> = {};
  for (const key of fields) {
    if (error[key] !== undefined) result[key] = reportError(error[key], seen);
  }
  if (!Object.keys(result).length) {
    for (const [key, item] of Object.entries(error)) {
      if (!["config", "request", "response"].includes(key))
        result[key] = reportError(item, seen);
    }
  }
  return result;
}

export function reportResponse(response: RequestRunnerResponse) {
  const body =
    typeof response.body === "string"
      ? response.body
      : (JSON.stringify(response.body, null, 2) ?? "");
  const limit = 256 * 1024;
  return {
    statusCode: response.status,
    statusText: response.statusText,
    headers: response.headers,
    body: body.slice(0, limit),
    bodyTruncated: body.length > limit,
  };
}
