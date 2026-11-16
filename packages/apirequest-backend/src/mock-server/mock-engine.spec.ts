import { mockRequestHeaders } from './mock-headers';
import { gzipSync } from 'node:zlib';
import {
  parseMockRules,
  normalizeIncoming,
  explainMock,
  advanceMock,
  renderStep,
  ruleFromLog,
  parseOptions,
} from './mock-engine';
const make = (id = 'rule-0001', patch: any = {}) => ({
  id,
  name: id,
  enabled: true,
  method: 'GET',
  path: '/users/:id',
  conditions: [],
  exhausted: 'repeat_last',
  steps: [
    {
      action: 'http',
      statusCode: 200,
      body: '{}',
      headers: {},
      times: 1,
      delayMs: 0,
      intervalMs: 0,
    },
  ],
  ...patch,
});
const state = (rules: any[]) => ({
  revision: 0,
  rules: parseMockRules(rules),
  hits: {},
  states: {},
});
const request = (patch: any = {}) =>
  normalizeIncoming({
    method: 'GET',
    path: '/users/10',
    headers: {},
    ...patch,
  });
describe('Mock workflows', () => {
  it('distinguishes an empty request from a JSON null body in preview and templates', () => {
    const blank = normalizeIncoming({ path: '/', body: null, rawBody: '' });
    const nil = normalizeIncoming({ path: '/', body: null, rawBody: 'null' });
    const step = {
      action: 'http',
      template: true,
      body: '{"value":"{{body}}"}',
      headers: {},
    } as any;
    expect(JSON.parse(renderStep(step, blank, {}).body).value).toBe('');
    expect(JSON.parse(renderStep(step, nil, {}).body).value).toBeNull();
  });
  it('keeps upstream cookies while removing local workbench session credentials', () => {
    const token =
      'header.' +
      Buffer.from(JSON.stringify({ sub: 'workbench-local-owner-v1' })).toString(
        'base64url',
      ) +
      '.signature';
    expect(
      mockRequestHeaders({
        cookie: `access_token=${token}; session=upstream; refresh_token=${token}`,
      }),
    ).toEqual({ cookie: 'session=upstream' });
    expect(
      mockRequestHeaders({
        cookie: 'access_token=upstream-token; session=api',
      }),
    ).toEqual({ cookie: 'access_token=upstream-token; session=api' });
  });

  it('explains priority, expired rules and shadowing without consuming progress', () => {
    const s = state([
      make(),
      make('rule-0002', { priority: 20 }),
      make('rule-0003', { priority: 30, expiresAt: '2020-01-01T00:00:00Z' }),
    ]);
    const result = explainMock(s, request());
    expect(result.selection?.rule.id).toBe('rule-0002');
    expect(result.trace[0].reasons[0].code).toBe('expired');
    expect(result.trace[2].reasons[0].code).toBe('shadowed');
    expect(s.hits).toEqual({});
  });
  it('shares scenario state across endpoints and respects exhausted steps', () => {
    const s = state([
      make('rule-0001', {
        path: '/login',
        scenario: {
          name: 'session',
          requiredState: 'STARTED',
          nextState: 'authenticated',
        },
        exhausted: 'fallthrough',
      }),
      make('rule-0002', {
        scenario: {
          name: 'session',
          requiredState: 'authenticated',
          nextState: '',
        },
      }),
    ]);
    expect(explainMock(s, request()).selection).toBeNull();
    const login = explainMock(s, request({ path: '/login' })).selection!;
    advanceMock(s, login);
    expect(explainMock(s, request()).selection?.rule.id).toBe('rule-0002');
    expect(
      explainMock(s, request({ path: '/login' })).trace[0].reasons.map(
        (r) => r.code,
      ),
    ).toContain('exhausted');
  });
  it('loops response steps and falls through only after the configured times', () => {
    const first = make('rule-0001', {
      exhausted: 'loop',
      steps: [
        {
          action: 'http',
          statusCode: 503,
          body: 'retry',
          headers: {},
          times: 2,
          delayMs: 0,
        },
        {
          action: 'http',
          statusCode: 200,
          body: 'ok',
          headers: {},
          times: 1,
          delayMs: 0,
        },
      ],
    });
    const s = state([first]);
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const selected = explainMock(s, request()).selection!;
      statuses.push(selected.step.statusCode);
      advanceMock(s, selected);
    }
    expect(statuses).toEqual([503, 503, 200, 503, 503, 200]);
  });
  it('matches nested JSON, arrays, cookies, wildcards and comparison operators', () => {
    const s = state([
      make('rule-0001', {
        path: '/users/**',
        pathMode: 'glob',
        conditions: [
          {
            source: 'body',
            key: '$',
            operator: 'json_contains',
            value: '{"users":[{"role":"admin"}]}',
          },
          { source: 'query', key: 'tag', operator: 'contains', value: 'blue' },
          { source: 'cookie', key: 'session', operator: 'exists', value: '' },
          { source: 'header', key: 'x-count', operator: 'gte', value: '10' },
        ],
      }),
    ]);
    expect(
      explainMock(
        s,
        request({
          path: '/users/a/b?tag=red&tag=blue',
          headers: { Cookie: 'session=abc', 'X-Count': '11' },
          body: { users: [{ id: 1, role: 'admin' }] },
        }),
      ).selection,
    ).not.toBeNull();
  });
  it('renders safe JSON values, typed placeholders and stable repeated generated values', () => {
    const s = state([
      make('rule-0001', {
        steps: [
          {
            action: 'http',
            statusCode: 200,
            body: '{"id":"{{path.id}}","name":"{{body.name}}","active":"{{body.active}}","data":"{{body.data}}","a":"{{uuid}}","b":"{{uuid}}"}',
            headers: { 'x-request-id': '{{query.id}}' },
            times: 1,
            delayMs: 0,
            template: true,
          },
        ],
      }),
    ]);
    const req = request({
      path: '/users/10?id=abc',
      body: { name: 'a"\nb', active: false, data: { nested: 1 } },
    });
    const selected = explainMock(s, req).selection!;
    const result = renderStep(selected.step, req, selected.params);
    const body = JSON.parse(result.body);
    expect(body).toMatchObject({
      id: '10',
      name: 'a"\nb',
      active: false,
      data: { nested: 1 },
    });
    expect(body.a).toBe(body.b);
    expect(result.headers['x-request-id']).toBe('abc');
  });
  it('keeps HTTP and WebSocket rules for the same path separate', () => {
    const s = state([
      make(),
      make('rule-0002', {
        steps: [
          {
            action: 'websocket',
            websocket: {
              messages: ['hello'],
              matchers: [
                { operator: 'equals', value: 'ping', replies: ['pong'] },
              ],
              closeCode: 1000,
            },
            headers: {},
            times: 1,
            delayMs: 0,
            intervalMs: 0,
          },
        ],
      }),
    ]);
    expect(explainMock(s, request()).selection?.rule.id).toBe('rule-0001');
    expect(
      explainMock(s, request({ protocol: 'websocket' })).selection?.rule.id,
    ).toBe('rule-0002');
  });
  it('rejects unsafe patterns, malformed upstream URLs and invalid headers', () => {
    expect(() =>
      parseMockRules([
        make('rule-0001', { pathMode: 'regex', path: '/(a+)+$' }),
      ]),
    ).toThrow();
    expect(() =>
      parseOptions({ fallback: { url: 'file:///etc/passwd' } }),
    ).toThrow();
    expect(() =>
      parseOptions({ fallback: { url: 'http://user:password@localhost' } }),
    ).toThrow();
    expect(() =>
      parseOptions({
        fallback: { url: 'http://localhost', headers: { 'x-test': 'a\r\nb' } },
      }),
    ).toThrow();
  });
  it('decodes compressed recordings before creating a reusable rule', () => {
    const rule = ruleFromLog({
      requestMethod: 'GET',
      requestPath: '/compressed',
      responseStatus: 200,
      responseHeaders: {
        'content-type': 'text/plain',
        'content-encoding': 'gzip',
      },
      responseBody: {
        encoding: 'base64',
        data: gzipSync('hello').toString('base64'),
      },
    });
    expect(rule.steps[0].body).toBe('hello');
    expect(rule.steps[0].headers['content-encoding']).toBeUndefined();
  });
  it('creates binary response rules and refuses incomplete recordings', () => {
    const record = {
      requestMethod: 'GET',
      requestPath: '/download',
      responseStatus: 200,
      responseHeaders: {
        'content-type': 'application/octet-stream',
        connection: 'keep-alive',
      },
      responseBody: { encoding: 'base64', data: 'AAECAw==' },
    };
    const rule = ruleFromLog(record);
    expect(rule.steps[0].file?.data).toBe('AAECAw==');
    expect(rule.steps[0].headers.connection).toBeUndefined();
    expect(() =>
      ruleFromLog({ ...record, mockMatch: { bodyTruncated: true } }),
    ).toThrow();
  });
});
