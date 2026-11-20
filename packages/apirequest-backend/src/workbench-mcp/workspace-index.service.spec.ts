import { mockDeep, mockReset } from 'jest-mock-extended';
import { PrismaService } from 'src/prisma/prisma.service';
import { WorkspaceIndexService } from './workspace-index.service';

const prisma = mockDeep<PrismaService>();
const service = new WorkspaceIndexService(prisma);
beforeEach(() => mockReset(prisma));

describe('workspace navigation and detail reads', () => {
  it('projects the index in SQL without fetching full request JSON into Node', async () => {
    prisma.userCollection.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([{ id: 'one', title: 'One', method: 'GET' }]);
    const result = await service.index('owner');
    expect(result.requests).toEqual([{ id: 'one', title: 'One', method: 'GET' }]);
    expect(prisma.userRequest.findMany).not.toHaveBeenCalled();
    expect(prisma.userCollection.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userUid: 'owner' } }));
    const [sql, user] = prisma.$queryRaw.mock.calls[0];
    expect(Array.from(sql as TemplateStringsArray).join('?')).toContain('WHERE r."userUid" = ?');
    expect(user).toBe('owner');
  });

  it('provides a stable revision that changes when index data changes', async () => {
    prisma.userCollection.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);
    const first = await service.index('owner');
    expect((await service.index('owner')).revision).toBe(first.revision);
    prisma.$queryRaw.mockResolvedValue([{ id: 'new' }]);
    expect((await service.index('owner')).revision).not.toBe(first.revision);
  });

  it('scopes detail batches to the authenticated owner and deduplicates IDs', async () => {
    const row = { id: 'one', title: 'One', request: { method: 'POST', body: 'preserved' } };
    prisma.userRequest.findMany.mockResolvedValue([row] as any);
    expect(await service.requests('owner', ['one', 'one'])).toEqual([row]);
    expect(prisma.userRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userUid: 'owner', id: { in: ['one'] } },
    }));
  });

  it('fails the whole detail batch when any request is missing or belongs to another owner', async () => {
    prisma.userRequest.findMany.mockResolvedValue([{ id: 'one' }] as any);
    await expect(service.requests('owner', ['one', 'other-user'])).rejects.toThrow('Request not found');
  });

  it.each([null, {}, [''], [12], new Array(10001).fill('one')])('rejects malformed or oversized detail batches', async (ids) => {
    await expect(service.requests('owner', ids)).rejects.toThrow('Invalid request IDs');
    expect(prisma.userRequest.findMany).not.toHaveBeenCalled();
  });

  it('returns an empty batch without a database read', async () => {
    expect(await service.requests('owner', [])).toEqual([]);
    expect(prisma.userRequest.findMany).not.toHaveBeenCalled();
  });
});
