const labels: Record<string, string> = {
  workspaceReads: "工作台读取",
  batchReads: "批量读取",
  sessionRequests: "建立工作台会话",
  externalMcp: "外部 MCP",
  publicMock: "Mock 请求",
  relayRequests: "Web 转发",
}

export function serviceLimitMessage(
  status: number,
  body?: unknown,
  retryHeader?: string | null
) {
  const data =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  if (status === 429) {
    const label =
      typeof data.group === "string" ? labels[data.group] : undefined
    const seconds = Number(data.retryAfter ?? retryHeader)
    return `${label ?? "服务请求"}过于频繁。${seconds > 0 ? `请在 ${Math.ceil(seconds)} 秒后重试。` : "请稍后重试。"}`
  }
  if (data.code === "RELAY_CONCURRENCY_LIMIT")
    return `Web 转发并发已满（${data.active}/${data.limit}）。请等待请求完成，或在服务容量中调整上限。`
  if (
    data.code === "RELAY_BODY_TOO_LARGE" ||
    data.code === "COLLECTION_IMPORT_TOO_LARGE"
  ) {
    const request =
      data.code === "COLLECTION_IMPORT_TOO_LARGE"
        ? "集合导入"
        : "转发请求正文"
    return `${request}超过 ${data.limitMiB} MiB 上限。`
  }
  if (data.code === "WORKSPACE_IMPORT_TOO_LARGE")
    return `配置包导入超过 ${data.limitMiB} MiB 上限。`
  if (status === 413) return "请求内容超过服务端大小上限。"
  return undefined
}
