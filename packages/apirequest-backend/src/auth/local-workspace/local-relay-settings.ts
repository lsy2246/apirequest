import { BadRequestException } from '@nestjs/common';
import { once } from 'node:events';
import { connect as connectTCP, type Socket } from 'node:net';
import {
  checkServerIdentity,
  TLSSocket,
  type ConnectionOptions,
} from 'node:tls';
import {
  Agent,
  Pool,
  ProxyAgent,
  buildConnector,
  type Dispatcher,
} from 'undici';
import { SocksClient } from 'socks';

const maxCertificateBytes = 8 * 1024 * 1024;

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('Invalid request connection settings');
  }
  return input as Record<string, unknown>;
}

function optionalBoolean(input: unknown): boolean | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== 'boolean')
    throw new BadRequestException('Invalid TLS verification setting');
  return input;
}

function optionalString(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== 'string' || input.length > 16384) {
    throw new BadRequestException('Invalid connection credential');
  }
  return input;
}

function certificate(input: unknown): Buffer {
  if (
    typeof input !== 'string' ||
    !input.length ||
    input.length > 4 * Math.ceil(maxCertificateBytes / 3) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(input)
  ) {
    throw new BadRequestException('Invalid certificate data');
  }
  const decoded = Buffer.from(input, 'base64');
  if (
    decoded.length > maxCertificateBytes ||
    decoded.toString('base64') !== input
  )
    throw new BadRequestException('Invalid certificate data');
  return decoded;
}

function certificates(input: unknown): ConnectionOptions {
  if (input === undefined) return {};
  const value = record(input);
  const options: ConnectionOptions = {};
  if (value.ca !== undefined) {
    if (!Array.isArray(value.ca) || value.ca.length > 16)
      throw new BadRequestException('Invalid CA certificates');
    if (value.ca.length) options.ca = value.ca.map(certificate);
  }
  if (value.client !== undefined) {
    const client = record(value.client);
    if (client.kind === 'pem') {
      options.cert = certificate(client.cert);
      options.key = certificate(client.key);
    } else if (client.kind === 'pfx') {
      options.pfx = certificate(client.data);
      options.passphrase = optionalString(client.password);
    } else {
      throw new BadRequestException('Invalid client certificate type');
    }
  }
  return options;
}

// Verify the hostname after the handshake as well: Node skips its built-in
// hostname check when the certificate chain is untrusted and peer checks are off.
function verifiedConnector(
  connector: buildConnector.connector,
  verifyHost: boolean,
  signal: AbortSignal,
): buildConnector.connector {
  return (options, callback) => {
    if (signal.aborted) return callback(new Error('Request cancelled'), null);
    connector(options, (error, socket) => {
      if (error) return callback(error, null);
      if (signal.aborted) {
        socket.destroy();
        return callback(new Error('Request cancelled'), null);
      }
      if (verifyHost && socket instanceof TLSSocket) {
        const hostname = (options.servername || options.hostname).replace(
          /^\[|\]$/g,
          '',
        );
        const invalid = checkServerIdentity(
          hostname,
          socket.getPeerCertificate(true),
        );
        if (invalid) {
          socket.destroy();
          return callback(invalid, null);
        }
      }
      callback(null, socket);
    });
  };
}

function socksConnector(
  proxy: URL,
  username: string | undefined,
  password: string | undefined,
  tls: ConnectionOptions,
  signal: AbortSignal,
): buildConnector.connector {
  const upgrade = buildConnector(tls);
  return (options, callback) => {
    let socket: Socket | undefined;
    const abort = () => socket?.destroy();
    signal.addEventListener('abort', abort, { once: true });
    void (async () => {
      signal.throwIfAborted();
      socket = connectTCP({
        host: proxy.hostname.replace(/^\[|\]$/g, ''),
        port: Number(proxy.port || 1080),
      });
      const timer = setTimeout(
        () => socket?.destroy(new Error('Proxy connection timed out')),
        20_000,
      );
      try {
        await once(socket, 'connect', { signal });
        await SocksClient.createConnection({
          command: 'connect',
          proxy: {
            host: proxy.hostname,
            port: Number(proxy.port || 1080),
            type: proxy.protocol.startsWith('socks4') ? 4 : 5,
            userId: username,
            password,
          },
          destination: {
            host: options.hostname.replace(/^\[|\]$/g, ''),
            port: Number(
              options.port || (options.protocol === 'https:' ? 443 : 80),
            ),
          },
          existing_socket: socket,
          timeout: 20_000,
        });
        signal.throwIfAborted();
        if (options.protocol === 'https:') {
          await new Promise<void>((resolve, reject) => {
            upgrade({ ...options, httpSocket: socket }, (error, secured) => {
              if (error) return reject(error);
              callback(null, secured);
              resolve();
            });
          });
        } else {
          callback(null, socket);
        }
      } finally {
        clearTimeout(timer);
      }
    })()
      .catch((error: Error) => {
        socket?.destroy();
        callback(error, null);
      })
      .finally(() => signal.removeEventListener('abort', abort));
  };
}

export function createLocalRelayDispatcher(
  securityInput: unknown,
  proxyInput: unknown,
  signal: AbortSignal,
): Dispatcher {
  const security = securityInput === undefined ? {} : record(securityInput);
  const verifyHost = optionalBoolean(security.verifyHost) ?? true;
  const tls: buildConnector.BuildOptions = {
    ...certificates(security.certificates),
    rejectUnauthorized: optionalBoolean(security.verifyPeer) ?? true,
    checkServerIdentity: verifyHost ? checkServerIdentity : () => undefined,
    // Resumed TLS sessions can omit the peer certificate needed by the
    // independent hostname check, including on a redirected request.
    maxCachedSessions: 0,
  };
  if (proxyInput === undefined) {
    return new Agent({
      connect: verifiedConnector(buildConnector(tls), verifyHost, signal),
    });
  }
  const value = record(proxyInput);
  let proxy: URL;
  try {
    if (typeof value.url !== 'string') throw new Error();
    proxy = new URL(value.url);
    if (
      ![
        'http:',
        'https:',
        'socks:',
        'socks4:',
        'socks4a:',
        'socks5:',
        'socks5h:',
      ].includes(proxy.protocol) ||
      proxy.hash ||
      proxy.search ||
      !['', '/'].includes(proxy.pathname)
    )
      throw new Error();
  } catch {
    throw new BadRequestException('Invalid proxy URL');
  }
  const auth = value.auth === undefined ? {} : record(value.auth);
  let username: string | undefined;
  let password: string | undefined;
  try {
    username =
      optionalString(auth.username) ??
      (proxy.username ? decodeURIComponent(proxy.username) : undefined);
    password =
      optionalString(auth.password) ??
      (proxy.password ? decodeURIComponent(proxy.password) : undefined);
  } catch {
    throw new BadRequestException('Invalid proxy credentials');
  }
  if (proxy.protocol.startsWith('socks')) {
    return new Agent({
      connect: verifiedConnector(
        socksConnector(proxy, username, password, tls, signal),
        verifyHost,
        signal,
      ),
    });
  }
  proxy.username = '';
  proxy.password = '';
  return new ProxyAgent({
    uri: proxy.href,
    requestTls: tls,
    proxyTls: certificates(value.certificates),
    token:
      username !== undefined || password !== undefined
        ? `Basic ${Buffer.from(`${username ?? ''}:${password ?? ''}`).toString('base64')}`
        : undefined,
    factory: (origin, options: Pool.Options) =>
      new Pool(origin, {
        ...options,
        connect: verifiedConnector(
          options.connect as buildConnector.connector,
          verifyHost,
          signal,
        ),
      }),
  });
}
