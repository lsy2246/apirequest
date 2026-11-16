import { WorkbenchAutomationService } from './automation.service';

jest.mock('src/utils', () => ({
  encrypt: (value: string) => value,
  decrypt: (value: string) => value,
  transformCollectionData: jest.fn(),
}));
jest.mock('src/prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('src/user-collection/user-collection.service', () => ({
  UserCollectionService: class {},
}));
jest.mock('./domain.service', () => ({ McpDomainService: class {} }));

function fixture() {
  const baseline = {
    name: 'Plan',
    collectionID: 'collection',
    environmentID: null,
    config: { iterations: 1, delay: 0, persistResponses: true },
  };
  const tx = {
    workbenchConfig: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest
        .fn()
        .mockImplementation(async ({ where }) =>
          where.kind === 'automation'
            ? { value: JSON.stringify(baseline), revision: 1 }
            : null,
        ),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    userEnvironment: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (operation) => operation(tx)),
  };
  const service = new WorkbenchAutomationService(
    prisma as any,
    {} as any,
    {} as any,
  );
  return { service, prisma, tx };
}

describe('combined automation settings', () => {
  it('saves run parameters and schedule in the same transaction', async () => {
    const { service, prisma, tx } = fixture();
    const result = await service.save(
      'owner',
      {
        environmentID: null,
        rule: null,
        config: {
          iterations: 3,
          delay: 250,
          stopOnError: true,
          keepVariableValues: false,
        },
      },
      'plan',
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const planWrite = tx.workbenchConfig.updateMany.mock.calls[1][0];
    expect(JSON.parse(planWrite.data.value)).toEqual({
      name: 'Plan',
      collectionID: 'collection',
      environmentID: null,
      config: {
        iterations: 3,
        delay: 250,
        stopOnError: true,
        persistResponses: true,
        keepVariableValues: false,
      },
    });
    expect(
      JSON.parse(tx.workbenchConfig.create.mock.calls[0][0].data.value).rule,
    ).toBeNull();
    expect(result.nextRunAt).toBeNull();
  });

  it.each([
    { iterations: 0 },
    { iterations: 1.5 },
    { delay: -1 },
    { delay: 60001 },
    { keepVariableValues: 'false' },
    { executeScripts: 'false' },
    { dataset: [] },
  ])('rejects invalid run parameters before writing: %j', async (config) => {
    const { service, prisma } = fixture();
    await expect(
      service.save(
        'owner',
        { environmentID: null, rule: null, config },
        'plan',
      ),
    ).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('validates the chosen environment even when scheduling is off', async () => {
    const { service, prisma } = fixture();
    await expect(
      service.save(
        'owner',
        {
          environmentID: 'another-owner-env',
          rule: null,
          config: { iterations: 1, delay: 0 },
        },
        'plan',
      ),
    ).rejects.toThrow('Environment not found');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps legacy schedule-only saves compatible', async () => {
    const { service, tx } = fixture();
    await service.save('owner', { environmentID: null, rule: null }, 'plan');
    expect(tx.workbenchConfig.updateMany).toHaveBeenCalledTimes(1);
  });

  it('does not create a schedule for a missing plan', async () => {
    const { service, tx } = fixture();
    tx.workbenchConfig.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.save(
        'owner',
        {
          environmentID: null,
          rule: null,
          config: { iterations: 1, delay: 0 },
        },
        'missing',
      ),
    ).rejects.toThrow('Configuration not found');
    expect(tx.workbenchConfig.create).not.toHaveBeenCalled();
  });
});
