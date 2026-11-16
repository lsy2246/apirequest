import { resolveMockAction } from './mock-actions';
import { workbenchEvents } from '../workbench-events';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { randomBytes } from 'node:crypto';
import { Prisma } from 'src/generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  RuleSet,
  IncomingMock,
  parseMockRules,
  selectMockStep,
  explainMock,
  renderStep,
  parseOptions,
  normalizeIncoming,
  ruleFromLog,
  advanceMock,
} from './mock-engine';
export {
  parseMockRules,
  selectMockStep,
  sseEvents,
  summarizeMockRules,
  MAX_MOCK_FILE_BYTES,
} from './mock-engine';
function invalid(field: string): never {
  throw new BadRequestException(`Invalid Mock rule field: ${field}`);
}
function object(input: unknown, field: string): Record<string, any> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    invalid(field);
  return input as Record<string, any>;
}
function string(input: unknown, field: string, max: number) {
  if (typeof input !== 'string' || input.length > max) invalid(field);
  return input as string;
}
function integer(input: unknown, field: string, min: number, max: number) {
  if (
    typeof input !== 'number' ||
    !Number.isInteger(input) ||
    input < min ||
    input > max
  )
    invalid(field);
  return input;
}

@Injectable()
export class MockRuleService {
  constructor(private readonly prisma: PrismaService) {}

  async state(id: string, uid: string) {
    const row = await this.prisma.mockServer.findFirst({
      where: {
        id,
        workspaceID: uid,
        workspaceType: 'USER',
        deletedAt: null,
        collectionID: '',
      },
      select: { ruleSet: true },
    });
    if (!row?.ruleSet) throw new NotFoundException('Mock service not found');
    return row.ruleSet as unknown as RuleSet;
  }

  async save(id: string, uid: string, input: unknown) {
    const body = object(input, 'rule set');
    const revision = integer(
      body.revision,
      'revision',
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const rules = parseMockRules(body.rules);
    const result = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ ruleSet: RuleSet | null }[]>`
        SELECT "ruleSet" FROM "MockServer"
        WHERE id = ${id} AND "workspaceID" = ${uid} AND "workspaceType" = 'USER' AND "deletedAt" IS NULL
        FOR UPDATE
      `;
      if (!row?.ruleSet) throw new NotFoundException('Mock service not found');
      const current = row.ruleSet;
      if (current.revision !== revision)
        throw new ConflictException(
          'Mock rules changed. Refresh before saving.',
        );
      if (current.kind === 'single' && rules.length !== 1)
        throw new BadRequestException(
          'A single Mock must contain exactly one rule',
        );
      const oldRules = new Map(
        parseMockRules(current.rules).map((rule) => [rule.id, rule]),
      );
      const hits = Object.fromEntries(
        rules
          .filter(
            (rule) =>
              current.hits[rule.id] &&
              // 启停保留响应进度；匹配或响应内容变化后才重新计数。
              isDeepStrictEqual(
                { ...rule, enabled: true },
                { ...oldRules.get(rule.id), enabled: true },
              ),
          )
          .map((rule) => [rule.id, current.hits[rule.id]]),
      );
      const state = {
        kind: current.kind ?? 'collection',
        revision: revision + 1,
        rules,
        hits,
        states: current.states ?? {},
        options:
          body.options === undefined
            ? (current.options ?? {})
            : parseOptions(body.options),
      };
      await tx.mockServer.update({
        where: { id },
        data: { ruleSet: state as unknown as Prisma.InputJsonValue },
      });
      return state;
    });
    workbenchEvents.publish(uid, 'mock', id);
    return result;
  }

  async move(id: string, uid: string, input: unknown) {
    const body = object(input, 'move');
    const revision = integer(
      body.revision,
      'revision',
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const ruleID = string(body.ruleID, 'rule ID', 64);
    const targetID =
      body.targetID === null ? null : string(body.targetID, 'target ID', 64);
    if (targetID === id) invalid('target ID');
    const targetRevision =
      targetID === null
        ? null
        : integer(
            body.targetRevision,
            'target revision',
            0,
            Number.MAX_SAFE_INTEGER,
          );
    const result = await this.prisma.$transaction(async (tx) => {
      // 两个服务按相同顺序加锁，移动与实际请求计数在同一事务中串行化。
      const rows = await tx.$queryRaw<
        {
          id: string;
          name: string;
          ruleSet: RuleSet | null;
          isActive: boolean;
          isPublic: boolean;
          delayInMs: number;
        }[]
      >`
        SELECT id, name, "ruleSet", "isActive", "isPublic", "delayInMs" FROM "MockServer"
        WHERE id IN (${id}, ${targetID ?? id}) AND "workspaceID" = ${uid}
          AND "workspaceType" = 'USER' AND "collectionID" = '' AND "deletedAt" IS NULL
        ORDER BY id FOR UPDATE
      `;
      const source = rows.find((row) => row.id === id);
      const target = rows.find((row) => row.id === targetID);
      if (!source?.ruleSet || (targetID && !target?.ruleSet))
        throw new NotFoundException('Mock service not found');
      if (
        source.ruleSet.revision !== revision ||
        (target && target.ruleSet?.revision !== targetRevision)
      )
        throw new ConflictException(
          'Mock rules changed. Refresh before moving.',
        );
      if (
        target?.ruleSet?.kind === 'single' ||
        (target?.ruleSet?.rules.length ?? 0) >= 1000
      )
        throw new BadRequestException(
          'Choose a Mock collection with fewer than 1000 rules',
        );
      const rule = source.ruleSet.rules.find((rule) => rule.id === ruleID);
      if (!rule) throw new NotFoundException('Mock rule not found');
      if (target?.ruleSet?.rules.some((entry) => entry.id === ruleID))
        throw new ConflictException(
          'Mock rule already exists in the destination',
        );
      const hits = source.ruleSet.hits[ruleID] ?? 0;
      // 将来源服务的默认延迟固化到规则，跨集合移动后保持实际响应时序。
      const movedRule = {
        ...rule,
        steps: rule.steps.map((step) => ({
          ...step,
          delayMs: step.delayMs ?? source.delayInMs,
        })),
      };
      // 移动同样遵守目标规则集的正文与文件容量限制。
      parseMockRules([...(target?.ruleSet?.rules ?? []), movedRule]);
      let destinationID: string;
      if (target?.ruleSet) {
        target.ruleSet.rules.push(movedRule);
        target.ruleSet.hits[ruleID] = hits;
        target.ruleSet.revision++;
        await tx.mockServer.update({
          where: { id: target.id },
          data: {
            ruleSet: target.ruleSet as unknown as Prisma.InputJsonValue,
          },
        });
        destinationID = target.id;
      } else {
        // 移出集合时连同新地址一起提交；失败回滚，避免出现空服务或重复规则。
        const destination = await tx.mockServer.create({
          data: {
            name: rule.name || source.name,
            subdomain: randomBytes(8).toString('hex'),
            creatorUid: uid,
            collectionID: '',
            workspaceType: 'USER',
            workspaceID: uid,
            isActive: source.isActive,
            isPublic: source.isPublic,
            delayInMs: source.delayInMs,
            ruleSet: {
              kind: 'single',
              revision: 0,
              rules: [movedRule],
              hits: { [ruleID]: hits },
            } as unknown as Prisma.InputJsonValue,
          },
        });
        destinationID = destination.id;
      }
      source.ruleSet.rules = source.ruleSet.rules.filter(
        (entry) => entry.id !== ruleID,
      );
      delete source.ruleSet.hits[ruleID];
      source.ruleSet.revision++;
      await tx.mockServer.update({
        where: { id },
        data: {
          ruleSet: source.ruleSet as unknown as Prisma.InputJsonValue,
          ...(source.ruleSet.kind === 'single'
            ? { deletedAt: new Date(), isActive: false }
            : {}),
        },
      });
      return { destinationID };
    });
    workbenchEvents.publish(uid, 'mock', id);
    return result;
  }

  async reset(id: string, uid: string, ruleID?: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ ruleSet: RuleSet | null }[]>`
        SELECT "ruleSet" FROM "MockServer"
        WHERE id = ${id} AND "workspaceID" = ${uid} AND "workspaceType" = 'USER' AND "deletedAt" IS NULL
        FOR UPDATE
      `;
      if (!row?.ruleSet) throw new NotFoundException('Mock service not found');
      const state = row.ruleSet;
      if (ruleID) delete state.hits[ruleID];
      else {
        state.hits = {};
        state.states = {};
      }
      await tx.mockServer.update({
        where: { id },
        data: { ruleSet: state as unknown as Prisma.InputJsonValue },
      });
      return state;
    });
    workbenchEvents.publish(uid, 'mock', id);
    return result;
  }

  async match(id: string, request: IncomingMock) {
    // 只在分配命中次数时锁住规则，等待响应延迟发生在事务提交之后。
    let owner: string | undefined;
    const result = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        {
          ruleSet: RuleSet | null;
          isActive: boolean;
          workspaceID: string;
          workspaceType: string;
        }[]
      >`
        SELECT "ruleSet", "isActive", "workspaceID", "workspaceType" FROM "MockServer" WHERE id = ${id} AND "deletedAt" IS NULL FOR UPDATE
      `;
      if (!row?.isActive) return { stopped: true } as const;
      if (!row.ruleSet) return null;
      const explained = explainMock(row.ruleSet, request);
      const selected = explained.selection;
      if (selected) {
        if (row.workspaceType === 'USER') owner = row.workspaceID;
        advanceMock(row.ruleSet, selected);
        await tx.mockServer.update({
          where: { id },
          data: { ruleSet: row.ruleSet as unknown as Prisma.InputJsonValue },
        });
      }
      return selected
        ? {
            ...selected,
            step: renderStep(selected.step, request, selected.params),
            trace: explained.trace,
            options: row.ruleSet.options ?? {},
          }
        : {
            unmatched: true as const,
            trace: explained.trace,
            options: row.ruleSet.options ?? {},
          };
    });
    if (owner) workbenchEvents.publish(owner, 'mock', id);
    return result;
  }

  preview(input: unknown) {
    const raw = object(input, 'preview');
    return this.inspectState(
      { revision: 0, rules: parseMockRules(raw.rules), hits: {}, states: {} },
      raw,
    );
  }

  async inspect(id: string, uid: string, input: unknown) {
    return this.inspectState(await this.state(id, uid), input);
  }

  private async inspectState(current: RuleSet, input: unknown) {
    const raw = object(input, 'preview');
    const state =
      raw.rules === undefined
        ? current
        : { ...current, rules: parseMockRules(raw.rules) };
    const request = normalizeIncoming(raw.request ?? raw);
    const result = explainMock(state, request);
    let step = result.selection
      ? renderStep(result.selection.step, request, result.selection.params)
      : undefined;
    if (step?.action === 'script') {
      try {
        step = await resolveMockAction(step, request, result.selection!.params);
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    return {
      trace: result.trace,
      selection: result.selection
        ? {
            ...result.selection,
            step: step!,
          }
        : null,
      fallback: !result.selection ? (state.options?.fallback ?? null) : null,
      states: state.states ?? {},
    };
  }

  async logs(id: string, uid: string, skip = 0) {
    await this.state(id, uid);
    return this.prisma.$queryRaw<any[]>`
      SELECT id, "requestMethod", "requestPath", "responseStatus", "responseTime", "executedAt",
        ("mockMatch" - 'rawRequestBase64' - 'trace') AS "mockMatch"
      FROM "MockServerLog" WHERE "mockServerID" = ${id}
      ORDER BY "executedAt" DESC, id DESC OFFSET ${skip} LIMIT 100
    `;
  }

  async log(id: string, uid: string, logID: string) {
    await this.state(id, uid);
    const log = await this.prisma.mockServerLog.findFirst({
      where: { id: logID, mockServerID: id },
    });
    if (!log) throw new NotFoundException('Mock request not found');
    return log;
  }
  async clearLogs(id: string, uid: string) {
    await this.state(id, uid);
    await this.prisma.mockServerLog.deleteMany({ where: { mockServerID: id } });
    workbenchEvents.publish(uid, 'mock', id);
    return { cleared: true };
  }
  async capture(id: string, uid: string, logID: string) {
    return ruleFromLog(await this.log(id, uid, logID));
  }
}
