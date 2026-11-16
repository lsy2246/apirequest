import { createServer } from 'node:http';
import express from 'express';
import request from 'supertest';
import { parseMockRules, normalizeIncoming, explainMock } from './mock-engine';
import {
  runMockScript,
  resolveMockAction,
  scopedMockCookies,
} from './mock-actions';
import { MockServerController } from './mock-server.controller';
const rule = (change: any = {}) => ({
  id: 'advanced-rule',
  name: 'Advanced',
  enabled: true,
  method: 'POST',
  path: '/orders/:id',
  conditions: [],
  exhausted: 'repeat_last',
  steps: [
    {
      action: 'http',
      statusCode: 200,
      body: 'ok',
      headers: {},
      times: 1,
      delayMs: 0,
      intervalMs: 0,
      disconnectAfter: false,
    },
  ],
  ...change,
});
const incoming = (body: unknown = {}, secure = false) =>
  normalizeIncoming({ method: 'POST', path: '/orders/7', body, secure });
const matches = (condition: any, body: unknown) =>
  !!explainMock(
    {
      revision: 0,
      rules: parseMockRules([
        rule({ conditions: [{ source: 'body', ...condition }] }),
      ]),
      hits: {},
    },
    incoming(body),
  ).selection;
describe('Advanced Mock capabilities', () => {
  it('matches JSON Schema references, unions, arrays and formats', () => {
    const condition = {
      operator: 'json_schema',
      key: '$',
      value: JSON.stringify({
        type: 'object',
        required: ['items', 'email'],
        properties: {
          email: { type: 'string', format: 'email' },
          items: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/item' },
          },
        },
        $defs: {
          item: {
            oneOf: [
              { type: 'number', minimum: 5 },
              { type: 'string', enum: ['free'] },
            ],
          },
        },
      }),
    };
    expect(
      matches(condition, { email: 'dev@example.com', items: [10, 'free'] }),
    ).toBe(true);
    expect(matches(condition, { email: 'invalid', items: [10] })).toBe(false);
    expect(matches(condition, { email: 'dev@example.com', items: [2] })).toBe(
      false,
    );
  });
  it('queries JSONPath with filters and recursive descent', () => {
    expect(
      matches(
        {
          operator: 'jsonpath',
          key: '$..items[?(@.price > 10)].id',
          value: 'premium',
        },
        {
          order: {
            items: [
              { id: 'basic', price: 5 },
              { id: 'premium', price: 20 },
            ],
          },
        },
      ),
    ).toBe(true);
    expect(
      matches(
        { operator: 'jsonpath', key: '$.missing[*]', value: '' },
        { items: [] },
      ),
    ).toBe(false);
  });
  it('queries namespace-aware XML, attributes, scalars and booleans', () => {
    const xml =
      '<o:orders xmlns:o="urn:orders"><o:order id="7">paid</o:order></o:orders>';
    expect(
      matches(
        {
          operator: 'xpath',
          key: '/o:orders/o:order/@id',
          value: '7',
          namespaces: { o: 'urn:orders' },
        },
        xml,
      ),
    ).toBe(true);
    expect(
      matches(
        {
          operator: 'xpath',
          key: 'count(//*[local-name()="order"])',
          value: '1',
        },
        xml,
      ),
    ).toBe(true);
    expect(
      matches({ operator: 'xpath', key: 'boolean(//missing)', value: '' }, xml),
    ).toBe(false);
    expect(
      matches(
        { operator: 'xpath', key: '/*', value: '' },
        '<!DOCTYPE root [<!ENTITY x SYSTEM "file:///etc/passwd">]><root>&x;</root>',
      ),
    ).toBe(false);
  });
  it('separates HTTP and HTTPS matches', () => {
    const state = {
      revision: 0,
      rules: parseMockRules([rule({ secure: true })]),
      hits: {},
    };
    expect(
      explainMock(state, incoming({}, false)).trace[0].reasons,
    ).toContainEqual({ code: 'secure', actual: false, expected: true });
    expect(explainMock(state, incoming({}, true)).selection).not.toBeNull();
  });
  it('executes loops, branching and custom functions without host access', async () => {
    const code =
      'function price(items){let n=0;for(const item of items)n+=item.price*item.quantity;return n;} const total=price(request.body.items);return {statusCode:total>10?201:200,body:{id:request.params.id,total,host:typeof process,require:typeof require}};';
    const value = await runMockScript(
      code,
      incoming({ items: [{ price: 7, quantity: 3 }] }),
      { id: '7' },
    );
    expect(value).toEqual({
      statusCode: 201,
      body: { id: '7', total: 21, host: 'undefined', require: 'undefined' },
    });
    await expect(
      runMockScript('while(true){}', incoming(), {}, 20),
    ).rejects.toThrow();
    await expect(
      runMockScript('throw new Error("script failed")', incoming(), {}),
    ).rejects.toThrow('script failed');
    expect(
      await runMockScript('return typeof savedGlobal', incoming(), {}),
    ).toBe('undefined');
  });
  it('serves script responses and multiple scoped Set-Cookie headers over HTTP', async () => {
    const rules = parseMockRules([
      rule({
        steps: [
          {
            action: 'script',
            script: {
              code: 'return {statusCode:201,body:{id:request.params.id},cookies:["session=new; HttpOnly; SameSite=Lax","old=; Max-Age=0; Path=/"]}',
              timeoutMs: 1000,
            },
            headers: {},
            times: 1,
            delayMs: 0,
          },
        ],
      }),
    ]);
    const controller = new MockServerController(
      {} as any,
      {
        match: async (_id: string, input: any) => ({
          ...explainMock({ revision: 0, rules, hits: {} }, input).selection,
          options: {},
          trace: [],
        }),
      } as any,
    );
    const app = express();
    app.use(express.json());
    app.use((req, res) => {
      Object.assign(req, {
        mockServerId: 'server',
        mockServer: { subdomain: 'server', ruleSet: {}, delayInMs: 0 },
      });
      void controller.handleMockRequest(req, res);
    });
    const result = await request(app).post('/mock/server/orders/7').send({});
    expect(result.status).toBe(201);
    expect(result.body).toEqual({ id: '7' });
    expect(result.headers['set-cookie']).toEqual([
      'session=new; HttpOnly; SameSite=Lax; Path=/mock/server',
      'old=; Max-Age=0; Path=/mock/server',
    ]);
  });
  it('calls an external HTTP callback with context and validates its response', async () => {
    const received: any[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        received.push({
          headers: req.headers,
          body: JSON.parse(Buffer.concat(chunks).toString()),
        });
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            statusCode: 202,
            body: { received: true },
            cookies: ['login=yes; Secure'],
          }),
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const port = (server.address() as any).port;
      const step = parseMockRules([
        rule({
          steps: [
            {
              action: 'callback',
              callback: {
                url: `http://127.0.0.1:${port}`,
                headers: { 'x-callback-key': 'local-test' },
                timeoutMs: 1000,
              },
              headers: {},
              times: 1,
              delayMs: 0,
            },
          ],
        }),
      ])[0].steps[0];
      const result = await resolveMockAction(step, incoming({ amount: 5 }), {
        id: '7',
      });
      expect(result.statusCode).toBe(202);
      expect(JSON.parse(result.body)).toEqual({ received: true });
      expect(received[0]).toMatchObject({
        headers: { 'x-callback-key': 'local-test' },
        body: { params: { id: '7' }, body: { amount: 5 } },
      });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
  it('rejects cookie header injection and keeps a Mock cookie inside its own path', () => {
    expect(() =>
      parseMockRules([
        rule({
          steps: [
            {
              action: 'http',
              statusCode: 200,
              body: '',
              headers: {},
              cookies: ['session=x\r\nX-Evil: yes'],
              times: 1,
              delayMs: 0,
            },
          ],
        }),
      ]),
    ).toThrow();
    expect(
      scopedMockCookies(
        ['access_token=demo; Path=/; Domain=example.com; HttpOnly'],
        '/mock/server',
      ),
    ).toEqual(['access_token=demo; HttpOnly; Path=/mock/server']);
  });
  it('reports script execution errors as failed Mock actions', async () => {
    const rules = parseMockRules([
      rule({
        steps: [
          {
            action: 'script',
            script: {
              code: 'throw new Error("script failed")',
              timeoutMs: 1000,
            },
            headers: {},
            times: 1,
            delayMs: 0,
          },
        ],
      }),
    ]);
    const controller = new MockServerController(
      {} as any,
      {
        match: async (_id: string, input: any) => ({
          ...explainMock({ revision: 0, rules, hits: {} }, input).selection,
          options: {},
          trace: [],
        }),
      } as any,
    );
    const app = express();
    app.use((req, res) => {
      Object.assign(req, {
        mockServerId: 'server',
        mockServer: { subdomain: 'server', ruleSet: {}, delayInMs: 0 },
      });
      void controller.handleMockRequest(req, res);
    });
    const result = await request(app).post('/mock/server/orders/7');
    expect(result.status).toBe(502);
    expect(result.body.message).toContain('script failed');
  });
  it('rejects callback timeouts, invalid JSON and unsuccessful status codes', async () => {
    const server = createServer((req, res) => {
      req.resume();
      if (req.url === '/slow') return;
      res.statusCode = req.url === '/error' ? 503 : 200;
      res.end('invalid JSON');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as any).port;
    try {
      for (const [path, error] of [
        ['/slow', 'timed out'],
        ['/json', 'must return JSON'],
        ['/error', '503'],
      ]) {
        const step = parseMockRules([
          rule({
            steps: [
              {
                action: 'callback',
                callback: {
                  url: `http://127.0.0.1:${port}${path}`,
                  headers: {},
                  timeoutMs: 100,
                },
                headers: {},
                times: 1,
                delayMs: 0,
              },
            ],
          }),
        ])[0].steps[0];
        await expect(resolveMockAction(step, incoming(), {})).rejects.toThrow(
          error,
        );
      }
      const parsed = parseMockRules([
        rule({
          steps: [
            {
              action: 'http',
              statusCode: 200,
              body: '',
              headers: {
                'Set-Cookie': [
                  'a=1; Expires=Wed, 21 Oct 2030 07:28:00 GMT',
                  'b=; Max-Age=0',
                ],
              },
              times: 1,
              delayMs: 0,
            },
          ],
        }),
      ])[0];
      expect(parsed.steps[0].cookies).toHaveLength(2);
      expect(parsed.steps[0].headers['set-cookie']).toBeUndefined();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
  it('does not serve removed collection-example Mock endpoints', async () => {
    const match = jest.fn();
    const controller = new MockServerController({} as any, { match } as any);
    const app = express();
    app.use((req, res) => {
      Object.assign(req, {
        mockServerId: 'old-example',
        mockServer: {
          subdomain: 'old-example',
          collectionID: 'old-collection',
          ruleSet: {},
          delayInMs: 0,
        },
      });
      void controller.handleMockRequest(req, res);
    });
    expect((await request(app).get('/mock/old-example/orders')).status).toBe(
      404,
    );
    expect(match).not.toHaveBeenCalled();
  });
});
