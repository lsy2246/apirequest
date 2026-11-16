import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IncomingHttpHeaders } from 'http';

export const LOCAL_WORKSPACE_UID = 'workbench-local-owner-v1';
export type LocalWorkspaceConfig = {
  origins: string[];
  host: string;
  bindHost: string;
  allowLAN: boolean;
};
export type LocalWorkspaceRequest = {
  headers: IncomingHttpHeaders;
  socket?: { remoteAddress?: string };
};

const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

function isPrivateIPv4(address: string): boolean {
  const parts = address.replace(/^::ffff:/, '').split('.');
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)
  )
    return false;
  const [a, b] = parts.map(Number);
  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  );
}

export function getLocalWorkspaceConfig(
  config: ConfigService,
): LocalWorkspaceConfig {
  // 内网免登录必须显式启用，仍校验真实连接、精确 Host 和浏览器来源。
  const allowLAN = config.get('APIREQUEST_ALLOW_LAN_ACCESS') === 'true';
  if (config.get('TRUST_PROXY') === 'true')
    throw new Error('Single-user mode does not support trusted proxies');
  const values = ['VITE_BASE_URL', 'VITE_BACKEND_GQL_URL'].map((key) => {
    const url = new URL(config.get<string>(key));
    if (
      !(
        localHosts.has(url.hostname) ||
        (allowLAN && isPrivateIPv4(url.hostname))
      ) ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error(
        `Single-user mode requires a loopback or explicitly enabled private IPv4 URL: ${key}`,
      );
    return url;
  });
  const lanHost = isPrivateIPv4(values[1].hostname);
  if (allowLAN && values[0].hostname !== values[1].hostname)
    throw new Error(
      'LAN single-user mode requires matching frontend and backend hosts',
    );
  return {
    origins: [values[0].origin],
    host: values[1].host,
    bindHost: lanHost ? values[1].hostname : '127.0.0.1',
    allowLAN: allowLAN && lanHost,
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
    !(
      loopback.has(request.socket?.remoteAddress) ||
      (config.allowLAN && isPrivateIPv4(request.socket?.remoteAddress ?? ''))
    ) ||
    request.headers.host !== config.host
  )
    throw new ForbiddenException(
      'Workspace connection is outside the configured network',
    );
  if (publicMock) return;
  const origin = request.headers.origin;
  if (
    (requireOrigin || origin !== undefined) &&
    (typeof origin !== 'string' || !config.origins.includes(origin))
  )
    throw new ForbiddenException('Local workspace origin is not allowed');
}
