import { WorkbenchAutomationService } from './automation.service';
import { getAutomationConfig } from '@apirequest/data';

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
    requestID: 'old-request',
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
    workbenchConfig: { create: jest.fn(async (row) => row) },
    userEnvironment: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (operation) =>
      Array.isArray(operation) ? Promise.all(operation) : operation(tx),
    ),
  };
  const domain = {
    get: jest.fn(async (kind, id) => ({
      id,
      title: 'New target',
      collectionID: 'new-collection',
    })),
  };
  const service = new WorkbenchAutomationService(
    prisma as any,
    domain as any,
    {} as any,
  );
  return { service, prisma, tx, domain };
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
      requestID: 'old-request',
      environmentID: null,
      config: {
        iterations: 3,
        delay: 250,
        stopOnError: true,
        persistResponses: true,
        keepVariableValues: false,
        executeScripts: true,
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
    expect(tx.workbenchConfig.updateMany).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(tx.workbenchConfig.updateMany.mock.calls[1][0].data.value)
        .config,
    ).toEqual({ iterations: 1, delay: 0, persistResponses: true });
  });

  it('creates a manual plan with all shared defaults and no next run', async () => {
    const { service, prisma, domain } = fixture();
    const result = await service.save('owner', {
      collectionID: 'collection',
      environmentID: null,
      rule: null,
    });
    expect(domain.get).toHaveBeenCalledWith(
      'collection',
      'collection',
      'owner',
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const writes = prisma.workbenchConfig.create.mock.calls.map(([row]) => ({
      ...row.data,
      value: JSON.parse(row.data.value),
    }));
    expect(writes[0].value).toEqual({
      name: 'New target',
      collectionID: 'collection',
      environmentID: null,
      config: getAutomationConfig(),
    });
    expect(writes[1].value).toMatchObject({
      planID: result.planID,
      rule: null,
      nextRunAt: null,
    });
  });

  it.each([{ requestID: 'new-request' }, { collectionID: 'new-group' }])(
    'updates the target and clears a previous single request when selecting a group: %j',
    async (target) => {
      const { service, tx, domain } = fixture();
      await service.save(
        'owner',
        {
          ...target,
          environmentID: null,
          rule: null,
          config: { iterations: 2 },
        },
        'plan',
      );
      expect(domain.get).toHaveBeenCalledWith(
        'requestID' in target ? 'request' : 'collection',
        Object.values(target)[0],
        'owner',
      );
      const saved = JSON.parse(
        tx.workbenchConfig.updateMany.mock.calls[1][0].data.value,
      );
      expect(saved.collectionID).toBe(
        'requestID' in target ? 'new-collection' : 'new-group',
      );
      expect(saved.requestID).toBe(
        'requestID' in target ? 'new-request' : undefined,
      );
      expect(saved.config.keepVariableValues).toBe(false);
    },
  );

  it('rejects a foreign or missing target before writing', async () => {
    const { service, prisma, domain } = fixture();
    domain.get.mockRejectedValueOnce(new Error('Configuration not found'));
    await expect(
      service.save(
        'owner',
        { requestID: 'foreign', environmentID: null, rule: null },
        'plan',
      ),
    ).rejects.toThrow('Configuration not found');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects ambiguous targets before writing', async () => {
    const { service, prisma } = fixture();
    await expect(
      service.save(
        'owner',
        {
          requestID: 'request',
          collectionID: 'group',
          environmentID: null,
          rule: null,
        },
        'plan',
      ),
    ).rejects.toThrow('A group or request is required');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('preserves the schedule as a draft when turning off an existing plan', async () => {
    const { service, tx } = fixture();
    const rule = {
      type: 'weekly',
      weekday: 2,
      time: '10:30',
      timezone: 'Asia/Shanghai',
    };
    const find = tx.workbenchConfig.findFirst.getMockImplementation()!;
    tx.workbenchConfig.findFirst.mockImplementation(async (args) =>
      args.where.kind === 'automation_schedule'
        ? {
            revision: 1,
            value: JSON.stringify({
              planID: 'plan',
              rule,
              environmentID: null,
              leaseUntil: 123,
            }),
          }
        : find(args),
    );
    await service.save('owner', { environmentID: null, rule: null }, 'plan');
    const saved = JSON.parse(
      tx.workbenchConfig.updateMany.mock.calls.at(-1)![0].data.value,
    );
    expect(saved).toMatchObject({
      rule: null,
      draftRule: rule,
      nextRunAt: null,
      leaseUntil: 123,
    });
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
      exportUserCollectionsToJSON: jest.fn(),
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
    return { service, prisma, rows, domain, collections };
  }
  it('builds one execution tree for selected requests across roots and preserves their ancestor configuration', async () => {
    const { service, domain, collections } = executionFixture();
    domain.get.mockResolvedValue({
      name: 'Cases',
      collectionID: 'one',
      config: { selectedRequestIDs: ['first', 'second'], casesOnly: true },
    });
    collections.exportUserCollectionsToJSON.mockResolvedValue({
      _tag: 'Right',
      right: {
        exportedCollection: JSON.stringify([
          {
            id: 'one',
            name: 'One',
            data: '{"headers":[{"key":"X-Group","value":"one"}]}',
            requests: [{ id: 'unselected' }],
            folders: [
              {
                id: 'nested',
                name: 'Nested',
                data: '{"variables":[]}',
                requests: [{ id: 'first' }],
                folders: [],
              },
            ],
          },
          {
            id: 'two',
            name: 'Two',
            data: '{"headers":[]}',
            requests: [{ id: 'second' }],
            folders: [],
          },
        ]),
      },
    });
    const run = jest
      .spyOn(service as any, 'run')
      .mockResolvedValue({
        steps: [],
        summary: { completed: 0, failed: 0, elapsedMs: 1 },
        automation: {
          status: 'completed',
          passedTests: 0,
          failedTests: 0,
          totalTests: 0,
        },
      });
    await (service as any).execute(
      'owner',
      { planID: 'plan', environmentID: null },
      Date.now(),
    );
    const input = run.mock.calls[0][0] as any;
    expect(input.collection.folders.map((folder) => folder.id)).toEqual([
      'one',
      'two',
    ]);
    expect(input.collection.folders[0]).toMatchObject({
      data: '{"headers":[{"key":"X-Group","value":"one"}]}',
      requests: [],
      folders: [{ id: 'nested', requests: [{ id: 'first' }] }],
    });
    expect(input.collection.folders[1].requests).toEqual([{ id: 'second' }]);
  });

  it('does not run when a selected request is absent from the owner workspace', async () => {
    const { service, domain, collections, rows } = executionFixture();
    domain.get.mockResolvedValue({
      name: 'Cases',
      collectionID: 'one',
      config: { selectedRequestIDs: ['foreign'], casesOnly: true },
    });
    collections.exportUserCollectionsToJSON.mockResolvedValue({
      _tag: 'Right',
      right: { exportedCollection: '[]' },
    });
    const run = jest.spyOn(service as any, 'run');
    await (service as any).execute(
      'owner',
      { planID: 'plan', environmentID: null },
      Date.now(),
    );
    expect(run).not.toHaveBeenCalled();
    expect(JSON.parse([...rows.values()][0].value).summary.failed).toBe(1);
  });

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
