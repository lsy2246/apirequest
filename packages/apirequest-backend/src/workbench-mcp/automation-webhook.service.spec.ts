import { createHmac } from 'node:crypto';
import {
  AutomationWebhookService,
  automationWebhookPayload,
} from './automation-webhook.service';

jest.mock('src/utils', () => ({
  encrypt: (value: string) => value,
  decrypt: (value: string) => value,
}));
jest.mock('src/prisma/prisma.service', () => ({ PrismaService: class {} }));

const id = 'cb67784b-64b8-4373-a5f1-a73384187bd1';
const report = () => ({
  id,
  kind: 'automation',
  name: 'Mixed results',
  createdAt: new Date().toISOString(),
  environmentName: 'Staging',
  summary: { completed: 3, failed: 2, elapsedMs: 1234.5 },
  automation: {
    status: 'completed',
    totalRequests: 3,
    passedTests: 1,
    failedTests: 1,
    totalTests: 2,
  },
  steps: [
    {
      name: 'Expected unauthorized',
      passed: true,
      statusCode: 401,
      errors: [],
    },
    {
      name: 'Wrong status',
      passed: false,
      errors: [],
      assertions: [
        {
          descriptor: 'status',
          passed: 0,
          failed: 1,
          expectResults: [
            { status: 'fail', message: 'Expected 200, received 500' },
          ],
        },
      ],
      response: { body: 'PRIVATE_RESPONSE' },
    },
    {
      name: 'Slow request',
      passed: false,
      errors: ['CASE_TIMEOUT'],
      errorDetails: [
        {
          code: 'CASE_TIMEOUT',
          data: { message: 'Exceeded 250 ms', stack: 'PRIVATE_STACK' },
        },
      ],
    },
  ],
});
function fixture() {
  const rows = new Map<string, any>();
  const db: any = {
    findFirst: jest.fn(
      async ({ where }) =>
        [...rows.values()].find((row) =>
          Object.entries(where).every(([key, value]) => row[key] === value),
        ) ?? null,
    ),
    findMany: jest.fn(async ({ where }) =>
      [...rows.values()].filter((row) =>
        Object.entries(where).every(([key, value]) => row[key] === value),
      ),
    ),
    upsert: jest.fn(async ({ where, create, update }) => {
      rows.set(
        where.id,
        rows.has(where.id) ? { ...rows.get(where.id), ...update } : create,
      );
    }),
    create: jest.fn(async ({ data }) => {
      if (rows.has(data.id)) throw { code: 'P2002' };
      rows.set(data.id, data);
      return data;
    }),
    updateMany: jest.fn(async ({ where, data }) => {
      rows.set(where.id, { ...rows.get(where.id), ...data });
      return { count: 1 };
    }),
  };
  db.deleteMany = jest.fn(async ({ where }) => {
    const row = rows.get(where.id);
    if (row && row.ownerUid === where.ownerUid) rows.delete(where.id);
    return { count: row ? 1 : 0 };
  });
  const service = new AutomationWebhookService(
    { workbenchConfig: db } as any,
    { get: () => ({ siteURL: 'http://127.0.0.1:3000' }) } as any,
  );
  const fetchMock = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(null, { status: 204 }));
  const configure = () =>
    service.save('owner', {
      url: 'http://127.0.0.1:3190/hook',
      secret: 'SIGNING_SECRET',
      reportBaseURL: 'http://127.0.0.1:3000',
    });
  return { service, rows, db, fetchMock, configure };
}
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('automation Webhooks', () => {
  it('reports mixed outcomes by assertions and separates timeout counts', () => {
    const payload = automationWebhookPayload(
      report(),
      false,
      'http://127.0.0.1:3000',
    ) as any;
    expect(payload.summary).toMatchObject({
      completed: 3,
      passed: 1,
      failed: 1,
      timeout: 1,
      elapsedMs: 1235,
    });
    expect(payload.status).toBe('failed');
    expect(payload.reportURL).toBe(
      `http://127.0.0.1:3000/automation?report=${id}`,
    );
    expect(payload).not.toHaveProperty('failures');
  });
  it('includes only failed case details without raw responses or stack traces', () => {
    const payload = automationWebhookPayload(
      report(),
      true,
      'http://127.0.0.1:3000',
    ) as any;
    expect(payload.failures).toHaveLength(2);
    expect(payload.failures[0].assertions[0].messages).toEqual([
      'Expected 200, received 500',
    ]);
    expect(payload.failures[1].type).toBe('timeout');
    expect(JSON.stringify(payload)).not.toMatch(
      /PRIVATE_RESPONSE|PRIVATE_STACK/,
    );
    const passed = report();
    passed.steps = [passed.steps[0]];
    expect(
      automationWebhookPayload(passed, true, 'http://127.0.0.1:3000'),
    ).not.toHaveProperty('failures');
  });
  it('preserves an unchanged signing secret and never returns it to the browser', async () => {
    const { service, configure } = fixture();
    expect(await configure()).toEqual({
      url: 'http://127.0.0.1:3190/hook',
      reportBaseURL: 'http://127.0.0.1:3000/',
      hasSecret: true,
      format: 'json',
    });
    await service.save('owner', {
      url: '',
      reportBaseURL: 'http://127.0.0.1:3000',
    });
    expect((await service.get('owner')).hasSecret).toBe(true);
    await service.save('owner', {
      url: '',
      reportBaseURL: 'http://127.0.0.1:3000',
      secret: '',
    });
    expect((await service.get('owner')).hasSecret).toBe(false);
    expect((await service.get('another-owner')).url).toBe('');
  });
  it.each([
    'file:///tmp/hook',
    'https://user:password@example.com',
    'https://example.com/#token',
  ])('rejects an invalid destination: %s', async (url) => {
    const { service, db } = fixture();
    await expect(
      service.save('owner', { url, reportBaseURL: 'http://localhost:3000' }),
    ).rejects.toThrow();
    expect(db.upsert).not.toHaveBeenCalled();
  });
  it('signs the exact JSON body and sends only once for a completed report', async () => {
    const { service, fetchMock, configure } = fixture();
    await configure();
    await service.notify('owner', report(), {
      enabled: true,
      includeErrorDetails: true,
    });
    await service.notify('owner', report(), {
      enabled: true,
      includeErrorDetails: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0][1] as any;
    expect(request.headers['X-APIRequest-Event-ID']).toBe(id);
    const signature = createHmac('sha256', 'SIGNING_SECRET')
      .update(`${request.headers['X-APIRequest-Timestamp']}.${request.body}`)
      .digest('hex');
    expect(request.headers['X-APIRequest-Signature']).toBe(
      `sha256=${signature}`,
    );
    expect((await service.deliveries('owner')).get(id)).toMatchObject({
      status: 'sent',
      attempts: 1,
    });
  });
  it('retries transient failures with the same event ID and payload', async () => {
    jest.useFakeTimers();
    const { service, fetchMock, configure } = fixture();
    await configure();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const pending = service.notify('owner', report(), {
      enabled: true,
      includeErrorDetails: false,
    });
    await jest.runAllTimersAsync();
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      fetchMock.mock.calls[1][1]?.body,
    );
    expect((await service.deliveries('owner')).get(id)).toMatchObject({
      status: 'sent',
      attempts: 2,
    });
  });
  it('records a permanent delivery failure without failing the test run', async () => {
    const { service, fetchMock, configure } = fixture();
    await configure();
    fetchMock.mockResolvedValue(new Response(null, { status: 400 }));
    await expect(
      service.notify('owner', report(), {
        enabled: true,
        includeErrorDetails: false,
      }),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await service.deliveries('owner')).get(id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      error: 'Webhook HTTP 400',
    });
  });
  it('does not send or read settings for an opted-out plan', async () => {
    const { service, db, fetchMock } = fixture();
    await service.notify('owner', report(), {
      enabled: false,
      includeErrorDetails: true,
    });
    expect(db.create).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('stores only completed browser reports and strips raw response data', async () => {
    const { service, rows, configure } = fixture();
    await configure();
    await expect(
      service.manual('owner', {
        webhook: { enabled: true },
        report: {
          ...report(),
          automation: { ...report().automation, status: 'running' },
        },
      }),
    ).rejects.toThrow();
    await service.manual('owner', {
      webhook: { enabled: true, includeErrorDetails: true },
      report: report(),
    });
    expect(rows.get(id).value).not.toContain('PRIVATE_RESPONSE');
    expect(JSON.parse(rows.get(id).value).steps).toHaveLength(3);
  });
});

describe('Feishu bot delivery', () => {
  const url =
    'https://open.feishu.cn/open-apis/bot/v2/hook/example-private-token';
  const setup = async () => {
    const f = fixture();
    await f.service.save('owner', {
      url,
      format: 'feishu',
      reportBaseURL: 'http://127.0.0.1:3000',
      secret: '',
    });
    return f;
  };
  it('uses the Feishu text-message contract for the test button', async () => {
    const { service, fetchMock } = await setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 0, msg: 'success' })),
    );
    await expect(service.test('owner')).resolves.toEqual({ sent: true });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toEqual({
      msg_type: 'text',
      content: { text: expect.stringContaining('APIRequest Webhook 测试通知') },
    });
  });
  it('rejects HTTP 200 when Feishu returns the exact missing-msg_type error', async () => {
    const { service, fetchMock } = await setup();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 19002,
          msg: 'params error, msg_type need',
          data: {},
        }),
        { status: 200 },
      ),
    );
    await expect(service.test('owner')).rejects.toThrow(
      '飞书机器人拒收（19002）：params error, msg_type need',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('records a robot business error as failure without retrying a rejected message', async () => {
    const { service, fetchMock } = await setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 19024, msg: 'Key Words Not Found' })),
    );
    await service.notify('owner', report(), {
      enabled: true,
      includeErrorDetails: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await service.deliveries('owner')).get(id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      error: '飞书机器人拒收（19024）：Key Words Not Found',
    });
  });
  it('renders mixed results, assertion details, and the report link as readable text', async () => {
    const { service, fetchMock } = await setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 0, msg: 'success' })),
    );
    await service.notify('owner', report(), {
      enabled: true,
      includeErrorDetails: true,
    });
    const text = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).content
      .text;
    expect(text).toContain('成功 1 · 失败 1 · 超时 1');
    expect(text).toContain('Expected 200, received 500');
    expect(text).toContain('Exceeded 250 ms');
    expect(text).toContain(`/automation?report=${id}`);
    expect(text).not.toMatch(/PRIVATE_RESPONSE|PRIVATE_STACK/);
    expect((await service.deliveries('owner')).get(id)?.status).toBe('sent');
  });
  it('omits error details in the summary-only mode', async () => {
    const { service, fetchMock } = await setup();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 0 })));
    await service.notify('owner', report(), {
      enabled: true,
      includeErrorDetails: false,
    });
    const text = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).content
      .text;
    expect(text).toContain('成功 1 · 失败 1 · 超时 1');
    expect(text).not.toContain('失败详情');
    expect(text).not.toContain('Expected 200');
  });
  it('uses the Feishu body signature when bot signature verification is enabled', async () => {
    const { service, fetchMock } = await setup();
    await service.save('owner', {
      url,
      reportBaseURL: 'http://127.0.0.1:3000',
      secret: 'feishu-secret',
    });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 0 })));
    await service.test('owner');
    const request = fetchMock.mock.calls[0][1] as any;
    const body = JSON.parse(request.body);
    expect(body.sign).toBe(
      createHmac('sha256', `${body.timestamp}\nfeishu-secret`)
        .update('')
        .digest('base64'),
    );
    expect(request.headers).not.toHaveProperty('X-APIRequest-Signature');
  });
  it.each(['not-json', '{}', 'null'])(
    'does not claim delivery success for invalid acknowledgements: %s',
    async (body) => {
      const { service, fetchMock } = await setup();
      fetchMock.mockResolvedValue(new Response(body));
      await expect(service.test('owner')).rejects.toThrow(
        '无法确认消息是否送达',
      );
    },
  );
  it('redacts the private Webhook token in a reflected error message', async () => {
    const { service, fetchMock } = await setup();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 1,
          msg: `Invalid ${url} example-private-token`,
        }),
      ),
    );
    await expect(service.test('owner')).rejects.toThrow(
      '飞书机器人拒收（1）：Invalid [已隐藏] [已隐藏]',
    );
  });
});

describe('explicit notification format', () => {
  it('keeps a legacy Feishu configuration working without requiring another save', async () => {
    const { service, rows, fetchMock } = fixture();
    rows.set('old-settings', {
      id: 'old-settings',
      ownerUid: 'owner',
      kind: 'automation_webhook_settings',
      value: JSON.stringify({
        url: 'https://open.feishu.cn/open-apis/bot/v2/hook/legacy',
        secret: '',
        reportBaseURL: 'http://localhost:3000',
      }),
    });
    expect((await service.get('owner')).format).toBe('feishu');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 0 })));
    await service.test('owner');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).msg_type).toBe(
      'text',
    );
  });
  it('respects Webhook format even when the URL belongs to Feishu', async () => {
    const { service, fetchMock } = fixture();
    await service.save('owner', {
      url: 'https://open.feishu.cn/open-apis/bot/v2/hook/example',
      secret: '',
      reportBaseURL: 'http://localhost:3000',
      format: 'json',
    });
    await service.test('owner');
    expect((await service.get('owner')).format).toBe('json');
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.event).toBe('automation.webhook_test');
    expect(body).not.toHaveProperty('msg_type');
  });
  it('supports Feishu format at a custom relay address and preserves format on partial saves', async () => {
    const { service, fetchMock } = fixture();
    const input = {
      url: 'http://localhost:3190/relay',
      reportBaseURL: 'http://localhost:3000',
    };
    await service.save('owner', { ...input, format: 'feishu' });
    await service.save('owner', input);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 0 })));
    await service.test('owner');
    expect((await service.get('owner')).format).toBe('feishu');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).msg_type).toBe(
      'text',
    );
  });
  it.each(['auto', '', null, ['json']])(
    'rejects an unsupported explicit format: %j',
    async (format) => {
      const { service, db } = fixture();
      await expect(
        service.save('owner', {
          url: 'http://localhost/hook',
          reportBaseURL: 'http://localhost:3000',
          format,
        }),
      ).rejects.toThrow('Invalid notification format');
      expect(db.upsert).not.toHaveBeenCalled();
    },
  );
});

describe('multiple notification channels', () => {
  it('sends independently to selected channels and records partial failures without resending successful channels', async () => {
    const { service, fetchMock } = fixture();
    const a = await service.saveChannel('owner', {
      name: 'Success',
      url: 'http://localhost/success',
      format: 'json',
    });
    const b = await service.saveChannel('owner', {
      name: 'Rejected',
      url: 'http://localhost/rejected',
      format: 'json',
    });
    await service.saveChannel('owner', {
      name: 'Unselected',
      url: 'http://localhost/unselected',
      format: 'json',
    });
    fetchMock.mockImplementation(
      async (url) =>
        new Response(null, {
          status: String(url).endsWith('rejected') ? 400 : 204,
        }),
    );
    const options = {
      enabled: true,
      includeErrorDetails: true,
      channelIDs: [a.id, b.id, a.id],
    };
    await service.notify('owner', report(), options);
    await service.notify('owner', report(), options);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const delivery = (await service.deliveries('owner')).get(id)!;
    expect(delivery.status).toBe('partial');
    expect(delivery.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelID: a.id,
          status: 'sent',
          attempts: 1,
        }),
        expect.objectContaining({
          channelID: b.id,
          status: 'failed',
          attempts: 1,
        }),
      ]),
    );
  });
  it("does not expose stored signing secrets or access another owner's channels", async () => {
    const { service, fetchMock } = fixture();
    const channel = await service.saveChannel('other-owner', {
      name: 'Private',
      format: 'json',
      url: 'http://localhost/private',
      secret: 'private-secret',
    });
    expect(await service.channels('owner')).toEqual([]);
    expect((await service.channels('other-owner'))[0]).toMatchObject({
      hasSecret: true,
    });
    expect(JSON.stringify(await service.channels('other-owner'))).not.toContain(
      'private-secret',
    );
    await expect(
      service.saveChannel('owner', { name: 'Changed' }, channel.id),
    ).rejects.toThrow('Notification channel not found');
    await expect(service.deleteChannel('owner', channel.id)).rejects.toThrow(
      'Notification channel not found',
    );
    await service.notify('owner', report(), {
      enabled: true,
      includeErrorDetails: false,
      channelIDs: [channel.id],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await service.deliveries('owner')).get(id)?.status).toBe('failed');
  });
  it('uses only the previous default channel for legacy plans and does not recreate a deleted default', async () => {
    const { service, configure, fetchMock } = fixture();
    await configure();
    const legacy = (await service.channels('owner'))[0];
    expect(legacy.legacy).toBe(true);
    await service.saveChannel('owner', {
      name: 'New channel',
      format: 'json',
      url: 'http://localhost/new',
    });
    await service.notify('owner', report(), {
      enabled: true,
      includeErrorDetails: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:3190/hook');
    await service.deleteChannel('owner', legacy.id);
    expect(
      (await service.channels('owner')).some((channel) => channel.legacy),
    ).toBe(false);
  });
  it('preserves unchanged secrets on edit and skips globally disabled channels', async () => {
    const { service, fetchMock } = fixture();
    const channel = await service.saveChannel('owner', {
      name: 'Paused',
      format: 'json',
      url: 'http://localhost/hook',
      secret: 'saved-key',
    });
    await service.saveChannel('owner', { enabled: false }, channel.id);
    expect((await service.channels('owner'))[0].hasSecret).toBe(true);
    await service.notify('owner', report(), {
      enabled: true,
      includeErrorDetails: false,
      channelIDs: [channel.id],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await service.deliveries('owner')).get(id)?.status).toBe('skipped');
  });
});
