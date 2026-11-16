import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CronTime } from 'cron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import * as E from 'fp-ts/Either';
import { LOCAL_WORKSPACE_UID } from 'src/auth/local-workspace/policy';
import { PrismaService } from 'src/prisma/prisma.service';
import { CollectionFolder } from 'src/types/CollectionFolder';
import { UserCollectionService } from 'src/user-collection/user-collection.service';
import { decrypt, encrypt, transformCollectionData } from 'src/utils';
import { object, validateData } from './contract';
import { McpDomainService } from './domain.service';
import { workbenchEvents } from '../workbench-events';

type Rule =
  | { type: 'interval'; minutes: number }
  | { type: 'daily'; time: string; timezone: string }
  | { type: 'weekly'; time: string; timezone: string; weekday: number };

type Variable = {
  key: string;
  initialValue: string;
  currentValue: string;
  secret: boolean;
};
type Schedule = {
  planID: string;
  environmentID: string | null;
  rule: Rule | null;
  overrides: { key: string; secret: boolean; value: string }[];
  nextRunAt: number | null;
  leaseUntil?: number;
};

const scheduleKind = 'automation_schedule';
const reportKind = 'automation_report';
const timeoutMs = 5 * 60_000;
const encode = (value: unknown) => encrypt(JSON.stringify(value));
const decode = <T>(value: string): T => JSON.parse(decrypt(value));

function nextRun(rule: Rule, after: number, anchor = after): number {
  if (rule.type === 'interval') {
    const period = rule.minutes * 60_000;
    return anchor + (Math.floor((after - anchor) / period) + 1) * period;
  }
  const [hour, minute] = rule.time.split(':').map(Number);
  return new CronTime(
    `${minute} ${hour} * * ${rule.type === 'weekly' ? rule.weekday : '*'}`,
    rule.timezone,
  )
    .getNextDateFrom(new Date(after), rule.timezone)
    .toMillis();
}

function parseRule(value: unknown): Rule | null {
  if (value === null) return null;
  object(value);
  if (
    value.type === 'interval' &&
    Number.isSafeInteger(value.minutes) &&
    Number(value.minutes) >= 1 &&
    Number(value.minutes) <= 10080
  ) {
    return { type: 'interval', minutes: Number(value.minutes) };
  }
  if (
    (value.type === 'daily' || value.type === 'weekly') &&
    typeof value.time === 'string' &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) &&
    typeof value.timezone === 'string' &&
    value.timezone.length <= 100
  ) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value.timezone });
    } catch {
      throw new BadRequestException('Invalid schedule time zone');
    }
    const clock = { time: value.time, timezone: value.timezone };
    if (value.type === 'daily') return { type: 'daily', ...clock };
    if (
      Number.isSafeInteger(value.weekday) &&
      Number(value.weekday) >= 0 &&
      Number(value.weekday) <= 6
    ) {
      return { type: 'weekly', ...clock, weekday: Number(value.weekday) };
    }
  }
  throw new BadRequestException('Invalid schedule rule');
}

function variables(
  raw: unknown,
  overrides: Schedule['overrides'] = [],
): Variable[] {
  if (typeof raw === 'string') raw = JSON.parse(raw);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => typeof row?.key === 'string' && row.key)
    .map((row) => {
      const secret = row.secret === true;
      const override = overrides.find(
        (item) => item.key === row.key && item.secret === secret,
      );
      return {
        key: row.key,
        secret,
        initialValue: row.initialValue ?? row.value ?? '',
        currentValue: override?.value ?? row.currentValue ?? '',
      };
    });
}

@Injectable()
export class WorkbenchAutomationService implements OnModuleDestroy {
  private readonly logger = new Logger(WorkbenchAutomationService.name);
  private readonly startedAt = Date.now();
  private readonly workers = new Set<Worker>();
  private readonly activeRuns = new Map<
    string,
    {
      id: string;
      ownerUid: string;
      planID: string;
      name: string;
      status: 'running' | 'completed' | 'failed';
      startedAt: number;
      completed: number;
      total: number;
    }
  >();
  runs(ownerUid: string) {
    return [...this.activeRuns.values()]
      .filter((run) => run.ownerUid === ownerUid)
      .map(({ ownerUid: _owner, ...run }) => run)
      .reverse();
  }
  private scanning = false;
  private closing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly domain: McpDomainService,
    private readonly collections: UserCollectionService,
  ) {}

  async schedules(ownerUid: string) {
    const rows = await this.prisma.workbenchConfig.findMany({
      where: { ownerUid, kind: scheduleKind },
    });
    return rows.map(({ value }) => {
      const { planID, environmentID, rule, nextRunAt } =
        decode<Schedule>(value);
      return { planID, environmentID, rule, nextRunAt };
    });
  }

  async reports(ownerUid: string) {
    const rows = await this.prisma.workbenchConfig.findMany({
      where: { ownerUid, kind: reportKind },
      orderBy: { createdOn: 'desc' },
      take: 20,
    });
    return rows.map(({ value }) => decode(value));
  }

  async save(ownerUid: string, input: unknown, planID?: string) {
    object(input);
    if (input.config !== undefined)
      validateData('automation', { config: input.config }, true);
    const rule = parseRule(input.rule);
    const environmentID = input.environmentID;
    if (
      environmentID !== null &&
      (typeof environmentID !== 'string' || !environmentID)
    ) {
      throw new BadRequestException('Invalid environment');
    }

    const env = environmentID
      ? await this.prisma.userEnvironment.findFirst({
          where: { id: environmentID, userUid: ownerUid, isGlobal: false },
        })
      : null;
    if ((rule || input.config !== undefined) && environmentID && !env)
      throw new NotFoundException('Environment not found');

    const overrides: Schedule['overrides'] = [];
    if (rule && input.overrides !== undefined) {
      if (!Array.isArray(input.overrides) || input.overrides.length > 500)
        throw new BadRequestException('Invalid environment values');
      const allowed = new Map(
        variables(env?.variables).map(({ key, secret }) => [key, secret]),
      );
      for (const item of input.overrides) {
        object(item);
        if (
          typeof item.key !== 'string' ||
          typeof item.secret !== 'boolean' ||
          typeof item.value !== 'string' ||
          item.value.length > 65536
        )
          throw new BadRequestException('Invalid environment value');
        if (allowed.get(item.key) === item.secret) {
          overrides.push({
            key: item.key,
            secret: item.secret,
            value: item.value,
          });
        }
      }
    }

    const nextRunAt = rule ? nextRun(rule, Date.now()) : null;
    if (!planID) {
      const requestID = input.requestID;
      const collectionID = input.collectionID;
      if (!rule || (requestID === undefined) === (collectionID === undefined)) {
        throw new BadRequestException(
          'A group or request and a schedule are required',
        );
      }
      if (
        requestID !== undefined &&
        (typeof requestID !== 'string' || !requestID)
      )
        throw new BadRequestException('Invalid request');
      if (
        collectionID !== undefined &&
        (typeof collectionID !== 'string' || !collectionID)
      )
        throw new BadRequestException('Invalid collection');
      const target =
        requestID !== undefined
          ? await this.domain.get('request', requestID as string, ownerUid)
          : await this.domain.get(
              'collection',
              collectionID as string,
              ownerUid,
            );
      const id = randomUUID();
      await this.prisma.$transaction([
        this.prisma.workbenchConfig.create({
          data: {
            id,
            ownerUid,
            kind: 'automation',
            value: encode({
              name: target.title,
              collectionID:
                requestID !== undefined ? target.collectionID : target.id,
              requestID,
              environmentID,
              config: { iterations: 1, delay: 0, ...Object(input.config) },
            }),
          },
        }),
        this.prisma.workbenchConfig.create({
          data: {
            id: `${id}:schedule`,
            ownerUid,
            kind: scheduleKind,
            value: encode({
              planID: id,
              environmentID,
              rule,
              overrides,
              nextRunAt,
            }),
          },
        }),
      ]);
      workbenchEvents.publish(ownerUid, 'automation');
      workbenchEvents.publish(ownerUid, 'plans');
      return { planID: id, environmentID, rule, nextRunAt };
    }

    await this.prisma.$transaction(async (tx) => {
      // 先锁计划行再写定时配置，和删除操作保持相同顺序。
      const { count } = await tx.workbenchConfig.updateMany({
        where: { id: planID, ownerUid, kind: 'automation' },
        data: { revision: { increment: 0 } },
      });
      if (!count) throw new NotFoundException('Configuration not found');
      if (input.config !== undefined) {
        const plan = await tx.workbenchConfig.findFirst({
          where: { id: planID, ownerUid, kind: 'automation' },
        });
        const before = decode<Record<string, unknown>>(plan.value);
        await tx.workbenchConfig.updateMany({
          where: { id: planID, ownerUid, kind: 'automation' },
          data: {
            value: encode({
              ...before,
              environmentID,
              config: { ...Object(before.config), ...Object(input.config) },
            }),
            revision: { increment: 1 },
          },
        });
      }
      const id = `${planID}:schedule`;
      const where = { id, ownerUid, kind: scheduleKind };
      const current = await tx.workbenchConfig.findFirst({ where });
      const value = encode({
        planID,
        environmentID,
        rule,
        overrides,
        nextRunAt,
        leaseUntil: current
          ? decode<Schedule>(current.value).leaseUntil
          : undefined,
      });
      if (current) {
        const { count: updated } = await tx.workbenchConfig.updateMany({
          where: { ...where, revision: current.revision },
          data: { value, revision: { increment: 1 } },
        });
        if (!updated)
          throw new BadRequestException(
            'Schedule changed; reopen and try again',
          );
      } else {
        await tx.workbenchConfig.create({ data: { ...where, value } });
      }
    });
    workbenchEvents.publish(ownerUid, 'automation');
    workbenchEvents.publish(ownerUid, 'plans');
    return { planID, environmentID, rule, nextRunAt };
  }

  @Interval(5000)
  async tick() {
    if (this.scanning || this.closing) return;
    this.scanning = true;
    try {
      const ownerUid = LOCAL_WORKSPACE_UID;
      const rows = await this.prisma.workbenchConfig.findMany({
        where: { ownerUid, kind: scheduleKind },
      });
      for (const row of rows) {
        const schedule = decode<Schedule>(row.value);
        const now = Date.now();
        if (!schedule.rule || !schedule.nextRunAt || schedule.nextRunAt > now)
          continue;
        const due = schedule.nextRunAt;
        // 先原子领取这一轮，再发请求。服务停机期间错过的轮次和重叠轮次不补跑。
        const shouldRun =
          due >= this.startedAt &&
          now - due < 30_000 &&
          !(schedule.leaseUntil > now);
        schedule.nextRunAt = nextRun(schedule.rule, now, due);
        if (shouldRun) schedule.leaseUntil = now + timeoutMs + 30_000;
        const { count } = await this.prisma.workbenchConfig.updateMany({
          where: { id: row.id, revision: row.revision },
          data: { value: encode(schedule), revision: { increment: 1 } },
        });
        if (count) workbenchEvents.publish(ownerUid, 'automation');
        if (count && shouldRun) {
          void this.execute(ownerUid, schedule, due).catch(() =>
            this.logger.warn('Could not record an automation run'),
          );
        }
      }
    } catch {
      this.logger.warn('Could not scan scheduled automation');
    } finally {
      this.scanning = false;
    }
  }

  private async execute(ownerUid: string, schedule: Schedule, due: number) {
    const started = Date.now();
    const id = randomUUID();
    let name = 'Automation';
    const run = {
      id,
      ownerUid,
      planID: schedule.planID,
      name,
      status: 'running' as 'running' | 'completed' | 'failed',
      startedAt: started,
      completed: 0,
      total: 0,
    };
    this.activeRuns.set(id, run);
    for (const [key, previous] of this.activeRuns) {
      if (this.activeRuns.size <= 20) break;
      if (previous.status !== 'running') this.activeRuns.delete(key);
    }
    workbenchEvents.publish(ownerUid, 'automation');
    let result: Record<string, unknown>;
    try {
      const plan = await this.domain.get(
        'automation',
        schedule.planID,
        ownerUid,
      );
      name = plan.name;
      run.name = name;
      let tree: CollectionFolder;
      if (plan.requestID) {
        const request = await this.prisma.userRequest.findFirst({
          where: { id: plan.requestID, userUid: ownerUid },
          include: { userCollection: true },
        });
        if (!request || request.userCollection.userUid !== ownerUid)
          throw new Error('request_missing');
        // 请求移动时沿用其实际所属目录的配置，其他请求不进入后台运行器。
        const folder = request.userCollection;
        tree = {
          id: folder.id,
          name: folder.title,
          data: transformCollectionData(folder.data),
          folders: [],
          requests: [
            {
              ...(request.request as Record<string, unknown>),
              id: request.id,
              name: request.title,
            },
          ],
        };
      } else {
        const collection =
          await this.collections.exportUserCollectionToJSONObject(
            ownerUid,
            plan.collectionID,
          );
        if (E.isLeft(collection)) throw new Error('collection_missing');
        tree = collection.right;
      }
      let childID = tree.id;
      const visited = new Set<string>();
      // 选择子目录时，祖先只提供继承配置；祖先的接口不会进入执行范围。
      while (!visited.has(childID)) {
        visited.add(childID);
        const child = await this.prisma.userCollection.findFirst({
          where: { id: childID, userUid: ownerUid },
          include: { parent: true },
        });
        const parent = child?.parent;
        if (!parent || parent.userUid !== ownerUid || visited.has(parent.id))
          break;
        tree = {
          id: parent.id,
          name: parent.title,
          data: transformCollectionData(parent.data),
          folders: [tree],
          requests: [],
        };
        childID = parent.id;
      }
      const [selected, global] = await Promise.all([
        schedule.environmentID
          ? this.prisma.userEnvironment.findFirst({
              where: {
                id: schedule.environmentID,
                userUid: ownerUid,
                isGlobal: false,
              },
            })
          : null,
        this.prisma.userEnvironment.findFirst({
          where: { userUid: ownerUid, isGlobal: true },
        }),
      ]);
      if (schedule.environmentID && !selected)
        throw new Error('environment_missing');
      result = await this.run(
        {
          collection: tree,
          envs: {
            selected: variables(selected?.variables, schedule.overrides),
            global: variables(global?.variables),
          },
          config: plan.config ?? {},
        },
        (progress) => {
          run.completed = progress.completed;
          run.total = progress.total;
          workbenchEvents.publish(ownerUid, 'automation');
        },
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        // MCP 删除计划后，清理其独立定时配置，避免留下反复触发的任务。
        await this.prisma.workbenchConfig.deleteMany({
          where: {
            id: `${schedule.planID}:schedule`,
            ownerUid,
            kind: scheduleKind,
          },
        });
        this.activeRuns.delete(id);
        workbenchEvents.publish(ownerUid, 'automation');
        return;
      }
      const code =
        error instanceof Error &&
        [
          'collection_missing',
          'request_missing',
          'environment_missing',
          'timeout',
          'invalid_request',
        ].includes(error.message)
          ? error.message
          : 'runner_error';
      result = {
        summary: { completed: 0, failed: 1, elapsedMs: Date.now() - started },
        automation: {
          status: code,
          passedTests: 0,
          failedTests: 0,
          totalTests: 0,
        },
      };
    }

    try {
      await this.prisma.workbenchConfig.create({
        data: {
          id,
          ownerUid,
          kind: reportKind,
          value: encode({
            id,
            kind: 'automation',
            name,
            trigger: 'schedule',
            createdAt: new Date(started).toISOString(),
            scheduledAt: new Date(due).toISOString(),
            ...result,
          }),
        },
      });
      run.status = (result.summary as { failed?: number })?.failed
        ? 'failed'
        : 'completed';
      workbenchEvents.publish(ownerUid, 'automation');
    } finally {
      if (run.status === 'running') run.status = 'failed';
      workbenchEvents.publish(ownerUid, 'automation');
      const where = {
        id: `${schedule.planID}:schedule`,
        ownerUid,
        kind: scheduleKind,
      };
      const row = await this.prisma.workbenchConfig.findFirst({ where });
      if (row) {
        const current = decode<Schedule>(row.value);
        if (current.leaseUntil === schedule.leaseUntil) {
          delete current.leaseUntil;
          await this.prisma.workbenchConfig.updateMany({
            where: { ...where, revision: row.revision },
            data: { value: encode(current), revision: { increment: 1 } },
          });
        }
      }
    }
  }

  private async run(
    workerData: unknown,
    onProgress?: (progress: { completed: number; total: number }) => void,
  ): Promise<Record<string, unknown>> {
    if (this.closing) throw new Error('runner_error');
    // 执行进程只接收这轮的数据，脚本和 CLI 不能读取后端进程的凭证或向服务日志输出请求。
    const worker = new Worker(join(__dirname, 'automation.worker.js'), {
      workerData,
      env: {},
      stdout: true,
      stderr: true,
    });
    this.workers.add(worker);
    worker.stdout.resume();
    worker.stderr.resume();
    let timer: NodeJS.Timeout;
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        worker.on('message', (data) => {
          if (
            data.progress &&
            Number.isSafeInteger(data.progress.completed) &&
            Number.isSafeInteger(data.progress.total) &&
            data.progress.completed >= 0 &&
            data.progress.total >= data.progress.completed
          ) {
            onProgress?.(data.progress);
            return;
          }
          if (data.result) resolve(data.result);
          else reject(new Error(data.error));
        });
        worker.once('error', reject);
        worker.once('exit', () => reject(new Error('runner_error')));
      });
    } finally {
      clearTimeout(timer);
      await worker.terminate();
      this.workers.delete(worker);
    }
  }

  async onModuleDestroy() {
    this.closing = true;
    await Promise.all([...this.workers].map((worker) => worker.terminate()));
  }
}
