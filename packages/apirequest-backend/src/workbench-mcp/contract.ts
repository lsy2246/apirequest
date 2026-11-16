import { BadRequestException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';

export const ENTITIES = [
  'collection',
  'request',
  'environment',
  'documentation',
  'automation',
  'load_test',
  'websocket',
] as const;
export type Entity = (typeof ENTITIES)[number];
export type Change = {
  entity: Entity;
  operation: 'create' | 'update' | 'delete';
  id?: string;
  data?: Record<string, any>;
  reason: string;
  idempotencyKey: string;
};
export const MASK = '[REDACTED]';
export function object(value: unknown): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Expected a JSON object');
}
export function safeJSON(value: unknown) {
  const raw = JSON.stringify(value);
  if (!raw || raw.length > 512000)
    throw new BadRequestException('Configuration is too large');
  JSON.parse(raw, (key, val) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key))
      throw new BadRequestException('Unsafe configuration key');
    return val;
  });
}
export function entity(value: unknown): asserts value is Entity {
  if (!ENTITIES.includes(value as Entity))
    throw new BadRequestException('Unknown entity');
}
export function validateChange(value: unknown): Change {
  object(value);
  safeJSON(value);
  entity(value.entity);
  if (!['create', 'update', 'delete'].includes(value.operation))
    throw new BadRequestException('Unknown operation');
  if (
    typeof value.reason !== 'string' ||
    !value.reason.trim() ||
    value.reason.length > 2000
  )
    throw new BadRequestException('A reason is required');
  if (
    typeof value.idempotencyKey !== 'string' ||
    !/^[\w.-]{8,128}$/.test(value.idempotencyKey)
  )
    throw new BadRequestException(
      'idempotencyKey must be 8-128 letters, digits, dots, underscores or hyphens',
    );
  if (
    value.operation !== 'create' &&
    (typeof value.id !== 'string' || !value.id)
  )
    throw new BadRequestException('An id is required');
  if (value.operation !== 'delete') object(value.data);
  if (JSON.stringify(value.data)?.includes(MASK))
    throw new BadRequestException(
      'Do not write redacted values. Send only fields to change.',
    );
  return value as Change;
}
// 仅合并提交的字段：对象递归合并，数组整体替换，null 保留为显式值。
export function merge(base: any, patch: any): any {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const result = { ...(base && typeof base === 'object' ? base : {}) };
  for (const [key, val] of Object.entries(patch))
    result[key] = merge(result[key], val);
  return result;
}
export function changedPaths(
  before: any,
  after: any,
  prefix = '',
  out: string[] = [],
) {
  if (out.length >= 100 || JSON.stringify(before) === JSON.stringify(after))
    return out;
  if (
    before &&
    after &&
    typeof before === 'object' &&
    typeof after === 'object' &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
      changedPaths(
        before[key],
        after[key],
        prefix ? `${prefix}.${key}` : key,
        out,
      );
  } else if (prefix) out.push(prefix);
  else out.push(...Object.keys(after ?? before ?? {}).slice(0, 100));
  return out;
}
export function revision(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
// AI 查询和审批预览均不返回现有密钥；正文等用户内容只能作为数据，不能成为工具指令。
export function redact(value: any, parent = ''): any {
  if (Array.isArray(value)) return value.map((v) => redact(v, parent));
  if (value && typeof value === 'object') {
    const rowSecret =
      value.secret === true ||
      /authorization|cookie|api.?key|token|password|secret/i.test(
        String(value.key ?? ''),
      );
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [
        key,
        (/token|password|secret|private.?key|api.?key|access.?key|authorization|cookie/i.test(
          key,
        ) &&
          !(key === 'secret' && typeof val === 'boolean')) ||
        (rowSecret && ['value', 'currentValue', 'initialValue'].includes(key))
          ? val
            ? MASK
            : val
          : redact(val, key),
      ]),
    );
  }
  if (typeof value === 'string') {
    if (/^[\[{]/.test(value.trim())) {
      try {
        return JSON.stringify(redact(JSON.parse(value)));
      } catch {
        /* 非 JSON 正文按普通文本处理。 */
      }
    }
    return value
      .replace(/(Bearer|Basic)\s+[^\s"']+/gi, `$1 ${MASK}`)
      .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, MASK);
  }
  return value;
}
export const fields: Record<Entity, string[]> = {
  collection: ['title', 'parentID', 'type', 'data'],
  request: ['title', 'collectionID', 'type', 'request'],
  environment: ['name', 'variables', 'isGlobal'],
  documentation: [
    'title',
    'collectionID',
    'version',
    'autoSync',
    'metadata',
    'environmentID',
  ],
  automation: ['name', 'collectionID', 'environmentID', 'config'],
  load_test: ['name', 'requestID', 'environmentID', 'config'],
  websocket: ['name', 'url', 'protocols'],
};
export function validateData(
  kind: Entity,
  value: Record<string, any>,
  partial = false,
) {
  object(value);
  safeJSON(value);
  if (Object.keys(value).some((key) => !fields[kind].includes(key)))
    throw new BadRequestException('Unknown or immutable configuration field');
  if (
    ['collection', 'request'].includes(kind) &&
    value.type !== undefined &&
    !['REST', 'GQL'].includes(value.type)
  )
    throw new BadRequestException('type must be REST or GQL');
  for (const key of ['title', 'name'])
    if (
      value[key] !== undefined &&
      (typeof value[key] !== 'string' ||
        !value[key].trim() ||
        value[key].length > 255)
    )
      throw new BadRequestException(`Invalid ${key}`);
  if (value.variables !== undefined && !Array.isArray(value.variables))
    throw new BadRequestException('variables must be an array');
  if (kind === 'collection' && value.data !== undefined) object(value.data);
  if (kind === 'documentation' && value.metadata !== undefined)
    object(value.metadata);
  if (kind === 'environment' && value.variables !== undefined) {
    for (const variable of value.variables) {
      object(variable);
      if (
        typeof variable.key !== 'string' ||
        !variable.key ||
        typeof variable.secret !== 'boolean' ||
        typeof variable.initialValue !== 'string' ||
        typeof variable.currentValue !== 'string'
      )
        throw new BadRequestException(
          'Variables require key, secret, initialValue and currentValue',
        );
    }
  }
  if (
    kind === 'documentation' &&
    value.autoSync !== undefined &&
    typeof value.autoSync !== 'boolean'
  )
    throw new BadRequestException('autoSync must be a boolean');
  if (
    kind === 'websocket' &&
    value.protocols !== undefined &&
    (!Array.isArray(value.protocols) ||
      value.protocols.some(
        (v) =>
          typeof v !== 'string' || !/^[!#$%&\'*+.^_`|~0-9a-zA-Z-]+$/.test(v),
      ))
  )
    throw new BadRequestException('Invalid WebSocket protocols');
  if (kind === 'request' && value.request !== undefined) {
    object(value.request);
    const r = value.request;
    for (const key of ['headers', 'params', 'requestVariables'])
      if (r[key] !== undefined) {
        if (
          !Array.isArray(r[key]) ||
          r[key].some(
            (v) =>
              !v ||
              typeof v.key !== 'string' ||
              typeof v.value !== 'string' ||
              typeof v.active !== 'boolean',
          )
        )
          throw new BadRequestException(`Invalid ${key}`);
      }
    for (const key of ['preRequestScript', 'testScript', 'query', 'variables'])
      if (r[key] !== undefined && typeof r[key] !== 'string')
        throw new BadRequestException(`Invalid ${key}`);
    if (
      r.method !== undefined &&
      (typeof r.method !== 'string' || !/^[A-Z-]{1,32}$/.test(r.method))
    )
      throw new BadRequestException('Invalid HTTP method');
    for (const key of ['endpoint', 'url'])
      if (
        r[key] !== undefined &&
        (typeof r[key] !== 'string' || !/^(https?:\/\/|<<)/.test(r[key]))
      )
        throw new BadRequestException('Invalid endpoint');
  }
  if (kind === 'load_test' && value.config !== undefined) {
    const c = value.config;
    object(c);
    if (
      Object.keys(c).some(
        (k) =>
          ![
            'mode',
            'concurrency',
            'requests',
            'durationSeconds',
            'timeoutMs',
          ].includes(k),
      )
    )
      throw new BadRequestException('Unknown load setting');
    if (
      (!partial || c.mode !== undefined) &&
      !['requests', 'duration'].includes(c.mode)
    )
      throw new BadRequestException('Invalid load mode');
    for (const [k, max] of Object.entries({
      concurrency: 32,
      requests: 10000,
      durationSeconds: 300,
      timeoutMs: 120000,
    }))
      if (
        (!partial || c[k] !== undefined) &&
        (!Number.isSafeInteger(c[k]) || c[k] < 1 || c[k] > max)
      )
        throw new BadRequestException(`Invalid ${k}`);
  }
  if (kind === 'automation' && value.config !== undefined) {
    object(value.config);
    if (
      Object.keys(value.config).some(
        (k) =>
          ![
            'iterations',
            'delay',
            'stopOnError',
            'persistResponses',
            'keepVariableValues',
            'executeScripts',
          ].includes(k),
      )
    )
      throw new BadRequestException('Unknown automation setting');
    for (const key of [
      'stopOnError',
      'persistResponses',
      'keepVariableValues',
      'executeScripts',
    ])
      if (
        value.config[key] !== undefined &&
        typeof value.config[key] !== 'boolean'
      )
        throw new BadRequestException(`Invalid ${key}`);
    if (
      ((!partial || value.config.iterations !== undefined) &&
        (!Number.isSafeInteger(value.config.iterations) ||
          value.config.iterations < 1 ||
          value.config.iterations > 1000)) ||
      ((!partial || value.config.delay !== undefined) &&
        (!Number.isSafeInteger(value.config.delay) ||
          value.config.delay < 0 ||
          value.config.delay > 60000))
    )
      throw new BadRequestException('Invalid automation iterations or delay');
  }
  if (
    kind === 'websocket' &&
    value.url !== undefined &&
    (typeof value.url !== 'string' || !/^wss?:\/\//.test(value.url))
  )
    throw new BadRequestException('Invalid WebSocket URL');
}
export function defaultRequest(type: 'REST' | 'GQL', name: string) {
  // 与工作台 v17 REST / v10 GraphQL 保存契约一致；不执行请求，也不生成任何密钥。
  const shared = {
    name,
    headers: [],
    auth: { authType: 'inherit', authActive: true },
    preRequestScript: '',
    testScript: '',
    description: null,
    responses: {},
    _ref_id: `req_${randomUUID()}`,
  };
  return type === 'GQL'
    ? { ...shared, v: 10, url: 'http://127.0.0.1/', query: '', variables: '{}' }
    : {
        ...shared,
        v: '17',
        endpoint: 'http://127.0.0.1/',
        method: 'GET',
        params: [],
        body: { contentType: null, body: null },
        requestVariables: [],
      };
}
