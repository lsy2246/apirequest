import { Worker } from 'node:worker_threads';
import { WorkbenchAutomationService } from './automation.service';

jest.mock('node:worker_threads', () => {
  const { EventEmitter } = require('node:events');
  return {
    Worker: jest.fn().mockImplementation(() =>
      Object.assign(new EventEmitter(), {
        stdout: { resume: jest.fn() },
        stderr: { resume: jest.fn() },
        postMessage: jest.fn(),
        terminate: jest.fn(async () => 0),
      }),
    ),
  };
});
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

describe('background worker pause checkpoints', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });
  it('acknowledges a completed request only after it is durable, and excludes paused time from the deadline', async () => {
    jest.useFakeTimers();
    const service = new WorkbenchAutomationService(
      {} as any,
      {} as any,
      {} as any,
    );
    let save!: () => void;
    const progress = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          save = resolve;
        }),
    );
    const statuses: string[] = [];
    const run = (service as any).run(
      {},
      progress,
      'run',
      async (status: string) => {
        statuses.push(status);
      },
    );
    const worker = (Worker as unknown as jest.Mock).mock.results[0].value;
    worker.emit('message', {
      progress: {
        completed: 1,
        total: 2,
        report: { steps: [{ errors: ['full failure'] }] },
      },
    });
    expect(worker.postMessage).not.toHaveBeenCalledWith({ action: 'ack' });
    save();
    await Promise.resolve();
    expect(worker.postMessage).toHaveBeenCalledWith({ action: 'ack' });
    (service as any).runActions.get('run')('pause');
    expect(statuses.at(-1)).toBe('pausing');
    worker.emit('message', { paused: true });
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(statuses.at(-1)).toBe('paused');
    (service as any).runActions.get('run')('resume');
    expect(statuses.at(-1)).toBe('running');
    worker.emit('message', { result: { completed: true } });
    await expect(run).resolves.toEqual({ completed: true });
    expect(worker.terminate).toHaveBeenCalled();
    expect((service as any).runActions.has('run')).toBe(false);
  });
});
