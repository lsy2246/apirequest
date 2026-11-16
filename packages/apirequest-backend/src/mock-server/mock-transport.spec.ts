import { createServer, Server } from 'node:http';
import express from 'express';
import request from 'supertest';
import { WebSocket } from 'ws';
import { proxyMock, MockTransportService } from './mock-transport';
import {
  parseForward,
  normalizeIncoming,
  parseMockRules,
  explainMock,
} from './mock-engine';
const listen = (server: Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve((server.address() as any).port),
    ),
  );
const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
describe('Mock network workflows', () => {
  it('forwards raw bytes, repeated query values and overrides without leaking hop headers', async () => {
    let received: any;
    const upstream = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        received = {
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks),
        };
        res.writeHead(201, { 'content-type': 'application/octet-stream' });
        res.end(Buffer.from([0, 255, 1]));
      });
    });
    const port = await listen(upstream);
    const app = express();
    app.use(express.raw({ type: () => true }));
    app.use((req, res) => {
      (req as any).rawBody = req.body;
      void proxyMock(
        req,
        res,
        parseForward({
          url: `http://127.0.0.1:${port}/v2`,
          path: '/rewritten/{{query.id}}',
          headers: { 'x-override': 'new' },
          removeHeaders: ['x-remove'],
        }),
        normalizeIncoming({
          method: req.method,
          path: req.originalUrl,
          headers: {},
          body: null,
        }),
        {},
        true,
      );
    });
    try {
      const reply = await request(app)
        .post('/source?id=7&tag=a&tag=b')
        .set('content-type', 'application/octet-stream')
        .set('x-api-key', 'private')
        .set('x-remove', 'secret')
        .set('x-override', 'old')
        .send(Buffer.from([0, 128, 255]));
      expect(reply.status).toBe(201);
      expect(reply.body).toEqual(Buffer.from([0, 255, 1]));
      expect(received).toMatchObject({
        method: 'POST',
        url: '/v2/rewritten/7?id=7&tag=a&tag=b',
        body: Buffer.from([0, 128, 255]),
      });
      expect(received.headers['x-remove']).toBeUndefined();
      expect(received.headers['x-api-key']).toBeUndefined();
      expect(received.headers['x-override']).toBe('new');
    } finally {
      await close(upstream);
    }
  });
  it('streams SSE and terminates forwarding loops', async () => {
    const upstream = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: first\n\n');
      setTimeout(() => res.end('data: second\n\n'), 20);
    });
    const port = await listen(upstream);
    const app = express();
    app.use((req, res) => {
      void proxyMock(
        req,
        res,
        parseForward({ url: `http://127.0.0.1:${port}` }),
        normalizeIncoming({ path: req.originalUrl }),
        {},
        true,
      );
    });
    try {
      const response = await request(app).get('/stream');
      expect(response.text).toBe('data: first\n\ndata: second\n\n');
      expect(
        (await request(app).get('/stream').set('x-apirequest-mock-hop', '3'))
          .status,
      ).toBe(508);
    } finally {
      await close(upstream);
    }
  });
  it('returns a gateway timeout when the upstream does not respond', async () => {
    const upstream = createServer((_req, res) => {
      const timer = setTimeout(() => res.end('late'), 1000);
      res.once('close', () => clearTimeout(timer));
    });
    const port = await listen(upstream);
    const app = express();
    app.use((req, res) => {
      void proxyMock(
        req,
        res,
        parseForward({ url: `http://127.0.0.1:${port}`, timeoutMs: 100 }),
        normalizeIncoming({ path: '/slow' }),
      );
    });
    try {
      expect((await request(app).get('/slow')).status).toBe(504);
    } finally {
      await close(upstream);
    }
  });
  it.each([
    { binary: false, secure: false },
    { binary: true, secure: false },
    { binary: false, secure: true },
  ])(
    'serves WebSocket pushes, replies and close (binary=$binary, secure=$secure)',
    async ({ binary, secure }) => {
      const rules = parseMockRules([
        {
          id: 'socket-rule',
          name: 'socket',
          path: '/chat',
          method: 'GET',
          secure,
          enabled: true,
          conditions: [],
          exhausted: 'repeat_last',
          steps: [
            {
              action: 'websocket',
              times: 1,
              delayMs: 0,
              intervalMs: 0,
              headers: {},
              websocket: {
                messages: [
                  binary ? { type: 'binary', data: 'AP8=' } : 'connected',
                ],
                matchers: [
                  {
                    operator: 'equals',
                    type: binary ? 'binary' : 'text',
                    value: binary ? 'AQI=' : 'ping',
                    replies: [
                      binary ? { type: 'binary', data: 'AwQ=' } : 'pong',
                    ],
                    close: true,
                  },
                ],
                closeCode: 1000,
              },
            },
          ],
        },
      ]);
      const server = createServer();
      const port = await listen(server);
      let logDone: () => void;
      const logged = new Promise<void>((resolve) => {
        logDone = resolve;
      });
      const recorded = jest.fn(async () => {
        logDone();
      });
      const service = new MockTransportService(
        { httpAdapter: { getHttpServer: () => server } } as any,
        {
          match: async (_id: string, req: any) => ({
            ...explainMock({ revision: 0, rules, hits: {} }, req).selection!,
            trace: [],
          }),
        } as any,
        {
          getMockServerBySubdomain: async () => ({
            _tag: 'Right',
            right: {
              id: 'server',
              subdomain: 'server',
              collectionID: '',
              ruleSet: {},
              isActive: true,
              isPublic: true,
            },
          }),
          logRequest: recorded,
        } as any,
        {} as any,
        {
          get: (key: string) =>
            key === 'TRUST_PROXY' && secure ? 'true' : undefined,
        } as any,
      );
      const graphqlHandler = jest.fn((_req: any, socket: any) =>
        socket.end('HTTP/1.1 404 Not Found\r\n\r\n'),
      );
      server.on('upgrade', graphqlHandler);
      service.onApplicationBootstrap();
      try {
        const messages: string[] = [];
        await new Promise<void>((resolve, reject) => {
          const socket = new WebSocket(
            `ws://127.0.0.1:${port}/mock/server/chat`,
            { headers: { 'x-forwarded-proto': 'https' } },
          );
          socket.on('error', reject);
          socket.on('message', (data, isBinary) => {
            expect(isBinary).toBe(binary);
            messages.push(data.toString(binary ? 'base64' : 'utf8'));
            if (messages.length === 1)
              socket.send(binary ? Buffer.from([1, 2]) : 'ping');
          });
          socket.on('close', (code) => {
            try {
              expect(code).toBe(1000);
              resolve();
            } catch (error) {
              reject(error);
            }
          });
        });
        await logged;
        expect(messages).toEqual(
          binary ? ['AP8=', 'AwQ='] : ['connected', 'pong'],
        );
        expect(graphqlHandler).not.toHaveBeenCalled();
        expect(recorded).toHaveBeenCalledTimes(1);
      } finally {
        service.onModuleDestroy();
        await close(server);
      }
    },
  );
});
