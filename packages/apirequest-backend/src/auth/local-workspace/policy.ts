import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IncomingHttpHeaders } from 'http';

export const LOCAL_WORKSPACE_UID = 'workbench-local-owner-v1';
export type LocalWorkspaceConfig = { origins: string[]; host: string };
export type LocalWorkspaceRequest = {
  headers: IncomingHttpHeaders;
  socket?: { remoteAddress?: string };
};

const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

export function getLocalWorkspaceConfig(
  config: ConfigService,
): LocalWorkspaceConfig | undefined {
  if (config.get('HOPP_SINGLE_USER_MODE') !== 'true') return undefined;
  // 自动建立本机身份仅适用于直连回环服务；公网部署或反向代理不能继承此模式。
  if (config.get('TRUST_PROXY') === 'true')
    throw new Error('Single-user mode does not support trusted proxies');
  const values = ['VITE_BASE_URL', 'VITE_BACKEND_GQL_URL'].map((key) => {
    const url = new URL(config.get<string>(key));
    if (
      !localHosts.has(url.hostname) ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error(`Single-user mode requires a loopback URL: ${key}`);
    return url;
  });
  return {
    origins: [values[0].origin],
    host: values[1].host,
  };
}

export function assertLocalWorkspaceRequest(
  request: LocalWorkspaceRequest,
  config: LocalWorkspaceConfig,
  requireOrigin = true,
  publicMock = false,
): void {
  // 使用真实套接字而非可伪造的转发头，并校验 Host，阻断 DNS 重绑定。
  if (
    !loopback.has(request.socket?.remoteAddress) ||
    request.headers.host !== config.host
  )
    throw new ForbiddenException(
      'Local workspace requires a loopback connection',
    );
  if (publicMock) return;
  const origin = request.headers.origin;
  if (
    (requireOrigin || origin !== undefined) &&
    (typeof origin !== 'string' || !config.origins.includes(origin))
  )
    throw new ForbiddenException('Local workspace origin is not allowed');
}
