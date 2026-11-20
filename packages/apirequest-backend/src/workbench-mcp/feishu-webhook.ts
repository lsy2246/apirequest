import { createHmac } from 'node:crypto';

export class WebhookDeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
const brief = (value: unknown, limit = 300) =>
  String(value ?? '').slice(0, limit);

function notificationText(payload: Record<string, any>) {
  if (payload.event === 'automation.webhook_test')
    return `APIRequest Webhook 测试通知\n通知连接正常。\n${payload.createdAt}`;
  const summary = payload.summary;
  const lines = [
    `APIRequest 自动化测试 · ${brief(payload.name, 200)}`,
    `环境：${brief(payload.environment?.name || '无环境', 100)}`,
    `共 ${summary.total} 条，已执行 ${summary.completed} 条`,
    `成功 ${summary.passed} · 失败 ${summary.failed} · 超时 ${summary.timeout} · 执行错误 ${summary.errors}`,
    `耗时：${(summary.elapsedMs / 1000).toFixed(2)} 秒`,
    `报告：${payload.reportURL}`,
  ];
  if (payload.failures?.length) {
    lines.push('', '失败详情：');
    for (const failure of payload.failures.slice(0, 10)) {
      lines.push(
        `• ${brief(failure.name, 300)}${failure.type === 'timeout' ? '（超时）' : ''}`,
      );
      for (const error of (failure.errors ?? []).slice(0, 3))
        lines.push(`  ${brief(error.code, 100)}：${brief(error.message)}`);
      for (const assertion of (failure.assertions ?? []).slice(0, 3))
        for (const message of (assertion.messages ?? []).slice(0, 3))
          lines.push(`  ${brief(assertion.name, 100)}：${brief(message)}`);
    }
    const omitted =
      Math.max(0, payload.failures.length - 10) +
      (payload.omittedFailures ?? 0);
    if (omitted) lines.push(`其余 ${omitted} 条失败详情请查看报告。`);
  }
  for (const error of (payload.errors ?? []).slice(0, 10))
    lines.push(`${brief(error.code, 100)}：${brief(error.message)}`);
  // Test names and assertion messages are plain text, never @mention markup.
  return lines.join('\n').replaceAll('<', '＜').replaceAll('>', '＞');
}

/** Feishu signs an empty body with timestamp + newline + secret as the HMAC key. */
export function feishuWebhookBody(
  payload: Record<string, any>,
  timestamp: string,
  secret: string,
) {
  let text = notificationText(payload);
  const message = () => ({
    msg_type: 'text',
    content: { text },
    ...(secret
      ? {
          timestamp,
          sign: createHmac('sha256', `${timestamp}\n${secret}`)
            .update('')
            .digest('base64'),
        }
      : {}),
  });
  // Reserve space under the robot's 20 KB request limit, including JSON escaping.
  while (Buffer.byteLength(JSON.stringify(message()), 'utf8') > 18000)
    text =
      Array.from(text)
        .slice(0, Math.floor(Array.from(text).length * 0.8))
        .join('') + '\n内容较长，完整详情请查看报告。';
  return JSON.stringify(message());
}

export async function assertFeishuResponse(
  response: Response,
  privateValues: string[],
) {
  const reader = response.body?.getReader();
  if (!reader)
    throw new WebhookDeliveryError(
      '飞书机器人返回了空响应，无法确认消息是否送达',
    );
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        throw new WebhookDeliveryError(
          '飞书机器人响应过大，无法确认消息是否送达',
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let result: any;
  try {
    result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new WebhookDeliveryError(
      '飞书机器人响应格式无效，无法确认消息是否送达',
    );
  }
  const code = result?.code ?? result?.StatusCode;
  if (typeof code !== 'number')
    throw new WebhookDeliveryError(
      '飞书机器人响应缺少结果码，无法确认消息是否送达',
    );
  if (code !== 0) {
    let reason = brief(
      result?.msg ?? result?.StatusMessage ?? '消息发送失败',
      500,
    );
    for (const value of privateValues.filter(Boolean))
      reason = reason.replaceAll(value, '[已隐藏]');
    throw new WebhookDeliveryError(`飞书机器人拒收（${code}）：${reason}`);
  }
}
