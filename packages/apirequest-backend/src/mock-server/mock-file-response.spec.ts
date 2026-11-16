import express from 'express';
import request from 'supertest';
import { MockServerController } from './mock-server.controller';
import {
  MAX_MOCK_FILE_BYTES,
  parseMockRules,
  summarizeMockRules,
} from './mock-rule.service';

const bytes = Buffer.from([0, 255, 128, 13, 10, 0, 42]);
const sample = () => ({
  id: 'file-rule-123',
  name: 'Download',
  method: 'GET',
  path: '/download',
  enabled: true,
  conditions: [],
  exhausted: 'repeat_last',
  steps: [
    {
      action: 'file',
      statusCode: 201,
      times: 1,
      delayMs: null,
      headers: {},
      body: '',
      file: {
        name: '测试 "样本".bin',
        contentType: 'application/octet-stream',
        data: bytes.toString('base64'),
        disposition: 'attachment',
      },
    },
  ],
});
const parse = (rule = sample()) => parseMockRules([rule])[0];

describe('Mock response files', () => {
  it('persists binary files and keeps them out of list summaries', () => {
    const rule = parse();
    expect(Buffer.from(rule.steps[0].file.data, 'base64')).toEqual(bytes);
    const summary = summarizeMockRules({
      revision: 1,
      rules: [rule],
      hits: {},
    });
    expect(summary.rules[0].steps[0]).toMatchObject({
      action: 'file',
      statusCode: 201,
    });
    expect(summary.rules[0].steps[0]).not.toHaveProperty('file');
    expect(parse(JSON.parse(JSON.stringify(rule)))).toEqual(rule);
  });

  it.each([
    ['missing file', { file: undefined }],
    ['bodyless status', { statusCode: 204 }],
    ['reset-content status', { statusCode: 205 }],
    ['not-modified status', { statusCode: 304 }],
    ['invalid base64', { file: { ...sample().steps[0].file, data: '!!!!' } }],
    [
      'noncanonical base64',
      { file: { ...sample().steps[0].file, data: 'YR==' } },
    ],
    [
      'header injection',
      { file: { ...sample().steps[0].file, name: 'x\r\nBad: y' } },
    ],
    [
      'path filename',
      { file: { ...sample().steps[0].file, name: '../secret' } },
    ],
    [
      'unpaired surrogate',
      { file: { ...sample().steps[0].file, name: '\ud800.bin' } },
    ],
    [
      'invalid MIME',
      {
        file: { ...sample().steps[0].file, contentType: 'image/png\r\nBad: y' },
      },
    ],
    [
      'invalid disposition',
      { file: { ...sample().steps[0].file, disposition: 'execute' } },
    ],
  ])('rejects %s', (_name, patch) => {
    const rule = sample();
    Object.assign(rule.steps[0], patch);
    expect(() => parse(rule)).toThrow();
  });

  it('accepts empty files and the exact file size limit, rejecting larger files and excessive totals', () => {
    const rule = sample();
    rule.steps[0].file.data = '';
    expect(parse(rule).steps[0].file.data).toBe('');
    rule.steps[0].file.data =
      Buffer.alloc(MAX_MOCK_FILE_BYTES).toString('base64');
    expect(parse(rule).steps[0].file.data).toBe(rule.steps[0].file.data);
    const next = { ...rule, id: 'file-rule-456' };
    expect(parseMockRules([rule, next])).toHaveLength(2);
    expect(() =>
      parseMockRules([rule, next, { ...rule, id: 'file-rule-789' }]),
    ).toThrow('20 MiB');
    rule.steps[0].file.data = Buffer.alloc(MAX_MOCK_FILE_BYTES + 1).toString(
      'base64',
    );
    expect(() => parse(rule)).toThrow();
  });

  it('discards stale file payloads after switching back to HTTP', () => {
    const rule = sample();
    rule.steps[0].action = 'http';
    rule.steps[0].body = '{"ok":true}';
    const step = parse(rule).steps[0];
    expect(step.file).toBeUndefined();
    expect(step.body).toBe('{"ok":true}');
  });

  function appFor(rule = parse()) {
    const step = rule.steps[0];
    const controller = new MockServerController(
      {} as any,
      {
        match: async () => ({ rule, step, stepNumber: 1, hit: 1 }),
      } as any,
    );
    const app = express();
    app.use((req, res) => {
      Object.assign(req, {
        mockServerId: 'server-id',
        mockServer: { subdomain: 'test-file', ruleSet: {}, delayInMs: 0 },
      });
      void controller.handleMockRequest(req, res);
    });
    return app;
  }

  it('serves the original bytes with a Unicode download filename and correct length', async () => {
    const result = await request(appFor())
      .get('/mock/test-file/download')
      .expect(201);
    expect(result.body).toEqual(bytes);
    expect(result.headers['content-length']).toBe(String(bytes.length));
    expect(result.headers['content-type']).toBe('application/octet-stream');
    expect(result.headers['content-disposition']).toContain(
      'attachment; filename=',
    );
    expect(result.headers['content-disposition']).toContain(
      "filename*=UTF-8''%E6%B5%8B%E8%AF%95",
    );
    expect(result.headers['x-content-type-options']).toBe('nosniff');
  });

  it('supports HEAD without a response body', async () => {
    const result = await request(appFor())
      .head('/mock/test-file/download')
      .expect(201);
    expect(result.text).toBeUndefined();
    expect(result.headers['content-length']).toBe(String(bytes.length));
  });

  it('supports inline images and forces active content to download on the application origin', async () => {
    const rule = parse();
    rule.steps[0].file.contentType = 'image/png';
    rule.steps[0].file.disposition = 'inline';
    let result = await request(appFor(rule))
      .get('/mock/test-file/download')
      .expect(201);
    expect(result.headers['content-type']).toBe('image/png');
    expect(result.headers['content-disposition']).toMatch(/^inline;/);
    rule.steps[0].file.contentType = 'image/svg+xml';
    result = await request(appFor(rule))
      .get('/mock/test-file/download')
      .expect(201);
    expect(result.headers['content-type']).toMatch(/^text\/plain/);
    expect(result.headers['content-disposition']).toMatch(/^attachment;/);
    expect(result.headers['content-security-policy']).toContain('sandbox');
  });
});
