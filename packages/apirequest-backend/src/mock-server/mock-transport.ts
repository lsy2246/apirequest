import { scopedMockCookies } from './mock-actions';
import { mockRequestHeaders } from './mock-headers';
import { request as httpRequest, IncomingMessage, Server } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { Request, Response } from 'express';
import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { WebSocketServer, WebSocket } from 'ws';
import { setTimeout as wait } from 'node:timers/promises';
import { MockServerService } from './mock-server.service';
import { MockRuleService } from './mock-rule.service';
import { AccessTokenService } from 'src/access-token/access-token.service';
import { MockRequestGuard } from './mock-request.guard';
import {
  ForwardConfig,
  IncomingMock,
  normalizeIncoming,
  renderMockText,
  compareMockValue,
} from './mock-engine';

export const MAX_RECORD_BYTES = 10 * 1024 * 1024;
const hopHeaders = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'upgrade',
  'keep-alive',
  'trailer',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
]);
export function transportHeaders(
  headers: Record<string, any>,
  response = false,
) {
  const nominated = String(headers.connection ?? '')
    .toLowerCase()
    .split(',')
    .map((v) => v.trim());
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([key, value]) =>
        value !== undefined &&
        !hopHeaders.has(key.toLowerCase()) &&
        !nominated.includes(key.toLowerCase()) &&
        (!response ||
          ![
            'set-cookie',
            'content-disposition',
            'content-security-policy',
            'x-frame-options',
            'x-content-type-options',
          ].includes(key.toLowerCase())),
    ),
  );
}
export function recordedBody(bytes: Buffer, contentType = '') {
  const text = bytes.toString('utf8');
  return /^(text\/|application\/(json|[^;]+\+json|xml|javascript|x-www-form-urlencoded))/.test(
    contentType,
  ) ||
    (Buffer.from(text).equals(bytes) && !text.includes('\0'))
    ? text
    : { encoding: 'base64', data: bytes.toString('base64') };
}
export function forwardTarget(
  config: ForwardConfig,
  request: IncomingMock,
  params: Record<string, string> = {},
) {
  const target = new URL(config.url);
  const path = config.path
    ? renderMockText(config.path, request, params)
    : request.path;
  if (!path.startsWith('/') || path.startsWith('//') || /[\r\n#]/.test(path))
    throw new Error('Invalid upstream path');
  const rewritten = new URL(path, 'http://mock.local');
  target.pathname = `${target.pathname.replace(/\/$/, '')}${rewritten.pathname}`;
  for (const [key, value] of rewritten.searchParams)
    target.searchParams.append(key, value);
  if (config.preserveQuery)
    for (const [key, value] of Object.entries(request.query))
      for (const entry of Array.isArray(value) ? value : [value])
        target.searchParams.append(key, String(entry));
  return target;
}
export async function proxyMock(
  req: Request,
  res: Response,
  config: ForwardConfig,
  incoming: IncomingMock,
  params: Record<string, string> = {},
  recording = false,
) {
  const depth = Number(req.headers['x-apirequest-mock-hop'] ?? 0);
  if (!Number.isSafeInteger(depth) || depth < 0 || depth >= 3) {
    res.status(508).json({ message: 'Mock forwarding loop detected' });
    return;
  }
  const target = forwardTarget(config, incoming, params);
  const headers = transportHeaders(
    mockRequestHeaders(
      Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [
          k,
          Array.isArray(v) ? v.join(', ') : (v ?? ''),
        ]),
      ),
    ),
  );
  for (const name of config.removeHeaders) delete headers[name.toLowerCase()];
  delete headers['x-api-key'];
  Object.assign(
    headers,
    Object.fromEntries(
      Object.entries(config.headers).map(([k, v]) => [
        k,
        renderMockText(v, incoming, params),
      ]),
    ),
    { 'x-apirequest-mock-hop': String(depth + 1) },
  );
  const body =
    (req as any).rawBody ??
    (req.body == null
      ? Buffer.alloc(0)
      : Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(
            typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
          ));
  const abort = new AbortController();
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, config.timeoutMs);
  const cancel = () => {
    if (!res.writableFinished) abort.abort();
  };
  res.once('close', cancel);
  const chunks: Buffer[] = [];
  let bytes = 0;
  let truncated = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const upstream = (
        target.protocol === 'https:' ? httpsRequest : httpRequest
      )(
        target,
        { method: config.method || req.method, headers, signal: abort.signal },
        async (reply) => {
          try {
            res.status(reply.statusCode ?? 502);
            for (const [key, value] of Object.entries(
              transportHeaders(reply.headers, true),
            ))
              res.setHeader(key, value as any);
            if (reply.headers['set-cookie']?.length)
              res.append(
                'set-cookie',
                scopedMockCookies(
                  reply.headers['set-cookie'],
                  (req as any).isSubdomainAccess
                    ? undefined
                    : `/mock/${(req as any).mockServer?.subdomain ?? req.path.split('/')[2]}`,
                ),
              );
            const type = String(res.getHeader('content-type') ?? '')
              .split(';')[0]
              .toLowerCase();
            if (
              !(req as any).isSubdomainAccess &&
              (/^(text\/(html|xml|javascript|xsl)|application\/(javascript|xhtml\+xml|xml)|image\/svg\+xml)$/.test(
                type,
              ) ||
                type.endsWith('+xml'))
            )
              res.setHeader('content-type', 'text/plain');
            res.setHeader('x-content-type-options', 'nosniff');
            if (!(req as any).isSubdomainAccess)
              res.setHeader(
                'content-security-policy',
                "default-src 'none'; sandbox",
              );
            res.locals.mockMatch = {
              ...res.locals.mockMatch,
              upstream: target.toString(),
              recorded: recording,
            };
            const capture = new Transform({
              transform(chunk: Buffer, _encoding, done) {
                if (recording) {
                  if (bytes + chunk.length <= MAX_RECORD_BYTES)
                    chunks.push(Buffer.from(chunk));
                  else truncated = true;
                  bytes += chunk.length;
                }
                done(null, chunk);
              },
              flush(done) {
                if (recording)
                  res.locals.mockResponseBody = reply.headers[
                    'content-encoding'
                  ]
                    ? {
                        encoding: 'base64',
                        data: Buffer.concat(chunks).toString('base64'),
                      }
                    : recordedBody(
                        Buffer.concat(chunks),
                        String(reply.headers['content-type'] ?? ''),
                      );
                res.locals.mockMatch = {
                  ...res.locals.mockMatch,
                  bodyTruncated: truncated,
                  encoded: !!reply.headers['content-encoding'],
                };
                done();
              },
            });
            await pipeline(reply, capture, res, { signal: abort.signal });
            resolve();
          } catch (error) {
            reject(error);
          }
        },
      );
      upstream.setTimeout(config.timeoutMs, () =>
        upstream.destroy(new Error('Upstream timed out')),
      );
      upstream.on('error', reject);
      upstream.end(body);
    });
  } catch (error) {
    if (
      (!abort.signal.aborted || timedOut) &&
      !res.headersSent &&
      !res.destroyed
    )
      res
        .status(
          timedOut || String((error as Error).message).includes('timed out')
            ? 504
            : 502,
        )
        .json({ message: (error as Error).message });
    else if (!res.destroyed) res.destroy();
  } finally {
    clearTimeout(deadline);
    res.off('close', cancel);
  }
}

@Injectable()
export class MockTransportService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private server?: Server;
  private upgradeWrappers: {
    original: (...args: any[]) => void;
    wrapped: (...args: any[]) => void;
  }[] = [];
  private ws = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
    perMessageDeflate: false,
  });
  constructor(
    private readonly adapter: HttpAdapterHost,
    private readonly rules: MockRuleService,
    private readonly servers: MockServerService,
    private readonly access: AccessTokenService,
    private readonly config: ConfigService,
  ) {
    this.ws.on('headers', (headers, request) => {
      for (const value of (request as any).mockCookies ?? [])
        headers.push(`Set-Cookie: ${value}`);
    });
  }
  onApplicationBootstrap() {
    this.server = this.adapter.httpAdapter.getHttpServer();
    // GraphQL's ws server also listens on this HTTP server. Its path rejection must not close Mock sockets.
    for (const original of this.server?.listeners('upgrade') ?? []) {
      this.server!.off('upgrade', original as any);
      const wrapped = (...args: any[]) => {
        if (!args[0].url?.startsWith('/mock/'))
          (original as any).apply(this.server, args);
      };
      this.upgradeWrappers.push({ original: original as any, wrapped });
      this.server!.on('upgrade', wrapped);
    }
    this.server?.on('upgrade', this.upgrade);
  }
  onModuleDestroy() {
    this.server?.off('upgrade', this.upgrade);
    for (const { original, wrapped } of this.upgradeWrappers) {
      this.server?.off('upgrade', wrapped);
      this.server?.on('upgrade', original);
    }
    this.upgradeWrappers = [];
    for (const client of this.ws.clients) client.terminate();
    this.ws.close();
  }
  private upgrade = (request: IncomingMessage, socket: any, head: Buffer) => {
    if (!request.url?.startsWith('/mock/')) return;
    void this.accept(request, socket, head).catch(() => {
      if (!socket.destroyed)
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    });
  };
  private async accept(raw: IncomingMessage, socket: any, head: Buffer) {
    const url = new URL(raw.url!, 'http://mock.local');
    const host = String(raw.headers.host ?? '')
      .split(':')[0]
      .split('.');
    const subdomain =
      (host[1] === 'mock' && host.length >= 3) ||
      (host.length === 2 && host[1] === 'localhost')
        ? host[0]
        : url.pathname.split('/')[2];
    const found = await this.servers.getMockServerBySubdomain(subdomain, true);
    if (found._tag === 'Left') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    const server = found.right;
    if (!server.ruleSet || server.collectionID) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    if (!server.isActive) {
      socket.end(
        'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n',
      );
      return;
    }
    if (!server.isPublic) {
      const token = await this.access.getUserPAT(
        String(raw.headers['x-api-key'] ?? ''),
      );
      if (
        token._tag === 'Left' ||
        token.right.user.uid !== server.workspaceID ||
        (token.right.expiresOn && new Date(token.right.expiresOn) < new Date())
      ) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return;
      }
    }
    const request = normalizeIncoming({
      method: 'GET',
      path:
        MockRequestGuard.getCleanPath(url.pathname, server.subdomain) +
        url.search,
      headers: mockRequestHeaders(
        Object.fromEntries(
          Object.entries(raw.headers).map(([k, v]) => [
            k,
            Array.isArray(v) ? v.join(', ') : (v ?? ''),
          ]),
        ),
      ),
      protocol: 'websocket',
      secure:
        !!(raw.socket as any).encrypted ||
        (this.config.get('TRUST_PROXY') === 'true' &&
          String(raw.headers['x-forwarded-proto'] ?? '')
            .split(',')[0]
            .trim()
            .toLowerCase() === 'https'),
    });
    const selected = await this.rules.match(server.id, request);
    if (
      !selected ||
      !('rule' in selected) ||
      selected.step.action !== 'websocket'
    ) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    if (socket.destroyed) return;
    (raw as any).mockCookies = scopedMockCookies(
      selected.step.cookies ?? [],
      `/mock/${server.subdomain}`,
    );
    this.ws.handleUpgrade(raw, socket, head, (client) => {
      const step = {
          ...selected.step,
          delayMs: selected.step.delayMs ?? server.delayInMs,
        },
        config = step.websocket!;
      const started = Date.now();
      const messages: any[] = [];
      let logged = false;
      const track = (direction: string, data: string, binary = false) => {
        if (messages.length < 200)
          messages.push({
            direction,
            data: binary
              ? Buffer.from(data, 'base64')
                  .subarray(0, 65536)
                  .toString('base64')
              : Buffer.from(data).subarray(0, 65536).toString('utf8'),
            binary,
            encoding: binary ? 'base64' : 'utf8',
            truncated: Buffer.byteLength(data) > 65536,
            time: Date.now(),
          });
      };
      const send = async (
        values: (string | { type: 'binary'; data: string })[],
        message = '',
      ) => {
        for (const [index, value] of values.entries()) {
          if (index && step.intervalMs) await wait(step.intervalMs);
          if (client.readyState !== WebSocket.OPEN) return;
          const binary = typeof value !== 'string';
          const data = binary ? value.data : value;
          const rendered = step.template
            ? renderMockText(data, request, selected.params, {
                message,
                messageBase64: message,
              })
            : data;
          await new Promise<void>((resolve, reject) =>
            client.send(
              binary ? Buffer.from(rendered, 'base64') : rendered,
              { binary },
              (error) => (error ? reject(error) : resolve()),
            ),
          );
          track('sent', rendered, binary);
        }
      };
      const log = () => {
        if (logged) return;
        logged = true;
        void this.servers.logRequest({
          mockServerID: server.id,
          requestMethod: 'GET',
          requestPath: request.path,
          requestHeaders: request.headers,
          requestQuery: request.query as any,
          responseStatus: 101,
          responseHeaders: {},
          responseBody: messages,
          responseTime: Date.now() - started,
          executedAt: new Date(started),
          mockMatch: {
            ruleID: selected.rule.id,
            name: selected.rule.name,
            hit: selected.hit,
            step: selected.stepNumber,
            action: 'websocket',
          },
        });
      };
      client.on('close', log);
      client.on('error', log);
      let chain = Promise.resolve();
      let pending = 0;
      client.on('message', (data, binary) => {
        if (++pending > 100) {
          client.close(1008, 'Too many pending messages');
          return;
        }
        const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
        const message = bytes.toString(binary ? 'base64' : 'utf8');
        track('received', message, binary);
        chain = chain
          .then(async () => {
            const matcher = config.matchers.find(
              (v) =>
                ((v.type ?? 'text') === 'any' ||
                  (v.type ?? 'text') === (binary ? 'binary' : 'text')) &&
                (v.operator === 'any' ||
                  (binary && v.operator === 'contains'
                    ? bytes.includes(Buffer.from(v.value, 'base64'))
                    : compareMockValue(message, v.operator, v.value))),
            );
            if (matcher) {
              await send(matcher.replies, message);
              if (matcher.close && client.readyState === WebSocket.OPEN)
                client.close(config.closeCode);
            }
          })
          .catch(() => client.close(1011, 'Mock response failed'))
          .finally(() => {
            pending--;
          });
      });
      chain = chain
        .then(async () => {
          if (step.delayMs) await wait(step.delayMs);
          await send(config.messages);
          if (step.disconnectAfter && client.readyState === WebSocket.OPEN)
            client.close(config.closeCode);
        })
        .catch(() => client.close(1011, 'Mock response failed'));
    });
  }
  async test(id: string, uid: string, input: any) {
    await this.rules.state(id, uid);
    const request = normalizeIncoming(input.request ?? input);
    const found = await this.servers.getMockServer(id, uid);
    if (found._tag === 'Left') throw new Error('Mock service not found');
    const url = new URL(
      `http://127.0.0.1:${this.config.get('PORT') || 3170}/mock/${found.right.subdomain}${request.path}`,
    );
    for (const [key, value] of Object.entries(request.query))
      for (const entry of Array.isArray(value) ? value : [value])
        url.searchParams.append(key, String(entry));
    return this.call(
      url,
      request.method,
      transportHeaders(request.headers),
      request.rawBody ??
        (request.body == null
          ? ''
          : typeof request.body === 'string'
            ? request.body
            : JSON.stringify(request.body)),
    );
  }
  private call(
    url: URL,
    method: string,
    headers: Record<string, any>,
    body: string | Buffer,
  ) {
    return new Promise((resolve, reject) => {
      const call = httpRequest(url, { method, headers }, (reply) => {
        const chunks: Buffer[] = [];
        let size = 0;
        reply.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_RECORD_BYTES) {
            call.destroy(new Error('Replay response exceeds 10 MiB'));
            return;
          }
          chunks.push(chunk);
        });
        reply.on('error', reject);
        reply.on('end', () =>
          resolve({
            status: reply.statusCode,
            headers: reply.headers,
            body: recordedBody(
              Buffer.concat(chunks),
              String(reply.headers['content-type'] ?? ''),
            ),
          }),
        );
      });
      call.setTimeout(120000, () =>
        call.destroy(new Error('Request timed out')),
      );
      call.on('error', reject);
      call.end(['GET', 'HEAD'].includes(method) ? undefined : body);
    });
  }
  async replay(id: string, uid: string, logID: string) {
    const log = await this.rules.log(id, uid, logID);
    if ((log.mockMatch as any)?.requestTruncated || log.responseStatus === 101)
      throw new Error('This request cannot be replayed as HTTP');
    const server = await this.servers.getMockServer(id, uid);
    if (server._tag === 'Left') throw new Error('Mock service not found');
    const url = new URL(
      `http://127.0.0.1:${this.config.get('PORT') || 3170}/mock/${server.right.subdomain}${log.requestPath}`,
    );
    for (const [key, value] of Object.entries(log.requestQuery ?? {}))
      for (const entry of Array.isArray(value) ? value : [value])
        url.searchParams.append(key, String(entry));
    const headers = transportHeaders(log.requestHeaders as any);
    const body = (log.mockMatch as any)?.rawRequestBase64
      ? Buffer.from((log.mockMatch as any).rawRequestBase64, 'base64')
      : Buffer.from(
          log.requestBody == null
            ? ''
            : typeof log.requestBody === 'string'
              ? log.requestBody
              : JSON.stringify(log.requestBody),
        );
    return this.call(url, log.requestMethod, headers, body);
  }
}
