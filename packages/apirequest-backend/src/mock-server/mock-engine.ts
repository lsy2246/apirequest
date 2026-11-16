import {
  matchStructure,
  validateStructure,
  structureOperators,
} from './mock-structure';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { validateHeaderName, validateHeaderValue } from 'node:http';
const excludedHeaders = new Set([
  'connection',
  'content-length',
  'transfer-encoding',
  'upgrade',
  'keep-alive',
  'trailer',
  'proxy-connection',
  'set-cookie',
  'content-disposition',
  'content-security-policy',
  'x-content-type-options',
  'x-frame-options',
]);

export type Condition = {
  source: 'query' | 'header' | 'body' | 'cookie';
  operator?:
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'regex'
    | 'exists'
    | 'absent'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'json_contains'
    | 'json_schema'
    | 'jsonpath'
    | 'xpath';
  namespaces?: Record<string, string>;
  key: string;
  value: string;
};
export type Step = {
  action:
    | 'http'
    | 'disconnect'
    | 'sse'
    | 'file'
    | 'forward'
    | 'websocket'
    | 'script'
    | 'callback';
  cookies?: string[];
  script?: { code: string; timeoutMs: number };
  callback?: {
    url: string;
    headers: Record<string, string>;
    timeoutMs: number;
  };
  template?: boolean;
  forward?: ForwardConfig;
  websocket?: WebSocketConfig;
  intervalMs: number;
  disconnectAfter: boolean;
  times: number;
  statusCode: number;
  delayMs: number | null;
  headers: Record<string, string>;
  body: string;
  file?: MockResponseFile;
};
export type MockResponseFile = {
  name: string;
  contentType: string;
  data: string;
  disposition: 'inline' | 'attachment';
};

export const MAX_MOCK_FILE_BYTES = 10 * 1024 * 1024;
const MAX_MOCK_FILES_BYTES = 20 * 1024 * 1024;
export type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  method: string;
  path: string;
  secure?: boolean | null;
  pathMode?: 'template' | 'exact' | 'glob' | 'regex';
  priority?: number;
  expiresAt?: string | null;
  scenario?: { name: string; requiredState: string; nextState: string };
  conditions: Condition[];
  steps: Step[];
  exhausted: 'repeat_last' | 'loop' | 'fallthrough';
};
export type RuleSet = {
  kind?: 'single' | 'collection';
  revision: number;
  rules: Rule[];
  hits: Record<string, number>;
  states?: Record<string, string>;
  options?: { fallback?: ForwardConfig; recording?: boolean };
};

// 列表只返回匹配和响应摘要，避免批量加载每条规则的完整响应正文。
export function summarizeMockRules(value: unknown) {
  const state = value as RuleSet | null;
  return {
    kind: state?.kind ?? 'collection',
    revision: state?.revision ?? 0,
    options: state?.options ?? {},
    states: state?.states ?? {},
    rules: (state?.rules ?? []).map(
      ({
        id,
        name,
        method,
        path,
        pathMode,
        secure,
        priority,
        expiresAt,
        scenario,
        enabled,
        exhausted,
        steps,
      }) => ({
        pathMode,
        secure,
        priority,
        expiresAt,
        scenario,
        id,
        name,
        method,
        path,
        enabled,
        exhausted,
        hits: state?.hits[id] ?? 0,
        steps: steps.map(({ action, statusCode, times, delayMs }) => ({
          action,
          statusCode,
          times,
          delayMs,
        })),
      }),
    ),
  };
}
export type IncomingMock = {
  method: string;
  path: string;
  query: Record<string, unknown>;
  headers: Record<string, string>;
  body: unknown;
  rawBody?: string;
  protocol?: 'http' | 'websocket';
  secure?: boolean;
};

function invalid(field: string): never {
  throw new BadRequestException(`Invalid Mock rule field: ${field}`);
}
function object(input: unknown, field: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    invalid(field);
  return input as Record<string, unknown>;
}
function string(input: unknown, field: string, max: number) {
  if (typeof input !== 'string' || input.length > max) invalid(field);
  return input;
}
function integer(input: unknown, field: string, min: number, max: number) {
  if (
    typeof input !== 'number' ||
    !Number.isInteger(input) ||
    input < min ||
    input > max
  )
    invalid(field);
  return input;
}
function list(input: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(input) || input.length > max) invalid(field);
  return input;
}

export function parseMockRules(input: unknown): Rule[] {
  const ids = new Set<string>();
  let fileBytes = 0;
  const rules = list(input, 'rules', 1000).map((item): Rule => {
    const rule = object(item, 'rule');
    const id = string(rule.id, 'id', 64);
    if (!/^[a-z0-9-]{8,64}$/i.test(id) || ids.has(id)) invalid('id');
    ids.add(id);
    const name = string(rule.name, 'name', 100).trim();
    const path = string(rule.path, 'path', 1000).trim();
    if (
      rule.pathMode !== 'regex' &&
      (!path.startsWith('/') || /[?#\s]/.test(path))
    )
      invalid('path');
    const pathMode = rule.pathMode ?? 'template';
    if (!['template', 'exact', 'glob', 'regex'].includes(pathMode as string))
      invalid('path mode');
    if (pathMode === 'regex') safeRegex(path);
    const priority = integer(rule.priority ?? 0, 'priority', -100000, 100000);
    const expiresAt =
      rule.expiresAt == null || rule.expiresAt === ''
        ? null
        : string(rule.expiresAt, 'expiry', 40);
    if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) invalid('expiry');
    let scenario: Rule['scenario'];
    if (rule.scenario && object(rule.scenario, 'scenario').name) {
      const raw = object(rule.scenario, 'scenario');
      scenario = {
        name: string(raw.name, 'scenario name', 100),
        requiredState: string(
          raw.requiredState ?? 'STARTED',
          'required state',
          100,
        ),
        nextState: string(raw.nextState ?? '', 'next state', 100),
      };
    }
    const method = string(rule.method, 'method', 12).toUpperCase();
    if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ANY)$/.test(method))
      invalid('method');
    if (rule.secure != null && typeof rule.secure !== 'boolean')
      invalid('secure');
    const enabled = rule.enabled;
    if (typeof enabled !== 'boolean') invalid('enabled');
    const exhausted = rule.exhausted;
    if (
      exhausted !== 'repeat_last' &&
      exhausted !== 'loop' &&
      exhausted !== 'fallthrough'
    )
      invalid('exhausted');
    const conditions = list(rule.conditions, 'conditions', 20).map(
      (item): Condition => {
        const {
          source,
          key,
          value,
          operator = 'equals',
        } = object(item, 'condition');
        if (!operators.includes(operator as string))
          invalid('condition operator');
        if (operator === 'regex') safeRegex(String(value));
        if (operator === 'json_contains') {
          try {
            JSON.parse(String(value));
          } catch {
            invalid('condition JSON');
          }
        }
        if (
          source !== 'query' &&
          source !== 'header' &&
          source !== 'body' &&
          source !== 'cookie'
        )
          invalid('condition source');
        const field = string(key, 'condition key', 2000).trim();
        if (!field) invalid('condition key');
        const namespaces = Object.fromEntries(
          Object.entries(
            object((item as any).namespaces ?? {}, 'namespaces'),
          ).map(([k, v]) => [k, string(v, 'namespace URI', 1000)]),
        );
        if (structureOperators.includes(String(operator))) {
          if (source !== 'body') invalid('structural condition source');
          try {
            validateStructure(
              String(operator),
              field,
              String(value ?? ''),
              namespaces,
            );
          } catch (e) {
            invalid(`structural condition: ${String(e)}`);
          }
        }
        return {
          source,
          ...(Object.keys(namespaces).length ? { namespaces } : {}),
          operator: operator as Condition['operator'],
          key: source === 'header' ? field.toLowerCase() : field,
          value: string(value ?? '', 'condition value', 65536),
        };
      },
    );
    const steps = list(rule.steps, 'steps', 30).map((item): Step => {
      const step = object(item, 'response step');
      const action = step.action ?? 'http';
      if (
        ![
          'http',
          'disconnect',
          'sse',
          'file',
          'forward',
          'websocket',
          'script',
          'callback',
        ].includes(action as string)
      )
        invalid('response action');
      const statusCode =
        action === 'http' || action === 'file'
          ? integer(step.statusCode, 'status code', 200, 599)
          : 200;
      const body =
        action === 'disconnect' ||
        action === 'file' ||
        action === 'forward' ||
        action === 'websocket' ||
        action === 'script' ||
        action === 'callback' ||
        [204, 205, 304].includes(statusCode)
          ? ''
          : string(step.body, 'body', 262144);
      const intervalMs =
        action === 'sse' || action === 'websocket'
          ? integer(step.intervalMs ?? 0, 'SSE interval', 0, 60000)
          : 0;
      if (action === 'sse') {
        const events = sseEvents(body);
        if (
          !events.length ||
          events.length > 50 ||
          (events.length - 1) * intervalMs > 60000
        )
          invalid('SSE events or duration');
      }
      const headers = Object.fromEntries(
        Object.entries(object(step.headers, 'headers'))
          .filter(([key]) => key.toLowerCase() !== 'set-cookie')
          .map(([key, raw]) => {
            const name = key.toLowerCase();
            const value = string(raw, 'header value', 8192);
            if (excludedHeaders.has(name)) invalid(`header ${key}`);
            try {
              validateHeaderName(name);
              validateHeaderValue(name, value);
            } catch {
              invalid(`header ${key}`);
            }
            return [name, value];
          }),
      );
      const headerCookies = Object.entries(object(step.headers, 'headers'))
        .filter(([key]) => key.toLowerCase() === 'set-cookie')
        .flatMap(([, v]) => (Array.isArray(v) ? v : [v]));
      const cookies = list(
        [...headerCookies, ...list(step.cookies ?? [], 'cookies', 50)],
        'cookies',
        50,
      ).map((v) => {
        const cookie = string(v, 'Set-Cookie', 8192);
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+=/.test(cookie))
          invalid('cookie name');
        try {
          validateHeaderValue('set-cookie', cookie);
        } catch {
          invalid('Set-Cookie');
        }
        if (/[\r\n]/.test(cookie)) invalid('Set-Cookie');
        return cookie;
      });
      let file: MockResponseFile | undefined;
      if (action === 'file') {
        if ([204, 205, 304].includes(statusCode)) invalid('file status code');
        const raw = object(step.file, 'file');
        const name = string(raw.name, 'file name', 255).trim();
        if (
          !name ||
          /[\u0000-\u001f\u007f/\\]/.test(name) ||
          /[\uD800-\uDFFF]/u.test(name)
        )
          invalid('file name');
        const contentType = string(
          raw.contentType,
          'file content type',
          127,
        ).toLowerCase();
        if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(contentType))
          invalid('file content type');
        const data = string(
          raw.data,
          'file data',
          Math.ceil(MAX_MOCK_FILE_BYTES / 3) * 4,
        );
        if (data.length % 4 || /[^A-Za-z0-9+/=]/.test(data))
          invalid('file data');
        const bytes = Buffer.from(data, 'base64');
        if (
          bytes.length > MAX_MOCK_FILE_BYTES ||
          bytes.toString('base64') !== data
        )
          invalid('file data');
        fileBytes += bytes.length;
        if (fileBytes > MAX_MOCK_FILES_BYTES) invalid('files exceed 20 MiB');
        const disposition = raw.disposition;
        if (disposition !== 'inline' && disposition !== 'attachment')
          invalid('file disposition');
        file = { name, contentType, data, disposition };
      }
      return {
        action: action as Step['action'],
        template: step.template === true,
        ...(cookies.length ? { cookies } : {}),
        ...(action === 'script'
          ? {
              script: {
                code: string(
                  object(step.script, 'script').code,
                  'script code',
                  65536,
                ),
                timeoutMs: integer(
                  object(step.script, 'script').timeoutMs ?? 1000,
                  'script timeout',
                  10,
                  5000,
                ),
              },
            }
          : {}),
        ...(action === 'callback'
          ? {
              callback: ((v: ForwardConfig) => ({
                url: v.url,
                headers: v.headers,
                timeoutMs: v.timeoutMs,
              }))(parseForward(step.callback)),
            }
          : {}),
        ...(action === 'forward'
          ? { forward: parseForward(step.forward) }
          : {}),
        ...(action === 'websocket'
          ? { websocket: parseWebSocket(step.websocket) }
          : {}),
        intervalMs,
        disconnectAfter:
          (action === 'sse' || action === 'websocket') &&
          step.disconnectAfter === true,
        times: integer(step.times, 'times', 1, 10000),
        statusCode,
        delayMs:
          step.delayMs === null
            ? null
            : integer(step.delayMs, 'delay', 0, 60000),
        headers,
        body,
        ...(file ? { file } : {}),
      };
    });
    if (!steps.length) invalid('steps');
    return {
      id,
      name,
      enabled,
      method,
      path,
      ...(typeof rule.secure === 'boolean' ? { secure: rule.secure } : {}),
      pathMode: pathMode as Rule['pathMode'],
      priority,
      expiresAt,
      ...(scenario ? { scenario } : {}),
      conditions,
      steps,
      exhausted,
    };
  });
  // 文件与规则原子保存；正文仍保持原有的 1 MiB 总限制，文件单独计量。
  const metadata = rules.map((rule) => ({
    ...rule,
    steps: rule.steps.map(({ file, ...step }) => ({
      ...step,
      ...(file ? { file: { ...file, data: '' } } : {}),
    })),
  }));
  if (Buffer.byteLength(JSON.stringify(metadata)) > 1024 * 1024)
    invalid('rules exceed 1 MiB');
  return rules;
}

// 空行分隔 SSE 事件，保留事件内的 data、event、id 等原始字段。
export function sseEvents(body: string) {
  return body
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .filter((event) => event.trim());
}

export type ForwardConfig = {
  url: string;
  path?: string;
  method?: string;
  headers: Record<string, string>;
  removeHeaders: string[];
  timeoutMs: number;
  preserveQuery: boolean;
};
export type WebSocketMessage = string | { type: 'binary'; data: string };
export type WebSocketConfig = {
  messages: WebSocketMessage[];
  matchers: {
    operator: 'equals' | 'contains' | 'regex' | 'any';
    value: string;
    replies: WebSocketMessage[];
    type?: 'text' | 'binary' | 'any';
    close?: boolean;
  }[];
  closeCode: number;
};
export const operators = [
  'equals',
  'not_equals',
  'contains',
  'regex',
  'exists',
  'absent',
  'gt',
  'gte',
  'lt',
  'lte',
  'json_contains',
  'json_schema',
  'jsonpath',
  'xpath',
];

// Limit patterns to a portable, non-backtracking subset also understood by Rust regex.
export function safeRegex(pattern: string) {
  if (
    pattern.length > 256 ||
    /\(\?|\\[1-9]|[+*?}]\s*[+*?{]|\)[+*{?]/.test(pattern)
  )
    invalid('regular expression');
  try {
    return new RegExp(pattern, 'u');
  } catch {
    invalid('regular expression');
  }
}
export function parseForward(input: unknown): ForwardConfig {
  const raw = object(input, 'forward');
  const url = string(raw.url, 'upstream URL', 2000);
  try {
    const parsed = new URL(url);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    )
      invalid('upstream URL');
  } catch {
    invalid('upstream URL');
  }
  const headers = Object.fromEntries(
    Object.entries(object(raw.headers ?? {}, 'forward headers')).map(
      ([key, value]) => {
        const name = key.toLowerCase();
        if (
          [
            'host',
            'connection',
            'transfer-encoding',
            'content-length',
            'upgrade',
          ].includes(name)
        )
          invalid('forward header');
        const text = string(value, 'forward header value', 8192);
        if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || /[\r\n]/.test(text))
          invalid('forward header');
        return [name, text];
      },
    ),
  );
  const path = string(raw.path ?? '', 'forward path', 2000);
  if (
    path &&
    (!path.startsWith('/') || path.startsWith('//') || /[\r\n#]/.test(path))
  )
    invalid('forward path');
  const method = string(raw.method ?? '', 'forward method', 12).toUpperCase();
  if (method && !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method))
    invalid('forward method');
  return {
    url,
    path,
    method,
    headers,
    removeHeaders: list(raw.removeHeaders ?? [], 'removed headers', 50).map(
      (v) => string(v, 'removed header', 100).toLowerCase(),
    ),
    timeoutMs: integer(raw.timeoutMs ?? 30000, 'upstream timeout', 100, 120000),
    preserveQuery: raw.preserveQuery !== false,
  };
}
export function parseWebSocket(input: unknown): WebSocketConfig {
  const raw = object(input ?? {}, 'WebSocket');
  const messages = (v: unknown) =>
    list(v ?? [], 'WebSocket messages', 50).map((v): WebSocketMessage => {
      if (typeof v === 'string') return string(v, 'WebSocket message', 65536);
      const raw = object(v, 'binary message');
      const data = string(raw.data, 'binary message data', 87384);
      if (
        raw.type !== 'binary' ||
        (data.indexOf('{{') < 0 &&
          Buffer.from(data, 'base64').toString('base64') !== data)
      )
        invalid('binary message');
      return { type: 'binary', data };
    });
  const closeCode = integer(
    raw.closeCode ?? 1000,
    'WebSocket close code',
    1000,
    4999,
  );
  if (
    ![
      1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014,
    ].includes(closeCode) &&
    closeCode < 3000
  )
    invalid('WebSocket close code');
  return {
    messages: messages(raw.messages),
    closeCode,
    matchers: list(raw.matchers ?? [], 'WebSocket matchers', 50).map((v) => {
      const row = object(v, 'WebSocket matcher');
      if (
        !['equals', 'contains', 'regex', 'any'].includes(row.operator as string)
      )
        invalid('WebSocket operator');
      const value = string(row.value ?? '', 'WebSocket matcher value', 2000);
      if (row.operator === 'regex') safeRegex(value);
      return {
        operator:
          row.operator as WebSocketConfig['matchers'][number]['operator'],
        value,
        type: ['text', 'binary', 'any'].includes(String(row.type ?? 'text'))
          ? ((row.type ?? 'text') as 'text' | 'binary' | 'any')
          : invalid('WebSocket matcher type'),
        replies: messages(row.replies),
        close: row.close === true,
      };
    }),
  };
}
export function parseOptions(input: unknown): NonNullable<RuleSet['options']> {
  const raw = object(input ?? {}, 'options');
  return {
    recording: raw.recording === true,
    ...(raw.fallback && object(raw.fallback, 'fallback').url
      ? { fallback: parseForward(raw.fallback) }
      : {}),
  };
}
export function fieldAt(value: unknown, path: string): any {
  if (path === '$' || path === '') return value;
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key))
      return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
function subset(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      expected.every((v) => actual.some((a) => subset(a, v)))
    );
  if (expected && typeof expected === 'object')
    return (
      !!actual &&
      typeof actual === 'object' &&
      Object.entries(expected).every(
        ([k, v]) => Object.hasOwn(actual, k) && subset((actual as any)[k], v),
      )
    );
  return actual === expected;
}
export function compareMockValue(
  actual: unknown,
  operator: string,
  expected: string,
): boolean {
  if (operator === 'exists') return actual !== undefined;
  if (operator === 'absent') return actual === undefined;
  if (operator === 'not_equals')
    return (
      actual !== undefined && !compareMockValue(actual, 'equals', expected)
    );
  if (operator === 'json_contains') {
    try {
      return subset(actual, JSON.parse(expected));
    } catch {
      return false;
    }
  }
  if (Array.isArray(actual))
    return actual.some((v) => compareMockValue(v, operator, expected));
  if (actual === undefined) return false;
  const text =
    typeof actual === 'object' && actual !== null
      ? JSON.stringify(actual)
      : String(actual);
  switch (operator) {
    case 'equals':
      return text === expected;
    case 'contains':
      return text.includes(expected);
    case 'regex':
      return safeRegex(expected).test(text.slice(0, 65536));
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (text.trim() === '' || expected.trim() === '') return false;
      const a = Number(text),
        b = Number(expected);
      return (
        Number.isFinite(a) &&
        Number.isFinite(b) &&
        { gt: a > b, gte: a >= b, lt: a < b, lte: a <= b }[operator]
      );
    }
    default:
      return false;
  }
}
export function pathParams(
  rule: Rule,
  path: string,
): Record<string, string> | null {
  if (rule.pathMode === 'regex')
    return safeRegex(rule.path).test(path) ? {} : null;
  if (rule.pathMode === 'glob') {
    const pattern = rule.path
      .split('**')
      .map((v) =>
        v
          .split('*')
          .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^/]*'),
      )
      .join('.*');
    return new RegExp(`^${pattern}$`, 'u').test(path) ? {} : null;
  }
  if (rule.path === path) return {};
  if (rule.pathMode === 'exact') return null;
  const parts = rule.path.split('/'),
    actual = path.split('/');
  const params: Record<string, string> = Object.create(null);
  if (parts.length !== actual.length) return null;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(':') && parts[i].length > 1 && actual[i]) {
      try {
        params[parts[i].slice(1)] = decodeURIComponent(actual[i]);
      } catch {
        params[parts[i].slice(1)] = actual[i];
      }
    } else if (parts[i] !== actual[i]) return null;
  }
  return params;
}
export function normalizeIncoming(input: unknown): IncomingMock {
  const raw = object(input, 'test request');
  const path = string(raw.path ?? '/', 'request path', 4000);
  if (!path.startsWith('/') || path.startsWith('//') || /[\r\n#]/.test(path))
    invalid('request path');
  const url = new URL(path, 'http://mock.local');
  const query: Record<string, unknown> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    query[key] = all.length > 1 ? all : all[0];
  }
  const headers = Object.fromEntries(
    Object.entries(object(raw.headers ?? {}, 'request headers')).map(
      ([k, v]) => {
        const value = string(v, 'request header', 8192);
        try {
          validateHeaderName(k);
          validateHeaderValue(k, value);
        } catch {
          invalid('request header');
        }
        return [k.toLowerCase(), value];
      },
    ),
  );
  const method = string(
    raw.method ?? 'GET',
    'request method',
    12,
  ).toUpperCase();
  if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ANY)$/.test(method))
    invalid('request method');
  return {
    path: url.pathname,
    method,
    headers,
    query: { ...query, ...object(raw.query ?? {}, 'request query') },
    body: raw.rawBody === '' ? '' : Object.hasOwn(raw, 'body') ? raw.body : '',
    rawBody: typeof raw.rawBody === 'string' ? raw.rawBody : undefined,
    protocol: raw.protocol === 'websocket' ? 'websocket' : 'http',
    secure: raw.secure === true,
  };
}
export type MockTrace = {
  ruleID: string;
  name: string;
  matched: boolean;
  reasons: {
    code: string;
    field?: string;
    actual?: unknown;
    expected?: unknown;
  }[];
};
function cookies(headers: Record<string, string>) {
  return Object.fromEntries(
    (headers.cookie ?? '')
      .split(';')
      .filter((v) => v.includes('='))
      .map((v) => {
        const i = v.indexOf('=');
        return [v.slice(0, i).trim(), v.slice(i + 1).trim()];
      }),
  );
}
export function explainMock(
  state: RuleSet,
  request: IncomingMock,
  now = Date.now(),
) {
  let selection: {
    rule: Rule;
    step: Step;
    stepNumber: number;
    hit: number;
    params: Record<string, string>;
  } | null = null;
  const trace: MockTrace[] = [];
  const rules = state.rules
    .map((rule, index) => ({ rule, index }))
    .sort(
      (a, b) =>
        (b.rule.priority ?? 0) - (a.rule.priority ?? 0) || a.index - b.index,
    );
  for (const { rule } of rules) {
    const reasons: MockTrace['reasons'] = [];
    if (!rule.enabled) reasons.push({ code: 'disabled' });
    if (rule.expiresAt && Date.parse(rule.expiresAt) <= now)
      reasons.push({ code: 'expired', expected: rule.expiresAt });
    if (rule.method !== 'ANY' && rule.method !== request.method)
      reasons.push({
        code: 'method',
        actual: request.method,
        expected: rule.method,
      });
    if (
      typeof rule.secure === 'boolean' &&
      rule.secure !== (request.secure === true)
    )
      reasons.push({
        code: 'secure',
        actual: request.secure === true,
        expected: rule.secure,
      });
    const params = pathParams(rule, request.path);
    if (!params)
      reasons.push({ code: 'path', actual: request.path, expected: rule.path });
    for (const condition of rule.conditions) {
      const actual =
        condition.source === 'body'
          ? ['jsonpath', 'xpath'].includes(condition.operator ?? '')
            ? request.body
            : fieldAt(request.body, condition.key)
          : (condition.source === 'cookie'
              ? cookies(request.headers)
              : condition.source === 'query'
                ? request.query
                : request.headers)[condition.key];
      if (
        !(structureOperators.includes(condition.operator ?? '')
          ? matchStructure(
              condition.operator!,
              actual,
              condition.key,
              condition.value,
              condition.namespaces,
            )
          : compareMockValue(
              actual,
              condition.operator ?? 'equals',
              condition.value,
            ))
      )
        reasons.push({
          code: 'condition',
          field: `${condition.source}.${condition.key} ${condition.operator ?? 'equals'}`,
          actual: actual ?? null,
          expected: condition.value,
        });
    }
    if (rule.scenario) {
      const actual =
        state.states && Object.hasOwn(state.states, rule.scenario.name)
          ? state.states[rule.scenario.name]
          : 'STARTED';
      if (rule.scenario.requiredState && actual !== rule.scenario.requiredState)
        reasons.push({
          code: 'scenario',
          field: rule.scenario.name,
          actual,
          expected: rule.scenario.requiredState,
        });
    }
    const hit = (state.hits[rule.id] ?? 0) + 1;
    const total = rule.steps.reduce((sum, step) => sum + step.times, 0);
    if (rule.exhausted === 'fallthrough' && hit > total)
      reasons.push({ code: 'exhausted', actual: hit - 1, expected: total });
    let remaining =
      rule.exhausted === 'loop'
        ? ((hit - 1) % total) + 1
        : Math.min(hit, total);
    const index = rule.steps.findIndex(
      (step) => (remaining -= step.times) <= 0,
    );
    const step = rule.steps[index];
    if (
      step &&
      (step.action === 'websocket') !== (request.protocol === 'websocket')
    )
      reasons.push({
        code: 'protocol',
        expected: step.action === 'websocket' ? 'websocket' : 'http',
      });
    const matched = reasons.length === 0;
    if (matched && !selection)
      selection = { rule, step, stepNumber: index + 1, hit, params: params! };
    else if (matched)
      reasons.push({ code: 'shadowed', expected: selection?.rule.id });
    trace.push({
      ruleID: rule.id,
      name: rule.name || rule.path,
      matched,
      reasons,
    });
  }
  return { selection, trace };
}
export function selectMockStep(state: RuleSet, request: IncomingMock) {
  return explainMock(state, request).selection;
}
export function advanceMock(
  state: RuleSet,
  selection: NonNullable<ReturnType<typeof selectMockStep>>,
) {
  state.hits[selection.rule.id] = selection.hit;
  if (selection.rule.scenario?.nextState)
    (state.states ??= {})[selection.rule.scenario.name] =
      selection.rule.scenario.nextState;
}
export function renderMockText(
  text: string,
  request: IncomingMock,
  params: Record<string, string> = {},
  extra: Record<string, unknown> = {},
): string {
  const values: Record<string, unknown> = {
    request,
    query: request.query,
    headers: request.headers,
    body: request.body,
    path: params,
    ...extra,
  };
  const cache = new Map<string, unknown>();
  const resolve = (expression: string): unknown => {
    const key = expression.trim();
    if (cache.has(key)) return cache.get(key);
    let value: unknown;
    if (key === 'uuid') value = randomUUID();
    else if (key === 'timestamp') value = Date.now();
    else if (key === 'isoDate') value = new Date().toISOString();
    else if (/^randomInt:-?\d+:-?\d+$/.test(key)) {
      const [, a, b] = key.split(':').map(Number);
      if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || b < a)
        invalid('random range');
      value = a + Math.floor(Math.random() * (b - a + 1));
    } else {
      const found = fieldAt(values, key);
      value = found === undefined ? '' : found;
    }
    cache.set(key, value);
    return value;
  };
  const replace = (value: any): any => {
    if (typeof value === 'string') {
      const full = value.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
      if (full) return resolve(full[1]);
      return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key) => {
        const v = resolve(key);
        return typeof v === 'object' ? JSON.stringify(v) : String(v);
      });
    }
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, replace(v)]),
      );
    return value;
  };
  try {
    return JSON.stringify(replace(JSON.parse(text)));
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    return replace(text);
  }
}
export function renderStep(
  step: Step,
  request: IncomingMock,
  params: Record<string, string>,
) {
  if (!step.template) return step;
  return {
    ...step,
    body: renderMockText(step.body, request, params),
    ...(step.cookies
      ? { cookies: step.cookies.map((v) => renderMockText(v, request, params)) }
      : {}),
    headers: Object.fromEntries(
      Object.entries(step.headers).map(([k, v]) => [
        k,
        renderMockText(v, request, params),
      ]),
    ),
  };
}
export function ruleFromLog(log: any): Rule {
  const meta = log.mockMatch ?? {};
  if (meta.bodyTruncated || meta.requestTruncated)
    invalid('recording is incomplete');
  if (log.responseBody == null || log.responseStatus < 200)
    invalid('recording has no reusable HTTP response');
  let response = log.responseBody;
  const encoding = String(
    log.responseHeaders?.['content-encoding'] ?? '',
  ).toLowerCase();
  if (encoding && encoding !== 'identity') {
    if (typeof response !== 'object' || response.encoding !== 'base64')
      invalid('encoded recording');
    const bytes = Buffer.from(response.data, 'base64');
    const decode =
      encoding === 'gzip'
        ? gunzipSync
        : encoding === 'deflate'
          ? inflateSync
          : encoding === 'br'
            ? brotliDecompressSync
            : null;
    if (!decode) invalid('unsupported content encoding');
    try {
      const body = decode(bytes, { maxOutputLength: MAX_MOCK_FILE_BYTES });
      const text = body.toString('utf8');
      response =
        Buffer.from(text).equals(body) && !text.includes('\0')
          ? text
          : { encoding: 'base64', data: body.toString('base64') };
    } catch {
      invalid('encoded recording exceeds limit or is invalid');
    }
  }
  const binary = typeof response === 'object' && response.encoding === 'base64';
  const headers = Object.fromEntries(
    Object.entries(log.responseHeaders ?? {}).filter(
      ([k, v]) =>
        !excludedHeaders.has(k.toLowerCase()) &&
        k.toLowerCase() !== 'content-encoding' &&
        typeof v === 'string',
    ),
  );
  const body =
    typeof response === 'string'
      ? response
      : binary
        ? ''
        : JSON.stringify(response);
  return parseMockRules([
    {
      id: randomUUID(),
      name: `${log.requestMethod} ${log.requestPath}`,
      enabled: true,
      method: log.requestMethod,
      path: log.requestPath,
      conditions: [],
      exhausted: 'repeat_last',
      steps: [
        {
          action: binary
            ? 'file'
            : String(headers['content-type'] ?? '').includes(
                  'text/event-stream',
                )
              ? 'sse'
              : 'http',
          statusCode: log.responseStatus,
          body,
          headers,
          cookies: Object.entries(log.responseHeaders ?? {})
            .filter(([key]) => key.toLowerCase() === 'set-cookie')
            .flatMap(([, v]) => (Array.isArray(v) ? v : [String(v)])),
          delayMs: 0,
          times: 1,
          intervalMs: 0,
          ...(binary
            ? {
                file: {
                  name: 'response.bin',
                  contentType: String(
                    headers['content-type'] ?? 'application/octet-stream',
                  ).split(';')[0],
                  data: response.data,
                  disposition: 'inline',
                },
              }
            : {}),
        },
      ],
    },
  ])[0];
}
