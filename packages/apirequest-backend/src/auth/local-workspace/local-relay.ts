import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { fetch, type Dispatcher } from 'undici';
import { createLocalRelayDispatcher } from './local-relay-settings';

const blockedMethods = new Set(['CONNECT', 'TRACE', 'TRACK']);
const httpToken = /^[!#$%&'*+.^_\x60|~0-9a-z-]+$/i;
const framingHeaders = [
  'connection',
  'content-length',
  'expect',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];
const maxBytes = 32 * 1024 * 1024;
let activeRequests = 0;

export async function relayLocalRequest(
  input: unknown,
  response: Response,
  stream = false,
) {
  if (!input || typeof input !== 'object') throw new BadRequestException();
  const {
    url,
    method,
    headers,
    data,
    timeout,
    followRedirects,
    security,
    proxy,
  } = input as Record<string, unknown>;
  let target: URL;
  try {
    if (typeof url !== 'string') throw new Error();
    target = new URL(url);
  } catch {
    throw new BadRequestException('Invalid target URL');
  }
  if (
    !['http:', 'https:'].includes(target.protocol) ||
    target.username ||
    target.password ||
    typeof method !== 'string' ||
    !httpToken.test(method) ||
    blockedMethods.has(method.toUpperCase()) ||
    (data !== undefined && typeof data !== 'string')
  )
    throw new BadRequestException('Invalid HTTP request');
  if (typeof data === 'string' && data.length > 4 * Math.ceil(maxBytes / 3))
    throw new PayloadTooLargeException('Request body exceeds 32 MiB');

  const body =
    typeof data === 'string' ? Buffer.from(data, 'base64') : undefined;
  if (body && body.byteLength > maxBytes)
    throw new PayloadTooLargeException('Request body exceeds 32 MiB');
  const requestHeaders = new Headers();
  if (headers !== undefined) {
    if (!headers || typeof headers !== 'object' || Array.isArray(headers))
      throw new BadRequestException('Invalid request headers');
    try {
      for (const [name, value] of Object.entries(headers)) {
        if (typeof value !== 'string') throw new Error();
        requestHeaders.append(name, value);
      }
    } catch {
      throw new BadRequestException('Invalid request headers');
    }
  }
  for (const value of requestHeaders.get('connection')?.split(',') ?? []) {
    const name = value.trim();
    if (httpToken.test(name)) requestHeaders.delete(name);
  }
  for (const name of framingHeaders) requestHeaders.delete(name);

  if (activeRequests >= 32)
    throw new ServiceUnavailableException('Local relay is busy');
  activeRequests++;
  const cancel = new AbortController();
  const limit =
    typeof timeout === 'number' && Number.isInteger(timeout) && timeout > 0
      ? Math.min(timeout, 300_000)
      : 120_000;
  const deadline = AbortSignal.timeout(limit);
  const disconnect = () => cancel.abort();
  response.once('close', disconnect);
  if (response.destroyed) disconnect();

  let dispatcher: Dispatcher | undefined;
  try {
    const signal = AbortSignal.any([cancel.signal, deadline]);
    dispatcher = createLocalRelayDispatcher(security, proxy, signal);
    // 只转发请求编辑器里的头部。工作台会话、请求地址和响应数据不写入日志。
    // 浏览器取消时中止上游读取。每次点击只发起一次请求。
    const upstream = await fetch(target, {
      method,
      headers: Object.fromEntries(requestHeaders),
      body: ['GET', 'HEAD'].includes(method.toUpperCase()) ? undefined : body,
      signal,
      dispatcher,
      redirect: followRedirects === false ? 'manual' : 'follow',
    });
    const metadata = {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: Object.fromEntries(upstream.headers),
    };
    if (stream) {
      // 新工作台流式接收原始字节，避免大文件经过 Base64 放大及旧 JSON 转发的缓冲上限。
      response.type('application/x-workbench-relay');
      response.write(JSON.stringify(metadata) + '\n');
      if (upstream.body) await pipeline(upstream.body, response);
      else response.end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of upstream.body ?? []) {
      size += chunk.byteLength;
      if (size > maxBytes)
        throw new PayloadTooLargeException('Response body exceeds 32 MiB');
      chunks.push(Buffer.from(chunk));
    }

    // 用 JSON 包裹上游响应，防止目标的脚本和 Set-Cookie 在工作台来源生效。
    return {
      ...metadata,
      data: Buffer.concat(chunks, size).toString('base64'),
    };
  } catch (error) {
    if (stream && (response.headersSent || response.destroyed)) {
      response.destroy();
      return;
    }
    if (
      error instanceof PayloadTooLargeException ||
      error instanceof BadRequestException
    )
      throw error;
    if (deadline.aborted)
      throw new GatewayTimeoutException('Target request timed out');
    const cause = error instanceof Error && error.cause ? error.cause : error;
    const code =
      cause &&
      typeof cause === 'object' &&
      'code' in cause &&
      typeof cause.code === 'string' &&
      /^[A-Z0-9_]+$/.test(cause.code)
        ? cause.code
        : undefined;
    const certificateFailure = code && /CERT|TLS|SSL/.test(code);
    throw new BadGatewayException({
      message: certificateFailure
        ? 'TLS certificate validation failed'
        : 'Could not reach target API',
      kind: certificateFailure ? 'certificate' : 'network',
      code,
    });
  } finally {
    cancel.abort();
    response.off('close', disconnect);
    activeRequests--;
    await dispatcher?.destroy();
  }
}
