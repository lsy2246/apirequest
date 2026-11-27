import { PrismaService } from 'src/prisma/prisma.service';
import { WorkspaceIndexService } from './workspace-index.service';

const prisma = {
  userCollection: { findMany: jest.fn(async () => [] as any[]) },
  userRequest: { findMany: jest.fn(async () => [] as any[]) },
  $queryRaw: jest.fn(async () => [] as any[]),
  $transaction: jest.fn(async (work: (tx: PrismaService) => Promise<unknown>) =>
    work(prisma as unknown as PrismaService),
  ),
};
const service = new WorkspaceIndexService(prisma as unknown as PrismaService);
beforeEach(() => {
  jest.resetAllMocks();
  prisma.$transaction.mockImplementation(
    async (work: (tx: PrismaService) => Promise<unknown>) =>
      work(prisma as unknown as PrismaService),
  );
});

describe('workspace navigation and detail reads', () => {
  it('reads indexed summaries without fetching request JSON', async () => {
    prisma.userCollection.findMany.mockResolvedValue([]);
    prisma.$queryRaw
      .mockResolvedValueOnce([{ revision: '5' }])
      .mockResolvedValueOnce([{ id: 'one', title: 'One', method: 'GET' }]);
    const result = await service.index('owner');
    expect(result.requests).toEqual([
      { id: 'one', title: 'One', method: 'GET' },
    ]);
    expect(result.revision).toMatch(/^db3-[a-f0-9]{24}-5$/);
    expect(prisma.userRequest.findMany).not.toHaveBeenCalled();
    expect(prisma.userCollection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userUid: 'owner' } }),
    );
    const [sql, user] = prisma.$queryRaw.mock.calls[1];
    expect(Array.from(sql as TemplateStringsArray).join('?')).toContain(
      'WHERE "userUid" = ?',
    );
    expect(user).toBe('owner');
  });

  it('returns only collection metadata for the lazy opening screen', async () => {
    prisma.userCollection.findMany.mockResolvedValue([{ id: 'folder' }] as any);
    prisma.$queryRaw.mockResolvedValueOnce([{ revision: '5' }]);
    const result = await service.index('owner', true);
    expect(result.collections).toEqual([{ id: 'folder' }]);
    expect(result.requests).toEqual([]);
    expect(result.lazyRequests).toBe(true);
    expect(result.revision).toMatch(/^lazy-db3-[a-f0-9]{24}-5$/);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('pages summaries by owner and folder with a stable revision', async () => {
    const revision = await (async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ revision: '3' }]);
      return `lazy-${await service.revision('owner')}`;
    })();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ revision: '3' }])
      .mockResolvedValueOnce(
        Array.from({ length: 201 }, (_, index) => ({
          id: String(index),
          orderIndex: index,
        })),
      );
    const result = await service.folderRequests('owner', 'folder', revision);
    expect(result.requests).toHaveLength(200);
    expect(result.nextCursor).toEqual({ orderIndex: 199, id: '199' });
    const [sql] = prisma.$queryRaw.mock.calls.at(-1)!;
    expect(Array.from(sql as TemplateStringsArray).join('?')).toContain(
      '"collectionID" = ?',
    );
  });

  it('does not return a page from a changed index revision', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ revision: '4' }]);
    await expect(
      service.folderRequests('owner', 'folder', 'lazy-old'),
    ).rejects.toThrow('Workspace index changed');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('searches summaries within the authenticated owner', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'one' }]);
    expect(await service.searchRequests('owner', 'API_1')).toEqual([
      { id: 'one' },
    ]);
    const [sql, user, pattern] = prisma.$queryRaw.mock.calls[0];
    expect(Array.from(sql as TemplateStringsArray).join('?')).toContain(
      '"userUid" = ?',
    );
    expect(user).toBe('owner');
    expect(pattern).toBe('%API\\_1%');
  });

  it('reads the revision without fetching the collection index', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ revision: '41' }]);
    expect(await service.revision('owner')).toMatch(/^db3-[a-f0-9]{24}-41$/);
    expect(prisma.userCollection.findMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const [sql, user] = prisma.$queryRaw.mock.calls[0];
    expect(Array.from(sql as TemplateStringsArray).join('?')).toContain(
      'FROM "WorkspaceIndexRevision"',
    );
    expect(user).toBe('owner');
  });

  it('starts at revision zero for an existing workspace without a revision row', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);
    expect(await service.revision('owner')).toMatch(/^db3-[a-f0-9]{24}-0$/);
  });

  it('uses distinct cache revisions for owners with the same counter', async () => {
    prisma.$queryRaw.mockResolvedValue([{ revision: '1' }]);
    expect(await service.revision('owner')).not.toBe(
      await service.revision('different-owner'),
    );
  });

  it('provides a stable revision that changes on database writes', async () => {
    prisma.userCollection.findMany.mockResolvedValue([]);
    let revision = '7';
    prisma.$queryRaw.mockImplementation((sql: TemplateStringsArray) =>
      Promise.resolve(
        Array.from(sql).join('?').includes('WorkspaceIndexRevision')
          ? [{ revision }]
          : [{ id: 'one' }],
      ),
    );
    const first = await service.index('owner');
    expect((await service.index('owner')).revision).toBe(first.revision);
    revision = '8';
    expect((await service.index('owner')).revision).not.toBe(first.revision);
  });

  it('scopes detail batches to the authenticated owner and deduplicates IDs', async () => {
    const row = {
      id: 'one',
      title: 'One',
      request: { method: 'POST', body: 'preserved' },
    };
    prisma.userRequest.findMany.mockResolvedValue([row] as any);
    expect(await service.requests('owner', ['one', 'one'])).toEqual([row]);
    expect(prisma.userRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userUid: 'owner', id: { in: ['one'] } },
      }),
    );
  });

  it('fails the whole detail batch when any request is missing or belongs to another owner', async () => {
    prisma.userRequest.findMany.mockResolvedValue([{ id: 'one' }] as any);
    await expect(
      service.requests('owner', ['one', 'other-user']),
    ).rejects.toThrow('Request not found');
  });

  it.each([null, {}, [''], [12]])(
    'rejects malformed detail batches',
    async (ids) => {
      await expect(service.requests('owner', ids)).rejects.toThrow(
        'Invalid request IDs',
      );
      expect(prisma.userRequest.findMany).not.toHaveBeenCalled();
    },
  );

  it('reads large batches without exceeding the database parameter budget', async () => {
    const ids = Array.from({ length: 10001 }, (_, index) => String(index));
    const rows = ids.map((id) => ({ id }));
    prisma.userRequest.findMany
      .mockResolvedValueOnce(rows.slice(0, 10000) as any)
      .mockResolvedValueOnce(rows.slice(10000) as any);
    expect(await service.requests('owner', ids)).toEqual(rows);
    expect(prisma.userRequest.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.userRequest.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userUid: 'owner', id: { in: ['10000'] } },
      }),
    );
  });

  it('returns an empty batch without a database read', async () => {
    expect(await service.requests('owner', [])).toEqual([]);
    expect(prisma.userRequest.findMany).not.toHaveBeenCalled();
  });
});
