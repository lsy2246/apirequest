import { ConfigService } from '@nestjs/config';
import { MockRuleController } from '../../mock-server/mock-rule.controller';
import { WorkbenchMcpController } from '../../workbench-mcp/mcp.controller';
import { LOCAL_WORKSPACE_UID } from './policy';

const origin = 'https://192.168.1.68:3300';
const config = new ConfigService({
  APIREQUEST_ALLOW_LAN_ACCESS: 'true',
  VITE_BASE_URL: origin,
  VITE_BACKEND_GQL_URL: `${origin}/graphql`,
  VITE_BACKEND_API_URL: `${origin}/v1`,
});

function request(method: string, source?: string): any {
  const headers = {
    host: '192.168.1.68:3300',
    'x-workbench-local': '1',
    ...(source === undefined ? {} : { origin: source }),
  };
  return {
    method,
    headers,
    socket: { remoteAddress: '192.168.1.20' },
    user: { uid: LOCAL_WORKSPACE_UID },
    get: (name: string) => headers[name.toLowerCase()],
    res: { setHeader: jest.fn() },
  };
}

function mcp() {
  const controller = new WorkbenchMcpController(
    {
      state: jest.fn().mockResolvedValue({ enabled: false }),
      setAccess: jest.fn().mockResolvedValue({ enabled: false }),
    } as any,
    {} as any,
    config,
    {} as any,
    {} as any,
  );
  return {
    read: (req: any) => controller.state(req, req.res),
    write: (req: any) => controller.access(req, { enabled: false }, req.res),
  };
}

function mock() {
  const controller = new MockRuleController(
    {} as any,
    config,
    { mockServer: { findMany: jest.fn().mockResolvedValue([]) } } as any,
    { save: jest.fn().mockResolvedValue({ revision: 2 }) } as any,
    {} as any,
  );
  return {
    read: (req: any) => controller.list(req),
    write: (req: any) => controller.save(req, 'mock-service', {}),
  };
}

describe.each([
  ['MCP', mcp],
  ['Mock', mock],
] as const)('%s browser request origins', (_name, create) => {
  it.each(['GET', 'HEAD'])(
    'allows same-origin %s without an Origin header',
    async (method) => {
      await expect(create().read(request(method))).resolves.toBeDefined();
    },
  );

  it.each(['https://evil.test', 'https://192.168.1.68:3301'])(
    'rejects a read with an unapproved Origin %s',
    async (source) => {
      await expect(create().read(request('GET', source))).rejects.toThrow(
        'Local workspace origin is not allowed',
      );
    },
  );

  it('still requires an Origin for writes', () => {
    expect(() => create().write(request('POST'))).toThrow(
      'Local workspace origin is not allowed',
    );
  });

  it('still rejects cross-origin writes', () => {
    expect(() => create().write(request('POST', 'https://evil.test'))).toThrow(
      'Local workspace origin is not allowed',
    );
  });

  it('allows a write from the configured Origin', async () => {
    await expect(
      create().write(request('POST', origin)),
    ).resolves.toBeDefined();
  });

  it('still requires the workbench header for reads', async () => {
    const req = request('GET');
    delete req.headers['x-workbench-local'];
    await expect(create().read(req)).rejects.toThrow();
  });
});
