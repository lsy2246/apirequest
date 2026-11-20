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
import {
  getAutomationConfig,
  DEFAULT_CASE_TIMEOUT_MS,
  type AutomationConfig,
} from '@apirequest/data';
import { ReqType } from 'src/types/RequestTypes';
import { LOCAL_WORKSPACE_UID } from 'src/auth/local-workspace/policy';
import { PrismaService } from 'src/prisma/prisma.service';
import { CollectionFolder } from 'src/types/CollectionFolder';
import { UserCollectionService } from 'src/user-collection/user-collection.service';
import { decrypt, encrypt, transformCollectionData } from 'src/utils';
import { object, validateData } from './contract';
import { McpDomainService } from './domain.service';
import { workbenchEvents } from '../workbench-events';
import { AutomationWebhookService } from './automation-webhook.service';

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
  draftRule?: Rule | null;
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
      status: 'running' | 'pausing' | 'paused' | 'completed' | 'failed';
      startedAt: number;
      completed: number;
      total: number;
      discarded?: boolean;
    }
  >();
  runs(ownerUid: string) {
    return [...this.activeRuns.values()]
      .filter((run) => run.ownerUid === ownerUid)
      .map(({ ownerUid: _owner, ...run }) => run)
      .reverse();
  }
  private readonly runActions = new Map<
    string,
    (action: 'pause' | 'resume' | 'discard') => void
  >();

  private readonly runDiscards = new Map<string, () => Promise<void>>();

  async control(
    ownerUid: string,
    id: string,
    action: unknown,
    choice?: unknown,
  ) {
    const run = this.activeRuns.get(id);
    if (!run && action === 'resume') {
      const row = await this.prisma.workbenchConfig.findFirst({
        where: { id, ownerUid, kind: reportKind },
      });
      if (!row) throw new NotFoundException('Run not found');
      const report = decode<Record<string, any>>(row.value);
      if (!report.recovery)
        throw new BadRequestException('This report has no recovery snapshot');
      if (
        !['interrupted', 'paused', 'error', 'runner_error', 'timeout'].includes(
          report.automation?.status,
        )
      )
        throw new BadRequestException('Run cannot be resumed');
      if (report.recovery.inFlight && choice !== 'retry' && choice !== 'skip')
        throw new BadRequestException(
          'Choose retry or skip for the unknown request',
        );
      if (report.recovery.inFlight && choice === 'skip') {
        const entry = report.recovery.inFlight;
        report.recovery.results.push({
          path: entry.name,
          requestName: entry.name,
          iteration: entry.iteration,
          result: false,
          tests: [],
          errors: [
            {
              code: 'REQUEST_ERROR',
              data: 'Skipped after interruption; original outcome is unknown',
            },
          ],
          duration: { request: 0, test: 0, preRequest: 0 },
        });
      }
      report.events = [
        ...(report.events ?? []),
        {
          at: new Date().toISOString(),
          action: choice ?? 'resume',
          details: report.errorDetails,
        },
      ];
      report.recovery.inFlight = undefined;
      void this.execute(
        ownerUid,
        {
          planID: report.planID ?? '',
          environmentID: null,
          rule: null,
          overrides: [],
          nextRunAt: null,
        },
        Date.now(),
        report,
      ).catch(() => this.logger.warn('Could not resume automation run'));
      return { id, status: 'running' };
    }
    if (!run || run.ownerUid !== ownerUid)
      throw new NotFoundException('Run not found');
    if (action !== 'pause' && action !== 'resume')
      throw new BadRequestException('Invalid run action');
    const send = this.runActions.get(id);
    if (run.discarded) throw new BadRequestException('Run is no longer active');
    if (!send || !['running', 'pausing', 'paused'].includes(run.status))
      throw new BadRequestException('Run is no longer active');
    send(action);
    return { id, status: run.status };
  }
  private scanning = false;
  private closing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly domain: McpDomainService,
    private readonly collections: UserCollectionService,
    private readonly webhooks?: AutomationWebhookService,
  ) {}

  async schedules(ownerUid: string) {
    const rows = await this.prisma.workbenchConfig.findMany({
      where: { ownerUid, kind: scheduleKind },
    });
    return rows.map(({ value }) => {
      const { planID, environmentID, rule, draftRule, nextRunAt } =
        decode<Schedule>(value);
      return { planID, environmentID, rule, draftRule, nextRunAt };
    });
  }

  async reports(ownerUid: string) {
    const deliveries = await this.webhooks?.deliveries(ownerUid);
    const rows = await this.prisma.workbenchConfig.findMany({
      where: { ownerUid, kind: reportKind },
      orderBy: { createdOn: 'desc' },
    });
    return Promise.all(
      rows.map(async ({ id, value }) => {
        const report = decode<Record<string, any>>(value);
        if (
          ['running', 'pausing', 'paused'].includes(
            report.automation?.status,
          ) &&
          !this.activeRuns.has(id)
        ) {
          report.automation.status = 'interrupted';
          await this.prisma.workbenchConfig.updateMany({
            where: { id, ownerUid, kind: reportKind },
            data: { value: encode(report) },
          });
        }
        const { recovery, ...visible } = report;
        return {
          ...visible,
          backendStored: true,
          notification: deliveries?.get(id),
          canResume: !!recovery,
          uncertainRequest: [
            'interrupted',
            'error',
            'runner_error',
            'timeout',
          ].includes(report.automation?.status)
            ? recovery?.inFlight
            : undefined,
        };
      }),
    );
  }

  async deleteReport(ownerUid: string, id: string) {
    const run = this.activeRuns.get(id);
    if (
      run?.ownerUid === ownerUid &&
      ['running', 'pausing'].includes(run.status)
    )
      throw new BadRequestException('Cannot delete an active report');
    if (run?.ownerUid === ownerUid && run.status === 'paused')
      await this.runDiscards.get(id)?.();
    await this.prisma.workbenchConfig.deleteMany({
      where: { id, ownerUid, kind: reportKind },
    });
    workbenchEvents.publish(ownerUid, 'automation');
    return { id, deleted: true };
  }

  async save(ownerUid: string, input: unknown, planID?: string) {
    object(input);
    if (input.config !== undefined)
      validateData('automation', { config: input.config }, true);
    const rule = parseRule(input.rule);
    const draftRule =
      input.draftRule === undefined ? undefined : parseRule(input.draftRule);
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
    if (environmentID && !env)
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

    const requestID = input.requestID;
    const collectionID = input.collectionID;
    const hasTarget = requestID !== undefined || collectionID !== undefined;
    let target:
      { id: string; title: string; collectionID?: string } | undefined;
    if (!planID || hasTarget) {
      if ((requestID === undefined) === (collectionID === undefined))
        throw new BadRequestException('A group or request is required');
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
      target =
        requestID !== undefined
          ? await this.domain.get('request', requestID as string, ownerUid)
          : await this.domain.get(
              'collection',
              collectionID as string,
              ownerUid,
            );
    }
    const nextRunAt = rule ? nextRun(rule, Date.now()) : null;
    const targetFields = target
      ? {
          collectionID:
            requestID !== undefined ? target.collectionID : target.id,
          requestID,
        }
      : {};
    if (!planID) {
      const id = randomUUID();
      await this.prisma.$transaction([
        this.prisma.workbenchConfig.create({
          data: {
            id,
            ownerUid,
            kind: 'automation',
            value: encode({
              name: target.title,
              ...targetFields,
              environmentID,
              config: getAutomationConfig(input.config),
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
              draftRule: rule ?? draftRule ?? null,
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
      const plan = await tx.workbenchConfig.findFirst({
        where: { id: planID, ownerUid, kind: 'automation' },
      });
      const before = decode<Record<string, unknown>>(plan.value);
      await tx.workbenchConfig.updateMany({
        where: { id: planID, ownerUid, kind: 'automation' },
        data: {
          value: encode({
            ...before,
            ...targetFields,
            environmentID,
            ...(input.config !== undefined
              ? {
                  config: getAutomationConfig({
                    ...Object(before.config),
                    ...Object(input.config),
                  }),
                }
              : {}),
          }),
          revision: { increment: 1 },
        },
      });
      const id = `${planID}:schedule`;
      const where = { id, ownerUid, kind: scheduleKind };
      const current = await tx.workbenchConfig.findFirst({ where });
      const previous = current ? decode<Schedule>(current.value) : undefined;
      const value = encode({
        planID,
        environmentID,
        rule,
        draftRule:
          rule ?? draftRule ?? previous?.draftRule ?? previous?.rule ?? null,
        overrides,
        nextRunAt,
        leaseUntil: previous?.leaseUntil,
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
          !(schedule.leaseUntil > now) &&
          ![...this.activeRuns.values()].some(
            (run) =>
              run.planID === schedule.planID &&
              ['running', 'pausing', 'paused'].includes(run.status),
          );
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

  private async execute(
    ownerUid: string,
    schedule: Schedule,
    due: number,
    resumed?: Record<string, any>,
  ) {
    const started = Date.now();
    const previousElapsed = resumed?.summary?.elapsedMs ?? 0;
    const id = resumed?.id ?? randomUUID();
    if (this.activeRuns.has(id)) return;
    let name = resumed?.name ?? 'Automation';
    let environmentName = resumed?.environmentName;
    let webhook = resumed?.recovery?.input?.config
      ?.webhook as AutomationConfig['webhook'];
    const run = {
      id,
      ownerUid,
      planID: schedule.planID,
      name,
      status: 'running' as
        'running' | 'pausing' | 'paused' | 'completed' | 'failed',
      startedAt: started,
      completed: resumed?.summary?.completed ?? 0,
      total: resumed?.automation?.totalRequests ?? 0,
      discarded: false,
    };
    this.activeRuns.set(id, run);
    workbenchEvents.publish(ownerUid, 'automation');
    let result: Record<string, any> = resumed
      ? {
          ...resumed,
          errorDetails: [],
          automation: { ...resumed.automation, status: 'running' },
        }
      : {
          summary: { completed: 0, failed: 0, elapsedMs: 0 },
          automation: {
            status: 'running',
            passedTests: 0,
            failedTests: 0,
            totalTests: 0,
          },
          steps: [],
        };
    // Insert before execution, then update this same durable report at every checkpoint.
    let pendingSave = Promise.resolve();
    const record = () => {
      const value = encode({
        id,
        kind: 'automation',
        name,
        trigger: 'schedule',
        planID: schedule.planID,
        createdAt: resumed?.createdAt ?? new Date(started).toISOString(),
        scheduledAt: new Date(due).toISOString(),
        ...result,
        updatedAt: new Date().toISOString(),
        automation: {
          ...result.automation,
          totalRequests: run.total,
          status: ['pausing', 'paused'].includes(run.status)
            ? run.status
            : result.automation?.status,
        },
      });
      pendingSave = pendingSave
        .catch(() => {})
        .then(async () => {
          if (run.discarded) return;
          await this.prisma.workbenchConfig.upsert({
            where: { id },
            create: { id, ownerUid, kind: reportKind, value },
            update: { value },
          });
          workbenchEvents.publish(ownerUid, 'automation');
        });
      return pendingSave;
    };
    this.runDiscards.set(id, async () => {
      run.discarded = true;
      this.runActions.get(id)?.('discard');
      await pendingSave.catch(() => {});
    });
    const progressCallback = (progress: {
      completed: number;
      total: number;
      report?: Record<string, any>;
      recovery?: unknown;
    }) => {
      run.completed = progress.completed;
      run.total = progress.total;
      if (progress.report)
        result = {
          ...result,
          ...progress.report,
          summary: {
            ...progress.report.summary,
            elapsedMs: previousElapsed + progress.report.summary.elapsedMs,
          },
        };
      if (progress.recovery) result.recovery = progress.recovery;
      return record();
    };
    const statusCallback = async (status: 'running' | 'pausing' | 'paused') => {
      run.status = status;
      await record();
    };
    try {
      await record();
      if (resumed) {
        result = {
          ...result,
          ...(await this.run(
            { ...resumed.recovery.input, recovery: resumed.recovery },
            progressCallback,
            id,
            statusCallback,
          )),
        };
        result.summary.elapsedMs += previousElapsed;
        result.recovery = undefined;
      } else {
        const plan = await this.domain.get(
          'automation',
          schedule.planID,
          ownerUid,
        );
        name = plan.name;
        webhook = plan.config?.webhook;
        run.name = name;
        let tree: CollectionFolder;
        if (plan.config?.selectedRequestIDs) {
          const selectedIDs = new Set<string>(plan.config.selectedRequestIDs);
          if (!selectedIDs.size) throw new Error('No test cases selected');
          const exported = await this.collections.exportUserCollectionsToJSON(
            ownerUid,
            null,
            ReqType.REST,
          );
          if (E.isLeft(exported)) throw new Error('collection_missing');
          const found = new Set<string>();
          const prune = (node: CollectionFolder): CollectionFolder => ({
            ...node,
            folders: node.folders
              .map(prune)
              .filter(
                (folder) => folder.folders.length || folder.requests.length,
              ),
            requests: node.requests.filter((request) => {
              if (!selectedIDs.has(request.id)) return false;
              found.add(request.id);
              return true;
            }),
          });
          const folders = (
            JSON.parse(exported.right.exportedCollection) as CollectionFolder[]
          )
            .map(prune)
            .filter(
              (folder) => folder.folders.length || folder.requests.length,
            );
          if (found.size !== selectedIDs.size)
            throw new Error('request_missing');
          tree = {
            id: 'automation-selection',
            name: plan.name,
            data: null,
            folders,
            requests: [],
          };
        } else if (plan.requestID) {
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
        const caseEnvironments: Record<
          string,
          ReturnType<typeof variables>
        > = {};
        const caseEnvironmentIDs = new Set<string>();
        for (const entries of Object.values(
          plan.config?.requestCases ?? {},
        ) as { id: string; environmentID?: string | null }[][])
          for (const entry of entries)
            if (
              entry.environmentID &&
              (!plan.config.selectedCaseIDs ||
                plan.config.selectedCaseIDs.includes(entry.id))
            )
              caseEnvironmentIDs.add(entry.environmentID);
        for (const environmentID of caseEnvironmentIDs) {
          const environment = await this.prisma.userEnvironment.findFirst({
            where: { id: environmentID, userUid: ownerUid, isGlobal: false },
          });
          if (!environment) throw new Error('case_environment_missing');
          caseEnvironments[environmentID] = variables(
            environment.variables,
            environmentID === schedule.environmentID
              ? schedule.overrides
              : undefined,
          );
        }
        result = await this.run(
          {
            caseEnvironments,
            collection: tree,
            envs: {
              selected: variables(selected?.variables, schedule.overrides),
              global: variables(global?.variables),
            },
            config: plan.config ?? {},
          },
          progressCallback,
          id,
          statusCallback,
        );
        environmentName = selected?.name;
        result.recovery = undefined;
      }
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
        workbenchEvents.publish(ownerUid, 'automation');
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
        ...result,
        summary: {
          ...result.summary,
          failed: Math.max(1, result.summary.failed),
          elapsedMs: previousElapsed + Date.now() - started,
        },
        automation: { ...result.automation, status: code },
        errorDetails: [
          {
            code,
            data:
              error instanceof Error
                ? {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                    cause: error.cause,
                  }
                : String(error),
          },
        ],
      };
    }

    try {
      if (run.discarded) return;
      // Final write follows all acknowledged progress writes.
      run.status = 'running';
      result.environmentID = schedule.environmentID;
      result.environmentName = environmentName;
      await record();
      run.status = (result.summary as { failed?: number })?.failed
        ? 'failed'
        : 'completed';
      workbenchEvents.publish(ownerUid, 'automation');
      void this.webhooks
        ?.notify(
          ownerUid,
          {
            ...result,
            id,
            name,
            createdAt: resumed?.createdAt ?? new Date(started).toISOString(),
            automation: { ...result.automation, totalRequests: run.total },
          },
          webhook,
        )
        .catch(() =>
          this.logger.warn('Webhook delivery could not be recorded'),
        );
    } finally {
      this.runActions.delete(id);
      this.runDiscards.delete(id);
      this.activeRuns.delete(id);
      if (['running', 'pausing', 'paused'].includes(run.status))
        run.status = 'failed';
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
    onProgress?: (progress: {
      completed: number;
      total: number;
      report?: Record<string, any>;
      recovery?: unknown;
    }) => Promise<void>,
    runID?: string,
    onStatus?: (status: 'running' | 'pausing' | 'paused') => Promise<void>,
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
    const caseConfig = (workerData as { config?: AutomationConfig }).config;
    const caseCount = Object.values(caseConfig?.requestCases ?? {})
      .flat()
      .filter(
        (entry) =>
          !caseConfig?.selectedCaseIDs ||
          caseConfig.selectedCaseIDs.includes(entry.id),
      );
    const caseBudget =
      caseCount.reduce(
        (sum, entry) =>
          sum +
          (entry.timeoutMs ?? DEFAULT_CASE_TIMEOUT_MS) +
          (caseConfig?.delay ?? 0),
        0,
      ) * (caseConfig?.iterations ?? 1);
    const runBudget = Math.min(
      2_147_483_647,
      Math.max(timeoutMs, caseBudget + 30_000),
    );
    let timer: NodeJS.Timeout;
    try {
      return await new Promise((resolve, reject) => {
        let remaining = runBudget;
        let resumedAt = Date.now();
        let paused = false;
        let timerPaused = false;
        const armTimer = () => {
          resumedAt = Date.now();
          timer = setTimeout(() => reject(new Error('timeout')), remaining);
        };
        armTimer();
        if (runID)
          this.runActions.set(runID, (action) => {
            if (action === 'discard') {
              reject(new Error('discarded'));
              return;
            }
            if (action === 'pause' && !paused) {
              paused = true;
              void onStatus?.('pausing').catch(reject);
            } else if (action === 'resume' && paused) {
              paused = false;
              if (timerPaused) {
                timerPaused = false;
                armTimer();
              }
              void onStatus?.('running').catch(reject);
            }
            worker.postMessage({ action });
          });
        worker.on('message', async (data) => {
          if (data.paused) {
            if (data.auto) paused = true;
            if (paused)
              try {
                if (!timerPaused) {
                  timerPaused = true;
                  remaining = Math.max(1, remaining - (Date.now() - resumedAt));
                  clearTimeout(timer);
                }
                await onStatus?.('paused');
              } catch (error) {
                reject(error);
              }
            return;
          }
          if (
            data.progress &&
            Number.isSafeInteger(data.progress.completed) &&
            Number.isSafeInteger(data.progress.total) &&
            data.progress.completed >= 0 &&
            data.progress.total >= data.progress.completed
          ) {
            try {
              await onProgress?.(data.progress);
              worker.postMessage({ action: 'ack' });
            } catch (error) {
              reject(error);
            }
            return;
          }
          if (data.result) resolve(data.result);
          else reject(new Error(data.error, { cause: data.details }));
        });
        worker.once('error', reject);
        worker.once('exit', () => reject(new Error('runner_error')));
      });
    } finally {
      clearTimeout(timer);
      if (runID) this.runActions.delete(runID);
      await worker.terminate();
      this.workers.delete(worker);
    }
  }

  async onModuleDestroy() {
    this.closing = true;
    await Promise.all([...this.workers].map((worker) => worker.terminate()));
  }
}
