import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as httpServer, type Server } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { createServer as tcpServer, connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetch } from 'undici';
import { createLocalRelayDispatcher } from './local-relay-settings';

describe('local web request connection settings', () => {
  const servers: (Server | ReturnType<typeof tcpServer>)[] = [];
  const sockets = new Set<Socket>();
  let directory: string;
  let tlsURL: string;
  let mtlsURL: string;
  let httpURL: string;
  let proxyURL: string;
  let socksURL: string;
  let ca: string;
  let client: { kind: string; cert: string; key: string };
  let pfx: string;
  let proxyAuthorization: string | undefined;
  let originAuthorization: string | undefined;
  let socksCredentials: string;

  function track(socket: Socket) {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    return socket;
  }

  async function listen(server: (typeof servers)[number]) {
    servers.push(server);
    server.on('connection', track);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    return (server.address() as { port: number }).port;
  }

  function makeCertificate(name: string) {
    const key = join(directory, `${name}.key`);
    const cert = join(directory, `${name}.crt`);
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-days',
        '1',
        '-subj',
        `/CN=${name}`,
        '-addext',
        'subjectAltName=IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    );
    return { key: readFileSync(key), cert: readFileSync(cert) };
  }

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'apirequest-relay-test-'));
    const serverCertificate = makeCertificate('server');
    const clientCertificate = makeCertificate('client');
    ca = serverCertificate.cert.toString('base64');
    client = {
      kind: 'pem',
      cert: clientCertificate.cert.toString('base64'),
      key: clientCertificate.key.toString('base64'),
    };
    execFileSync(
      'openssl',
      [
        'pkcs12',
        '-export',
        '-in',
        join(directory, 'client.crt'),
        '-inkey',
        join(directory, 'client.key'),
        '-out',
        join(directory, 'client.p12'),
        '-passout',
        'pass:test-password',
        '-keypbe',
        'AES-256-CBC',
        '-certpbe',
        'AES-256-CBC',
        '-macalg',
        'sha256',
      ],
      { stdio: 'ignore' },
    );
    pfx = readFileSync(join(directory, 'client.p12')).toString('base64');
    const response = (request, result) => {
      if (request.url === '/redirect') {
        result.writeHead(302, { location: '/connected' });
        result.end();
        return;
      }
      originAuthorization = request.headers['proxy-authorization'];
      result.end('connected');
    };
    tlsURL = `https://127.0.0.1:${await listen(httpsServer(serverCertificate, response))}`;
    mtlsURL = `https://127.0.0.1:${await listen(httpsServer({ ...serverCertificate, ca: clientCertificate.cert, requestCert: true, rejectUnauthorized: true }, response))}`;
    httpURL = `http://127.0.0.1:${await listen(httpServer(response))}`;

    const proxy = httpServer();
    proxy.on('connect', (request, socket, head) => {
      track(socket);
      proxyAuthorization = request.headers['proxy-authorization'];
      if (proxyAuthorization !== 'Basic dXNlcjpwYXNz') {
        socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
        return;
      }
      const target = new URL(`http://${request.url}`);
      const upstream = track(
        connect(Number(target.port), target.hostname, () => {
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.length) upstream.write(head);
          socket.pipe(upstream).pipe(socket);
        }),
      );
      socket.on('close', () => upstream.destroy());
    });
    proxyURL = `http://127.0.0.1:${await listen(proxy)}`;

    const socks = tcpServer((socket) => {
      let pending = Buffer.alloc(0);
      let stage = 'greeting';
      socket.on('data', function receive(chunk) {
        pending = Buffer.concat([pending, chunk]);
        if (stage === 'greeting') {
          if (pending.length < 2 || pending.length < pending[1] + 2) return;
          pending = pending.subarray(pending[1] + 2);
          socket.write(Buffer.from([5, 2]));
          stage = 'auth';
        }
        if (stage === 'auth') {
          if (pending.length < 2 || pending.length < pending[1] + 3) return;
          const length = pending[1];
          const passwordLength = pending[2 + length];
          if (pending.length < 3 + length + passwordLength) return;
          socksCredentials = `${pending.subarray(2, 2 + length)}:${pending.subarray(3 + length, 3 + length + passwordLength)}`;
          pending = pending.subarray(3 + length + passwordLength);
          socket.write(Buffer.from([1, 0]));
          stage = 'connect';
        }
        if (stage === 'connect') {
          if (pending.length < 5) return;
          const length = pending[3] === 1 ? 4 : pending[4];
          const start = pending[3] === 1 ? 4 : 5;
          if (pending.length < start + length + 2) return;
          const host =
            pending[3] === 1
              ? [...pending.subarray(start, start + length)].join('.')
              : pending.subarray(start, start + length).toString();
          const port = pending.readUInt16BE(start + length);
          const extra = pending.subarray(start + length + 2);
          stage = 'connected';
          socket.removeListener('data', receive);
          const upstream = track(
            connect(port, host, () => {
              socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
              if (extra.length) upstream.write(extra);
              socket.pipe(upstream).pipe(socket);
            }),
          );
          socket.on('close', () => upstream.destroy());
        }
      });
    });
    socksURL = `socks5://127.0.0.1:${await listen(socks)}`;
  }, 20_000);

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
    rmSync(directory, { recursive: true, force: true });
  });

  async function request(url: string, security?: unknown, proxy?: unknown) {
    const signal = AbortSignal.timeout(3000);
    const dispatcher = createLocalRelayDispatcher(security, proxy, signal);
    try {
      const result = await fetch(url, { dispatcher, signal });
      return { status: result.status, body: await result.text() };
    } finally {
      await dispatcher.destroy();
    }
  }

  it('keeps certificate verification enabled by default', async () => {
    await expect(request(tlsURL)).rejects.toThrow();
    await expect(request(httpURL)).resolves.toEqual({
      status: 200,
      body: 'connected',
    });
  });

  it('uses uploaded CA data without changing global trust', async () => {
    await expect(
      request(tlsURL, { certificates: { ca: [ca] } }),
    ).resolves.toHaveProperty('status', 200);
    await expect(request(tlsURL)).rejects.toThrow();
  });

  it('verifies hostnames even when peer validation is disabled', async () => {
    const wrongHost = tlsURL.replace('127.0.0.1', 'localhost');
    await expect(
      request(tlsURL, { verifyPeer: false, verifyHost: true }),
    ).resolves.toHaveProperty('status', 200);
    await expect(
      request(wrongHost, { verifyPeer: false, verifyHost: true }),
    ).rejects.toThrow();
    await expect(
      request(wrongHost, { verifyPeer: false, verifyHost: false }),
    ).resolves.toHaveProperty('status', 200);
    await expect(
      request(wrongHost, {
        verifyPeer: true,
        verifyHost: false,
        certificates: { ca: [ca] },
      }),
    ).resolves.toHaveProperty('status', 200);
  });

  it('supports PEM client certificates and requires them for mutual TLS', async () => {
    await expect(
      request(mtlsURL, { certificates: { ca: [ca] } }),
    ).rejects.toThrow();
    await expect(
      request(mtlsURL, { certificates: { ca: [ca], client } }),
    ).resolves.toHaveProperty('status', 200);
  });

  it('keeps uploaded CA and hostname checks across HTTPS redirects', async () => {
    await expect(
      request(`${tlsURL}/redirect`, { certificates: { ca: [ca] } }),
    ).resolves.toHaveProperty('status', 200);
  });

  it('supports PFX client certificates and their password', async () => {
    await expect(
      request(mtlsURL, {
        certificates: {
          ca: [ca],
          client: { kind: 'pfx', data: pfx, password: 'test-password' },
        },
      }),
    ).resolves.toHaveProperty('status', 200);
  });

  it('uses proxy credentials only on the proxy connection', async () => {
    await expect(
      request(httpURL, undefined, {
        url: proxyURL,
        auth: { username: 'user', password: 'pass' },
      }),
    ).resolves.toHaveProperty('status', 200);
    expect(proxyAuthorization).toBe('Basic dXNlcjpwYXNz');
    expect(originAuthorization).toBeUndefined();
    await expect(
      request(httpURL, undefined, { url: proxyURL }),
    ).rejects.toThrow();
  });

  it('keeps target TLS checks when using an HTTP proxy', async () => {
    const proxy = {
      url: proxyURL,
      auth: { username: 'user', password: 'pass' },
    };
    await expect(
      request(tlsURL, { certificates: { ca: [ca] } }, proxy),
    ).resolves.toHaveProperty('status', 200);
    await expect(
      request(
        tlsURL.replace('127.0.0.1', 'localhost'),
        { verifyPeer: false, verifyHost: true },
        proxy,
      ),
    ).rejects.toThrow();
  });

  it('accepts HTTP proxy credentials embedded and encoded in the URL', async () => {
    const url = new URL(proxyURL);
    url.username = 'u%73er';
    url.password = 'p%61ss';
    await expect(
      request(httpURL, undefined, { url: url.href }),
    ).resolves.toHaveProperty('status', 200);
    expect(proxyAuthorization).toBe('Basic dXNlcjpwYXNz');
    expect(originAuthorization).toBeUndefined();
  });

  it('supports authenticated SOCKS5 and uploaded target CAs', async () => {
    const proxy = {
      url: socksURL,
      auth: { username: 'socks-user', password: 'socks-pass' },
    };
    await expect(
      request(tlsURL, { certificates: { ca: [ca] } }, proxy),
    ).resolves.toHaveProperty('status', 200);
    expect(socksCredentials).toBe('socks-user:socks-pass');
    await expect(
      request(
        tlsURL.replace('127.0.0.1', 'localhost'),
        { verifyPeer: false, verifyHost: true },
        proxy,
      ),
    ).rejects.toThrow();
  });

  it('decodes SOCKS credentials from the URL without separate auth fields', async () => {
    const url = new URL(socksURL);
    url.username = 'socks%40user';
    url.password = 'socks%3Apass';
    await expect(
      request(httpURL, undefined, { url: url.href }),
    ).resolves.toHaveProperty('status', 200);
    expect(socksCredentials).toBe('socks@user:socks:pass');
  });

  it.each([
    [{ verifyPeer: 'false' }, undefined],
    [{ certificates: { ca: ['/etc/ssl/cert.pem'] } }, undefined],
    [{ certificates: { client: { kind: 'pem', cert: ca } } }, undefined],
    [undefined, { url: 'file:///etc/passwd' }],
    [undefined, { url: proxyURL, auth: { password: {} } }],
  ])('rejects malformed connection settings', (security, proxy) => {
    expect(() =>
      createLocalRelayDispatcher(security, proxy, new AbortController().signal),
    ).toThrow();
  });
});
