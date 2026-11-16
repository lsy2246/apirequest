import { ConfigService } from '@nestjs/config';
import { assertLocalWorkspaceRequest, getLocalWorkspaceConfig } from './policy';

const config = (extra: Record<string, string> = {}) =>
  new ConfigService({
    HOPP_SINGLE_USER_MODE: 'true',
    VITE_BASE_URL: 'http://127.0.0.1:3000',
    VITE_BACKEND_GQL_URL: 'http://127.0.0.1:3170/graphql',
    ...extra,
  });
const request = () => ({
  headers: { host: '127.0.0.1:3170', origin: 'http://127.0.0.1:3000' },
  socket: { remoteAddress: '127.0.0.1' },
});

describe('本机工作区来源边界', () => {
  it('未启用时不提供自动本地身份', () => {
    expect(
      getLocalWorkspaceConfig(config({ HOPP_SINGLE_USER_MODE: 'false' })),
    ).toBeUndefined();
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
});
