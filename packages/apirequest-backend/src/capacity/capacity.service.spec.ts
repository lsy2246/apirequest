import { ConfigService } from '@nestjs/config';
import type { PrismaService } from 'src/prisma/prisma.service';
import { CapacityService, MIB } from './capacity.service';

function fixture(lan = false) {
  const base = lan ? 'https://192.168.1.12:3300' : 'http://127.0.0.1:3300';
  const config = new ConfigService({
    APIREQUEST_ALLOW_LAN_ACCESS: String(lan),
    VITE_BASE_URL: base,
    VITE_BACKEND_GQL_URL: `${base}/graphql`,
  });
  const db = {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const service = new CapacityService(
    { workbenchConfig: db } as unknown as PrismaService,
    config,
  );
  return { service, db };
}

describe('service capacity', () => {
  const owner = 'owner';

  it('starts with existing limits, applies saved values and supports reset', async () => {
    const { service, db } = fixture();
    expect(service.current.relayConcurrency).toBe(32);
    await service.save(owner, { relayConcurrency: 2, batchReads: 4 }, 0);
    expect(service.rate('batchReads')).toEqual({ limit: 4, ttl: 10000 });
    expect(service.rate('externalMcp')).toEqual({ limit: 100, ttl: 10000 });
    expect(service.current.relayConcurrency).toBe(2);
    expect(db.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerUid: owner, revision: 1 }),
      }),
    );
    await service.save(owner, {}, 1);
    expect(service.current.relayConcurrency).toBe(32);
  });

  it('keeps the active values if a concurrent update wins', async () => {
    const { service, db } = fixture();
    await service.save(owner, { relayConcurrency: 2 }, 0);
    db.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.save(owner, { relayConcurrency: 3 }, 1),
    ).rejects.toThrow('Reload');
    expect(service.current.relayConcurrency).toBe(2);
  });

  it('applies configured values above the former ranges and allows disabled rate groups on LAN', async () => {
    const { service } = fixture(true);
    const values = {
      workspaceReads: 0,
      batchReads: 0,
      rateWindowSeconds: 300,
      detailBatchSize: 10001,
      relayConcurrency: 129,
      relayDefaultTimeoutSeconds: 360,
      relayMaxTimeoutSeconds: 900,
      relayBodyMiB: 90,
      collectionImportMiB: 125,
      configImportMiB: 150,
    };
    await service.save(owner, values, 0);
    expect(service.current).toMatchObject(values);
    expect(service.view().fields.detailBatchSize).toEqual({ default: 200 });
    expect(service.rate('workspaceReads')).toEqual({ limit: 0, ttl: 300000 });
    expect(service.jsonBodyLimit('/v1/workbench-mcp/data/workspace/import')).toBe(150 * MIB);
    expect(service.jsonBodyLimit('/v1/auth/local-collections')).toBeGreaterThan(125 * MIB);
    expect(service.jsonBodyLimit('/v1/auth/local-relay')).toBeGreaterThan(120 * MIB);
    expect(service.jsonBodyLimit('/graphql')).toBe(100 * MIB);
  });

  it('rejects invalid values and durations the runtime cannot represent', async () => {
    const { service } = fixture();
    await expect(service.save(owner, { detailBatchSize: 0 }, 0)).rejects.toThrow('detailBatchSize');
    await expect(service.save(owner, { workspaceReads: -1 }, 0)).rejects.toThrow('workspaceReads');
    await expect(service.save(owner, { batchReads: 1.5 }, 0)).rejects.toThrow('batchReads');
    await expect(service.save(owner, { rateWindowSeconds: 2147484 }, 0)).rejects.toThrow('rateWindowSeconds');
    await expect(
      service.save(owner, { relayMaxTimeoutSeconds: 3 }, 0),
    ).rejects.toThrow('Default relay timeout');
  });

  it('restores saved capacity values, including disabled rate groups on LAN', async () => {
    const { service, db } = fixture(true);
    db.findUnique.mockResolvedValueOnce({
      value: JSON.stringify({ workspaceReads: 0, collectionImportMiB: 1 }),
      revision: 3,
    });
    await service.onModuleInit();
    expect(service.current.workspaceReads).toBe(0);
    expect(() => service.checkCollectionSize('界'.repeat(350000))).toThrow(
      'exceeds 1 MiB',
    );
    expect(service.view().revision).toBe(3);
  });
});
