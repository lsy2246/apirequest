import {
  redact,
  safeJSON,
  validateChange,
  merge,
  defaultRequest,
  validateData,
} from './contract';
describe('MCP 配置边界', () => {
  test('拒绝原型污染键，不把工作区文本当指令', () => {
    expect(() =>
      safeJSON(JSON.parse('{"data":{"__proto__":{"admin":true}}}')),
    ).toThrow();
    expect(
      merge(
        { request: { method: 'GET', headers: [] } },
        { request: { method: 'POST' } },
      ),
    ).toEqual({ request: { method: 'POST', headers: [] } });
  });
  test('已有认证和秘密变量不会出现在 AI 查询中', () => {
    const result = redact({
      auth: { authType: 'bearer', token: 'existing-key' },
      headers: [{ key: 'Authorization', value: 'Bearer header-key' }],
      variables: [
        {
          key: 'token',
          secret: true,
          currentValue: 'variable-key',
          initialValue: 'variable-key',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /existing-key|header-key|variable-key/,
    );
  });
  test('拒绝把脱敏占位符写回配置', () => {
    expect(() =>
      validateChange({
        entity: 'request',
        operation: 'update',
        id: 'test',
        data: { request: { auth: { token: '[REDACTED]' } } },
        reason: '编辑',
        idempotencyKey: 'valid-key-1',
      }),
    ).toThrow();
  });
  test('限制字段、类型和负载，压测上限不能绕过', () => {
    expect(() => validateData('request', { ownerUid: 'forged' })).toThrow();
    expect(() => validateData('collection', { type: 'other' })).toThrow();
    expect(() =>
      validateData('load_test', {
        config: {
          mode: 'requests',
          concurrency: 999,
          requests: 20,
          durationSeconds: 10,
          timeoutMs: 1000,
        },
      }),
    ).toThrow();
    expect(() => safeJSON({ data: 'x'.repeat(512001) })).toThrow();
  });
  test('默认请求仅保存配置，没有自动执行脚本或请求', () => {
    expect(defaultRequest('REST', 'HTTP')).toMatchObject({
      v: '17',
      method: 'GET',
      preRequestScript: '',
      testScript: '',
    });
    expect(defaultRequest('GQL', 'GraphQL')).toMatchObject({
      v: 10,
      query: '',
    });
  });
});
