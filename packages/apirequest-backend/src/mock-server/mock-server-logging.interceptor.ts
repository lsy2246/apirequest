import { mockRequestHeaders } from './mock-headers';
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request, Response } from 'express';
import { MockServer } from 'src/generated/prisma/client';
import { MockServerService } from './mock-server.service';
import { MockRequestGuard } from './mock-request.guard';
import { MAX_RECORD_BYTES, recordedBody } from './mock-transport';

@Injectable()
export class MockServerLoggingInterceptor implements NestInterceptor {
  constructor(private readonly mockServerService: MockServerService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const mockServer = (request as any).mockServer as MockServer;
    const mockServerId = (request as any).mockServerId as string;
    if (!mockServer || !mockServerId) return next.handle();
    const started = Date.now();
    let logged = false,
      bytes = 0,
      truncated = false;
    const chunks: Buffer[] = [];
    const capture = (chunk: any, encoding?: any) => {
      if (chunk == null || response.locals.mockMatch?.upstream) return;
      const value = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(
            chunk,
            typeof encoding === 'string'
              ? (encoding as BufferEncoding)
              : undefined,
          );
      bytes += value.length;
      if (bytes <= MAX_RECORD_BYTES) chunks.push(Buffer.from(value));
      else truncated = true;
    };
    const write = response.write.bind(response),
      end = response.end.bind(response);
    response.write = ((chunk: any, ...args: any[]) => {
      capture(chunk, args[0]);
      return write(chunk, ...args);
    }) as any;
    response.end = ((chunk: any, ...args: any[]) => {
      capture(chunk, args[0]);
      return end(chunk, ...args);
    }) as any;
    const log = () => {
      if (logged) return;
      logged = true;
      const headers = mockRequestHeaders(
        Object.fromEntries(
          Object.entries(request.headers).map(([k, v]) => [
            k,
            Array.isArray(v) ? v.join(', ') : (v ?? ''),
          ]),
        ),
      );
      const responseHeaders = Object.fromEntries(
        Object.entries(response.getHeaders()).map(([k, v]) => [
          k,
          Array.isArray(v) ? v.map(String) : String(v ?? ''),
        ]),
      );
      const raw = (request as any).rawBody as Buffer | undefined;
      const requestTruncated = !!raw && raw.length > MAX_RECORD_BYTES;
      const match = {
        ...response.locals.mockMatch,
        bodyTruncated: truncated || response.locals.mockMatch?.bodyTruncated,
        requestTruncated,
        ...(raw && !requestTruncated
          ? { rawRequestBase64: raw.toString('base64') }
          : {}),
      };
      void this.mockServerService.logRequest({
        mockServerID: mockServerId,
        requestMethod: request.method,
        requestPath: MockRequestGuard.getCleanPath(
          request.path,
          mockServer.subdomain,
        ),
        requestHeaders: headers,
        requestBody: requestTruncated
          ? undefined
          : Buffer.isBuffer(request.body)
            ? request.body.toString('utf8')
            : request.body === undefined
              ? ''
              : request.body,
        requestQuery: request.query as any,
        responseStatus:
          response.destroyed && !response.headersSent ? 0 : response.statusCode,
        responseHeaders,
        responseBody:
          response.locals.mockResponseBody ??
          (response.locals.mockMatch?.upstream
            ? undefined
            : recordedBody(
                Buffer.concat(chunks),
                String(responseHeaders['content-type'] ?? ''),
              )),
        responseTime: Date.now() - started,
        executedAt: new Date(started),
        mockMatch: match,
        ipAddress: request.socket.remoteAddress,
        userAgent: request.get('user-agent'),
      });
      void this.mockServerService
        .incrementHitCount(mockServerId)
        .catch(() => {});
    };
    response.once('finish', log);
    response.once('close', log);
    return next.handle();
  }
}
