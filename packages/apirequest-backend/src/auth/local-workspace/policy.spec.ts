import { ConfigService } from '@nestjs/config';
import { assertLocalWorkspaceRequest, getLocalWorkspaceConfig } from './policy';

const config = (extra: Record<string, string> = {}) =>
  new ConfigService({
    VITE_BASE_URL: 'http://127.0.0.1:3000',
    VITE_BACKEND_GQL_URL: 'http://127.0.0.1:3170/graphql',
    ...extra,
  });
const request = () => ({
  headers: { host: '127.0.0.1:3170', origin: 'http://127.0.0.1:3000' },
  socket: { remoteAddress: '127.0.0.1' },
});

describe('本机工作区来源边界', () => {
  it('无需模式开关即可提供固定工作区配置', () => {
    expect(getLocalWorkspaceConfig(config())).toEqual({
      origins: ['http://127.0.0.1:3000'],
      host: '127.0.0.1:3170',
      bindHost: '127.0.0.1',
      allowLAN: false,
    });
  });
  it.each([
    { VITE_BASE_URL: 'https://example.com' },
    { TRUST_PROXY: 'true' },
    { VITE_BACKEND_GQL_URL: 'http://127.0.0.1.attacker.test:3170/graphql' },
  ])('拒绝非回环部署或代理配置 %j', (extra) => {
    expect(() => getLocalWorkspaceConfig(config(extra))).toThrow();
  });
  it('允许精确配置的本机来源', () => {
    expect(() =>
      assertLocalWorkspaceRequest(request(), getLocalWorkspaceConfig(config())),
    ).not.toThrow();
  });
  it.each([
    'https://evil.test',
    'http://127.0.0.1:3100',
    'http://127.0.0.1:3000.evil.test',
    'http://127.0.0.1:9999',
    'null',
    undefined,
  ])('拒绝跨站、错误端口及缺失来源 %s', (origin) => {
    const req = request();
    req.headers.origin = origin;
    expect(() =>
      assertLocalWorkspaceRequest(req, getLocalWorkspaceConfig(config())),
    ).toThrow();
  });
  it('拒绝 DNS 重绑定 Host 和伪造转发地址', () => {
    const req = request();
    req.headers.host = 'evil.test:3170';
    expect(() =>
      assertLocalWorkspaceRequest(req, getLocalWorkspaceConfig(config())),
    ).toThrow();
    req.headers.host = '127.0.0.1:3170';
    req.socket.remoteAddress = '192.0.2.1';
    expect(() =>
      assertLocalWorkspaceRequest(req, getLocalWorkspaceConfig(config())),
    ).toThrow();
  });
  it('只读探测允许没有 Origin，但不允许带有外部 Origin', () => {
    const req = request();
    delete req.headers.origin;
    expect(() =>
      assertLocalWorkspaceRequest(
        req,
        getLocalWorkspaceConfig(config()),
        false,
      ),
    ).not.toThrow();
    req.headers.origin = 'https://evil.test';
    expect(() =>
      assertLocalWorkspaceRequest(
        req,
        getLocalWorkspaceConfig(config()),
        false,
      ),
    ).toThrow();
  });

  const lanConfig = (extra: Record<string, string> = {}) =>
    config({
      APIREQUEST_ALLOW_LAN_ACCESS: 'true',
      VITE_BASE_URL: 'https://192.168.1.68:3300',
      VITE_BACKEND_GQL_URL: 'https://192.168.1.68:3300/graphql',
      ...extra,
    });
  it('显式启用内网后绑定指定地址，并允许真实内网连接', () => {
    const settings = getLocalWorkspaceConfig(lanConfig());
    expect(settings.bindHost).toBe('192.168.1.68');
    expect(() =>
      assertLocalWorkspaceRequest(
        {
          headers: {
            host: '192.168.1.68:3300',
            origin: 'https://192.168.1.68:3300',
          },
          socket: { remoteAddress: '::ffff:192.168.1.20' },
        },
        settings,
      ),
    ).not.toThrow();
  });
  it.each([
    { APIREQUEST_ALLOW_LAN_ACCESS: 'false' },
    { VITE_BASE_URL: 'https://example.com' },
    { VITE_BACKEND_GQL_URL: 'https://8.8.8.8/graphql' },
    { VITE_BASE_URL: 'https://192.168.1.69:3300' },
    { TRUST_PROXY: 'true' },
  ])('拒绝未授权或不一致的内网配置 %j', (extra) => {
    expect(() => getLocalWorkspaceConfig(lanConfig(extra))).toThrow();
  });
  it.each([
    {
      address: '203.0.113.1',
      host: '192.168.1.68:3300',
      origin: 'https://192.168.1.68:3300',
    },
    {
      address: '192.168.1.20',
      host: 'evil.test:3300',
      origin: 'https://192.168.1.68:3300',
    },
    {
      address: '192.168.1.20',
      host: '192.168.1.68:3300',
      origin: 'https://evil.test',
    },
  ])(
    '内网模式仍拒绝错误的连接、Host 或来源 %j',
    ({ address, host, origin }) => {
      expect(() =>
        assertLocalWorkspaceRequest(
          {
            headers: { host, origin, 'x-forwarded-for': '192.168.1.1' },
            socket: { remoteAddress: address },
          },
          getLocalWorkspaceConfig(lanConfig()),
        ),
      ).toThrow();
    },
  );
});
