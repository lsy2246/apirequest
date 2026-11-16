import { WorkbenchMcpService } from './mcp.service';

jest.mock('src/utils', () => ({
  encrypt: (value: string) => value,
  decrypt: (value: string) => value,
}));
jest.mock('src/prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('./domain.service', () => ({ McpDomainService: class {} }));
jest.mock('../workbench-events', () => ({
  workbenchEvents: { publish: jest.fn() },
}));

const uid = 'owner';
const epoch = 'active-access';
const cases = [
  {
    entity: 'documentation',
    operation: 'create',
    data: { title: 'Document', collectionID: 'collection' },
  },
  {
    entity: 'documentation',
    operation: 'update',
    id: 'existing',
    data: { title: 'Updated document' },
  },
  { entity: 'documentation', operation: 'delete', id: 'existing' },
  { entity: 'websocket', operation: 'delete', id: 'existing' },
  {
    entity: 'collection',
    operation: 'create',
    data: { title: 'Collection', type: 'REST' },
  },
  {
    entity: 'request',
    operation: 'update',
    id: 'existing',
    data: { title: 'Request' },
  },
];

function fixture(required?: boolean) {
  const rows = new Map<string, any>();
  rows.set('mcp-access-owner', {
    id: 'mcp-access-owner',
    ownerUid: uid,
    kind: 'mcp-access',
    value: JSON.stringify({
      enabled: true,
      epoch,
      expiresAt: Date.now() + 60000,
    }),
  });
  if (required !== undefined)
    rows.set('mcp-policy-owner', {
      id: 'mcp-policy-owner',
      ownerUid: uid,
      kind: 'mcp-policy',
      value: JSON.stringify({ required }),
    });
  const prisma = {
    workbenchConfig: {
      findFirst: jest.fn(async ({ where }) => rows.get(where.id) ?? null),
      count: jest.fn(
        async () =>
          [...rows.values()].filter((row) => row.kind === 'mcp-proposal')
            .length,
      ),
      upsert: jest.fn(async ({ where, create, update }) => {
        const previous = rows.get(where.id);
        const row = previous ? { ...previous, value: update.value } : create;
        rows.set(where.id, structuredClone(row));
        return row;
      }),
    },
    user: { findUnique: jest.fn(async () => ({ uid })) },
  };
  const domain = {
    before: jest.fn(async (change) =>
      change.operation === 'create'
        ? null
        : { id: 'existing', title: 'Original' },
    ),
    normalize: jest.fn(async (change, before) =>
      change.operation === 'delete' ? undefined : { ...before, ...change.data },
    ),
    execute: jest.fn(async (change) => ({
      id: change.id ?? 'created',
      deleted: change.operation === 'delete',
    })),
  };
  const config = { get: () => 'http://127.0.0.1:3000' };
  const service = new WorkbenchMcpService(
    prisma as any,
    domain as any,
    config as any,
  );
  const propose = (change: (typeof cases)[number], key = 'approval-test-key') =>
    service.propose(
      { ...change, reason: 'Approval regression', idempotencyKey: key },
      uid,
      epoch,
    );
  return { service, domain, rows, propose };
}

describe('workbench approval policy', () => {
  it.each(cases)(
    'applies $entity $operation without approval when disabled and records the result',
    async (change) => {
      const { propose, domain, rows } = fixture(false);
      const result = await propose(change);
      expect(result).toMatchObject({ status: 'applied', automatic: true });
      expect(domain.execute).toHaveBeenCalledTimes(1);
      expect(JSON.parse(rows.get(result.id).value)).toMatchObject({
        status: 'applied',
        automatic: true,
        change,
      });
    },
  );

  it.each(cases)(
    'queues $entity $operation when approval is enabled',
    async (change) => {
      const { propose, domain } = fixture(true);
      expect(await propose(change)).toMatchObject({
        status: 'pending',
        automatic: false,
      });
      expect(domain.execute).not.toHaveBeenCalled();
    },
  );

  it('requires approval by default', async () => {
    const { propose, domain } = fixture();
    expect(await propose(cases[2])).toMatchObject({ status: 'pending' });
    expect(domain.execute).not.toHaveBeenCalled();
  });

  it('does not repeat an automatically executed deletion on an idempotent retry', async () => {
    const { propose, domain } = fixture(false);
    const first = await propose(cases[2]);
    expect(await propose(cases[2])).toMatchObject({
      id: first.id,
      status: 'applied',
      automatic: true,
    });
    expect(domain.execute).toHaveBeenCalledTimes(1);
  });

  it('restores approval for all new changes when switched back on', async () => {
    const { service, propose, domain } = fixture(false);
    expect(await propose(cases[2], 'delete-before-policy')).toMatchObject({
      status: 'applied',
    });
    await service.setApprovalPolicy(uid, true);
    expect(await propose(cases[0], 'document-after-policy')).toMatchObject({
      status: 'pending',
      automatic: false,
    });
    expect(domain.execute).toHaveBeenCalledTimes(1);
  });

  it('records automatic execution failures without claiming the change applied', async () => {
    const { propose, domain, rows } = fixture(false);
    domain.execute.mockRejectedValueOnce(new Error('Write failed'));
    const result = await propose(cases[2]);
    expect(result).toMatchObject({ status: 'failed', automatic: true });
    expect(JSON.parse(rows.get(result.id).value).status).toBe('failed');
  });

  it('rejects revoked access even when approval is disabled', async () => {
    const { propose, domain, rows } = fixture(false);
    rows.get('mcp-access-owner').value = JSON.stringify({
      enabled: false,
      epoch,
    });
    await expect(propose(cases[2])).rejects.toThrow('MCP access is disabled');
    expect(domain.execute).not.toHaveBeenCalled();
  });
});
