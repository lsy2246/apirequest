import { resolveMockAction, scopedMockCookies } from './mock-actions';
import { mockRequestHeaders } from './mock-headers';
import {
  Controller,
  All,
  Req,
  Res,
  HttpStatus,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import { proxyMock } from './mock-transport';
import { IncomingMock } from './mock-engine';
import { MockServerService } from './mock-server.service';
import { MockRuleService, sseEvents } from './mock-rule.service';
import { MockServerLoggingInterceptor } from './mock-server-logging.interceptor';
import * as E from 'fp-ts/Either';
import { MockRequestGuard } from './mock-request.guard';
import { MockServer } from 'src/generated/prisma/client';
import { ThrottlerBehindProxyGuard } from 'src/guards/throttler-behind-proxy.guard';

/** Security-sensitive headers that mock responses must not override. */
const SECURITY_HEADER_BLOCKLIST = new Set([
  'content-security-policy',
  'x-content-type-options',
  'x-frame-options',
  'content-disposition',
  'set-cookie',
]);

/** MIME types that can execute scripts and must be downgraded on same-origin (subpath) responses. */
const ACTIVE_CONTENT_TYPES = new Set([
  'application/javascript',
  'application/xhtml+xml',
  'application/xml',
  'image/svg+xml',
  'text/html',
  'text/javascript',
  'text/xml',
  'text/xsl',
]);

/**
 * Mock server controller with dual routing support:
 * 1. Subdomain pattern: mock-server-id.mock.hopp.io/product
 * 2. Route pattern: backend.hopp.io/mock/mock-server-id/product
 *
 * The MockRequestGuard handles extraction of mock server ID from both patterns
 * The MockServerLoggingInterceptor handles logging of all requests
 */
@UseGuards(ThrottlerBehindProxyGuard)
@Controller({ path: 'mock' })
export class MockServerController {
  constructor(
    private readonly mockServerService: MockServerService,
    private readonly mockRuleService: MockRuleService,
  ) {}

  @All('*path')
  @UseGuards(MockRequestGuard)
  @UseInterceptors(MockServerLoggingInterceptor)
  async handleMockRequest(@Req() req: Request, @Res() res: Response) {
    // Mock server ID and info are attached by the guard
    const mockServerId = (req as any).mockServerId as string;
    const mockServer = (req as any).mockServer as MockServer;
    const isSubdomainAccess = (req as any).isSubdomainAccess === true;

    if (!mockServerId) {
      return res.status(HttpStatus.NOT_FOUND).json({
        error: 'Not found',
        message: 'Mock server ID not found',
      });
    }

    const method = req.method;
    // Get clean path (removes /mock/mock-server-id prefix for route-based pattern)
    const path = MockRequestGuard.getCleanPath(
      req.path || '/',
      mockServer.subdomain,
    );

    // Extract query parameters
    const queryParams = req.query as Record<string, string>;

    // Extract request headers (convert to lowercase for case-insensitive matching)
    const requestHeaders: Record<string, string> = {};
    Object.keys(req.headers).forEach((key) => {
      const value = req.headers[key];
      if (typeof value === 'string') {
        requestHeaders[key.toLowerCase()] = value;
      } else if (Array.isArray(value)) {
        requestHeaders[key.toLowerCase()] = value[0];
      }
    });

    if(!mockServer.ruleSet || mockServer.collectionID) return res.status(HttpStatus.NOT_FOUND).json({error:'Mock service not found'});
    try {
      const parsedBody = Buffer.isBuffer(req.body)
        ? req.body.toString('utf8')
        : req.body === undefined
          ? ''
          : req.body;
      const incoming: IncomingMock = {
        path,
        method,
        query: queryParams,
        headers: mockRequestHeaders(requestHeaders),
        body: parsedBody,
        protocol: 'http',
        secure: req.secure,
      };
      const outcome = mockServer.ruleSet
        ? await this.mockRuleService.match(mockServerId, incoming)
        : null;
      if (outcome && 'stopped' in outcome) {
        return res
          .status(HttpStatus.SERVICE_UNAVAILABLE)
          .json({ message: 'Mock server is stopped' });
      }
      const selection = outcome && 'rule' in outcome ? outcome : null;
      if (selection) {
        res.locals.mockMatch = {
          ruleID: selection.rule.id,
          name: selection.rule.name || selection.rule.path,
          step: selection.stepNumber,
          hit: selection.hit,
          delayMs: selection.step.delayMs ?? mockServer.delayInMs,
          action: selection.step.action,
          trace: selection.trace,
        };
      } else if (mockServer.ruleSet) {
        res.locals.mockMatch = {
          unmatched: true,
          trace: outcome && 'trace' in outcome ? outcome.trace : [],
        };
      }
      if (
        selection?.step.action === 'forward' &&
        selection.step.cookies?.length
      )
        res.setHeader(
          'Set-Cookie',
          scopedMockCookies(
            selection.step.cookies,
            isSubdomainAccess ? undefined : `/mock/${mockServer.subdomain}`,
          ),
        );
      if (outcome && 'options' in outcome) {
        res.locals.mockRecording = outcome.options.recording === true;
        const forward =
          selection?.step.action === 'forward'
            ? selection.step.forward
            : !selection
              ? outcome.options.fallback
              : undefined;
        if (forward) {
          const forwardDelay = selection?.step.delayMs ?? mockServer.delayInMs;
          if (forwardDelay > 0) await wait(forwardDelay);
          if (res.destroyed) return;
          return proxyMock(
            req,
            res,
            forward,
            incoming,
            selection?.params ?? {},
            outcome.options.recording === true,
          );
        }
      }
      if (selection) {
        try {
          selection.step = await resolveMockAction(
            selection.step,
            incoming,
            selection.params,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          res.locals.mockMatch.error = message;
          return res
            .status(HttpStatus.BAD_GATEWAY)
            .json({ error: 'Mock response action failed', message });
        }
      }
      if (selection?.step.cookies?.length)
        res.setHeader(
          'Set-Cookie',
          scopedMockCookies(
            selection.step.cookies,
            isSubdomainAccess ? undefined : `/mock/${mockServer.subdomain}`,
          ),
        );
      const result = selection ? E.right({
        statusCode: selection.step.statusCode,body:selection.step.body,headers:JSON.stringify(selection.step.headers),delay:selection.step.delayMs??mockServer.delayInMs,
      }) : E.left(`No matching Mock rule for ${method} ${path}`);

      if (E.isLeft(result)) {
        return res.status(HttpStatus.NOT_FOUND).json({
          error: 'Endpoint not found',
          message: result.left,
        });
      }

      const mockResponse = result.right;

      // Set response headers if any, but exclude security-sensitive headers
      // that could be abused for XSS
      if (mockResponse.headers) {
        try {
          const headers = JSON.parse(mockResponse.headers);
          if (
            headers !== null &&
            typeof headers === 'object' &&
            !Array.isArray(headers)
          ) {
            Object.keys(headers).forEach((key) => {
              if (!SECURITY_HEADER_BLOCKLIST.has(key.toLowerCase())) {
                const rawValue = headers[key];
                // Only allow string and number values to prevent type bypass attacks
                if (
                  typeof rawValue === 'string' ||
                  typeof rawValue === 'number'
                ) {
                  res.setHeader(key, String(rawValue));
                }
              }
            });
          }
        } catch (error) {
          console.error('Error parsing response headers:', error);
        }
      }

      const delay = mockResponse.delay;
      const file =
        selection?.step.action === 'file' ? selection.step.file : undefined;
      if (file) {
        res.setHeader('Content-Type', file.contentType);
        const activeContent =
          ACTIVE_CONTENT_TYPES.has(file.contentType) ||
          file.contentType.endsWith('+xml');
        const disposition =
          !isSubdomainAccess && activeContent ? 'attachment' : file.disposition;
        const fallback = file.name.replace(/[^\x20-\x7e]|["\\]/g, '_');
        const encoded = encodeURIComponent(file.name).replace(
          /[!'()*]/g,
          (character) =>
            `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
        );
        res.setHeader(
          'Content-Disposition',
          `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`,
        );
      }

      // Prevent XSS on path-based (same-origin) requests by downgrading
      // script-capable content types to text/plain.
      // Subdomain-based requests are on a different origin, so HTML is safe.
      if (!isSubdomainAccess) {
        const rawContentType = res.getHeader('Content-Type');
        if (typeof rawContentType === 'string') {
          // Normalize: trim, strip parameters (e.g. charset), lowercase
          const mimeType = rawContentType.split(';')[0].trim().toLowerCase();
          if (ACTIVE_CONTENT_TYPES.has(mimeType) || mimeType.endsWith('+xml')) {
            res.setHeader('Content-Type', 'text/plain');
          }
        }
      }

      // Only set Content-Type if not already set
      if (!res.getHeader('Content-Type')) {
        let defaultContentType = 'text/plain';

        // Check if body is a string and try to parse it to determine content type
        if (typeof mockResponse.body === 'string') {
          try {
            JSON.parse(mockResponse.body);
            // If parsing succeeds, it's JSON
            defaultContentType = 'application/json';
          } catch {
            // If parsing fails, it's plain text
            defaultContentType = 'text/plain';
          }
        } else if (typeof mockResponse.body === 'object') {
          // If it's already an object, it's JSON
          defaultContentType = 'application/json';
        }

        res.setHeader('Content-Type', defaultContentType);
      }
      // Security headers to prevent XSS via mock responses
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (!isSubdomainAccess) {
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.setHeader('X-Frame-Options', 'DENY');
      }

      // 断开时取消等待和后续事件，命中进度已在返回响应前提交。
      const abort = new AbortController();
      const cancel = () => abort.abort();
      res.once('close', cancel);
      try {
        if (res.destroyed) return;
        if (delay > 0) await wait(delay, undefined, { signal: abort.signal });
        if (selection?.step.action === 'disconnect') {
          res.destroy();
          return;
        }
        if (selection?.step.action === 'sse') {
          res
            .status(200)
            .setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          if (method === 'HEAD') return res.end();
          res.flushHeaders();
          const events = sseEvents(selection.step.body);
          for (const [index, event] of events.entries()) {
            if (index && selection.step.intervalMs)
              await wait(selection.step.intervalMs, undefined, {
                signal: abort.signal,
              });
            if (!res.write(event + '\n\n'))
              await once(res, 'drain', { signal: abort.signal });
          }
          if (selection.step.disconnectAfter) res.destroy();
          else res.end();
          return;
        }
        return res
          .status(mockResponse.statusCode)
          .send(file ? Buffer.from(file.data, 'base64') : mockResponse.body);
      } catch (error) {
        if (!abort.signal.aborted) throw error;
      } finally {
        res.off('close', cancel);
      }
    } catch (error) {
      console.error('Error handling mock request:', error);
      if (res.headersSent || res.destroyed) {
        res.destroy();
        return;
      }
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'Internal server error',
        message: 'Failed to process mock request',
      });
    }
  }
}
