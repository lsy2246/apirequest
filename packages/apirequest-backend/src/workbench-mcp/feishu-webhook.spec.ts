import { getAutomationWebhookFormat } from '@apirequest/data';
import { feishuWebhookBody } from './feishu-webhook';

describe('Feishu notification formatting', () => {
  it('detects only official bot Webhooks and preserves generic JSON destinations', () => {
    expect(
      getAutomationWebhookFormat(
        'https://open.feishu.cn/open-apis/bot/v2/hook/token',
      ),
    ).toBe('feishu');
    for (const url of [
      '',
      'https://example.com/hook',
      'https://open.feishu.cn.evil.com/open-apis/bot/v2/hook/token',
      'https://open.feishu.cn/other',
    ])
      expect(getAutomationWebhookFormat(url)).toBe('json');
  });
  it('keeps a large Chinese failure report under the request size limit and retains its report link', () => {
    const body = feishuWebhookBody(
      {
        event: 'automation.completed',
        name: '测试',
        environment: {},
        summary: {
          total: 100,
          completed: 100,
          passed: 0,
          failed: 100,
          timeout: 0,
          errors: 0,
          elapsedMs: 2000,
        },
        reportURL: 'http://localhost/automation?report=demo',
        failures: Array.from({ length: 100 }, () => ({
          name: '长用例'.repeat(300),
          assertions: [
            {
              name: '响应断言',
              messages: [
                '错误'.repeat(3000),
                '更多错误'.repeat(3000),
                '错误'.repeat(3000),
              ],
            },
          ],
        })),
      },
      '12345',
      '',
    );
    expect(Buffer.byteLength(body)).toBeLessThan(20000);
    expect(JSON.parse(body).content.text).toContain(
      'http://localhost/automation?report=demo',
    );
  });
  it('renders names as plain text without triggering mention markup', () => {
    const body = feishuWebhookBody(
      {
        event: 'automation.completed',
        name: '<at user_id="all">everyone</at>',
        environment: {},
        summary: {
          total: 0,
          completed: 0,
          passed: 0,
          failed: 0,
          timeout: 0,
          errors: 0,
          elapsedMs: 0,
        },
        reportURL: 'http://localhost',
      },
      '12345',
      '',
    );
    expect(JSON.parse(body).content.text).not.toContain('<at');
  });
});
