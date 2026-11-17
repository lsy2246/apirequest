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

describe('durable automation execution', () => {
  function executionFixture() {
    const rows = new Map<string, any>();
    const prisma = {
      workbenchConfig: {
        upsert: jest.fn(async ({ create, update }) => {
          rows.set(create.id, {
            ...(rows.get(create.id) ?? create),
            ...update,
          });
        }),
        findMany: jest.fn(async () => [...rows.values()]),
        updateMany: jest.fn(async ({ where, data }) => {
          Object.assign(rows.get(where.id), data);
          return { count: 1 };
        }),
        findFirst: jest.fn(async () => null),
      },
      userEnvironment: { findFirst: jest.fn(async () => null) },
      userCollection: { findFirst: jest.fn(async () => null) },
    };
    const domain = {
      get: jest.fn(async () => ({
        name: 'Suite',
        collectionID: 'collection',
        config: {},
      })),
    };
    const collections = {
      exportUserCollectionToJSONObject: jest.fn(async () => ({
        _tag: 'Right',
        right: { id: 'collection', name: 'Suite', requests: [], folders: [] },
      })),
    };
    const service = new WorkbenchAutomationService(
      prisma as any,
      domain as any,
      collections as any,
    );
    return { service, prisma, rows };
  }
  it('creates the report before execution and retains completed failures on a timeout', async () => {
    const { service, rows } = executionFixture();
    const step = {
      name: 'failed request',
      passed: false,
      errors: ['REQUEST_ERROR'],
      errorDetails: [
        { code: 'REQUEST_ERROR', data: { message: 'full original error' } },
      ],
      response: { body: 'full failure body' },
    };
    jest
      .spyOn(service as any, 'run')
      .mockImplementation(async (_input, onProgress: any) => {
        expect(rows.size).toBe(1);
        expect(JSON.parse([...rows.values()][0].value).automation.status).toBe(
          'running',
        );
        await onProgress({
          completed: 1,
          total: 3,
          report: {
            steps: [step],
            summary: { completed: 1, failed: 1, elapsedMs: 30 },
            automation: {
              status: 'running',
              passedTests: 0,
              failedTests: 1,
              totalTests: 1,
            },
          },
        });
        expect(JSON.parse([...rows.values()][0].value).steps).toEqual([step]);
        throw new Error('timeout');
      });
    await (service as any).execute(
      'owner',
      { planID: 'plan', environmentID: null },
      Date.now(),
    );
    const saved = JSON.parse([...rows.values()][0].value);
    expect(saved.steps).toEqual([step]);
    expect(saved.automation.status).toBe('timeout');
    expect(saved.errorDetails[0].data.message).toBe('timeout');
    expect(service.runs('owner')).toHaveLength(0);
  });
  it('returns all reports and marks abandoned runs interrupted without deleting their details', async () => {
    const { service, prisma, rows } = executionFixture();
    for (let i = 0; i < 35; i++)
      rows.set(String(i), {
        id: String(i),
        value: JSON.stringify({
          id: String(i),
          automation: { status: i === 0 ? 'paused' : 'completed' },
          steps: [{ errors: ['original'] }],
        }),
      });
    const reports: any[] = await service.reports('owner');
    expect(reports).toHaveLength(35);
    expect(prisma.workbenchConfig.findMany).toHaveBeenCalledWith({
      where: { ownerUid: 'owner', kind: 'automation_report' },
      orderBy: { createdOn: 'desc' },
    });
    expect(reports[0]).toMatchObject({
      automation: { status: 'interrupted' },
      steps: [{ errors: ['original'] }],
    });
  });
  it('scopes pause/resume to the run owner and rejects finished runs', async () => {
    const { service } = executionFixture();
    const send = jest.fn();
    (service as any).activeRuns.set('run', {
      id: 'run',
      ownerUid: 'owner',
      status: 'running',
    });
    (service as any).runActions.set('run', send);
    await expect(
      service.control('another-owner', 'run', 'pause'),
    ).rejects.toThrow('Run not found');
    await service.control('owner', 'run', 'pause');
    await service.control('owner', 'run', 'resume');
    expect(send.mock.calls).toEqual([['pause'], ['resume']]);
    (service as any).activeRuns.get('run').status = 'completed';
    await expect(service.control('owner', 'run', 'pause')).rejects.toThrow(
      'Run is no longer active',
    );
  });
});

describe('report deletion', () => {
  it('deletes only the requested report owned by the caller and remains idempotent', async () => {
    const deleteMany = jest.fn(async () => ({ count: 1 }));
    const service = new WorkbenchAutomationService(
      { workbenchConfig: { deleteMany } } as any,
      {} as any,
      {} as any,
    );
    await expect(service.deleteReport('owner', 'report')).resolves.toEqual({
      id: 'report',
      deleted: true,
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: 'report', ownerUid: 'owner', kind: 'automation_report' },
    });
    deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.deleteReport('owner', 'report')).resolves.toEqual({
      id: 'report',
      deleted: true,
    });
  });
  it.each(['running', 'pausing'])(
    'preserves an active %s report',
    async (status) => {
      const deleteMany = jest.fn();
      const service = new WorkbenchAutomationService(
        { workbenchConfig: { deleteMany } } as any,
        {} as any,
        {} as any,
      );
      (service as any).activeRuns.set('report', { ownerUid: 'owner', status });
      await expect(service.deleteReport('owner', 'report')).rejects.toThrow(
        'Cannot delete an active report',
      );
      expect(deleteMany).not.toHaveBeenCalled();
    },
  );
});

describe('resuming persisted background reports', () => {
  it('loads the frozen snapshot, requires a choice for an unknown request and keeps the report ID', async () => {
    const recovery = {
      version: 1,
      input: { collection: {}, envs: { selected: [], global: [] }, config: {} },
      envs: { selected: [], global: [] },
      results: [],
      inFlight: { name: 'unknown', iteration: 1 },
    };
    const saved = {
      id: 'saved-report',
      name: 'Frozen plan',
      automation: { status: 'interrupted' },
      recovery,
    };
    const findFirst = jest.fn(async () => ({ value: JSON.stringify(saved) }));
    const service = new WorkbenchAutomationService(
      { workbenchConfig: { findFirst } } as any,
      {} as any,
      {} as any,
    );
    const execute = jest
      .spyOn(service as any, 'execute')
      .mockResolvedValue(undefined);
    await expect(
      service.control('owner', 'saved-report', 'resume'),
    ).rejects.toThrow('Choose retry or skip');
    await expect(
      service.control('owner', 'saved-report', 'resume', 'skip'),
    ).resolves.toEqual({ id: 'saved-report', status: 'running' });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'saved-report',
        ownerUid: 'owner',
        kind: 'automation_report',
      },
    });
    const resumed = execute.mock.calls[0][3] as any;
    expect(resumed.id).toBe('saved-report');
    expect(resumed.recovery.inFlight).toBeUndefined();
    expect(resumed.recovery.results[0]).toMatchObject({
      requestName: 'unknown',
      result: false,
    });
    expect(resumed.events[0].action).toBe('skip');
  });
  it('discards the suspended worker before deleting a paused report', async () => {
    const order: string[] = [];
    const service = new WorkbenchAutomationService(
      {
        workbenchConfig: {
          deleteMany: jest.fn(async () => {
            order.push('delete');
            return { count: 1 };
          }),
        },
      } as any,
      {} as any,
      {} as any,
    );
    (service as any).activeRuns.set('run', {
      ownerUid: 'owner',
      status: 'paused',
    });
    (service as any).runDiscards.set('run', async () => {
      order.push('discard');
    });
    await service.deleteReport('owner', 'run');
    expect(order).toEqual(['discard', 'delete']);
  });
});
