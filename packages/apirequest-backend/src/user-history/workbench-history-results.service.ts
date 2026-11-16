import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request } from 'express';
import { Prisma } from 'src/generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { LOCAL_WORKSPACE_UID } from '../auth/local-workspace/policy';

const day = 86_400_000;
const kinds = ['json', 'text', 'image', 'video', 'file'] as const;
type Kind = (typeof kinds)[number];
type ResultMetadata = {
  statusCode: number;
  statusText: string;
  duration: number;
  headers: { key: string; value: string }[];
  contentType: string;
};
type CleanupCriteria = {
  days: number;
  kind?: Kind;
  expected?: { count: number; bytes: string };
};
type PolicyInput = {
  enabled: boolean;
  autoCleanup: boolean;
  retentionDays: number;
  excludedRequestIds: string[];
};

function validDays(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 36500
  );
}

function mimeType(value: string | null | undefined) {
  const mime = value?.split(';', 1)[0]?.trim().toLowerCase();
  return mime && /^[\w.+-]+\/[\w.+-]+$/.test(mime)
    ? mime
    : 'application/octet-stream';
}

function responseKind(type: string): Kind {
  if (type === 'application/json' || type.endsWith('+json')) return 'json';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  return type.startsWith('text/') || type.endsWith('xml') ? 'text' : 'file';
}

function readMetadata(raw: Buffer): ResultMetadata & { requestId?: string } {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new BadRequestException('Invalid response metadata');
  }
  if (
    !value ||
    typeof value.statusCode !== 'number' ||
    !Number.isInteger(value.statusCode) ||
    typeof value.statusText !== 'string' ||
    typeof value.duration !== 'number' ||
    !Number.isFinite(value.duration) ||
    typeof value.contentType !== 'string' ||
    !Array.isArray(value.headers) ||
    !value.headers.every(
      (header) =>
        header &&
        typeof header.key === 'string' &&
        typeof header.value === 'string',
    ) ||
    (value.requestId !== undefined && typeof value.requestId !== 'string')
  ) {
    throw new BadRequestException('Invalid response metadata');
  }

  return {
    statusCode: value.statusCode,
    statusText: value.statusText,
    duration: value.duration,
    headers: value.headers.map(({ key, value }) => ({ key, value })),
    contentType: mimeType(value.contentType),
    requestId: value.requestId as string | undefined,
  };
}

@Injectable()
export class WorkbenchHistoryResultsService {
  private readonly logger = new Logger(WorkbenchHistoryResultsService.name);
  private readonly root: string;
  private readonly historyTable: Prisma.Sql;
  private readonly resultTable: Prisma.Sql;
  private readonly incoming = new Set<string>();
  private maintenanceRunning = false;
  private nextOrphanScan = 0;
  private pendingRemoval?: Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.root =
      config.get<string>('WORKBENCH_HISTORY_RESULTS_DIR') ??
      join(homedir(), '.local', 'share', 'apirequest', 'history-results');
    const schema =
      new URL(config.getOrThrow<string>('DATABASE_URL')).searchParams.get(
        'schema',
      ) || 'public';
    // Prisma 模型查询会限定 schema，旧记录的原生 SQL 也使用同一命名空间。
    const identifier = `"${schema.replaceAll('"', '""')}"`;
    this.historyTable = Prisma.raw(`${identifier}."UserHistory"`);
    this.resultTable = Prisma.raw(`${identifier}."WorkbenchHistoryResult"`);
  }

  async policy(uid: string, db: Prisma.TransactionClient = this.prisma) {
    return (
      (await db.workbenchHistoryPolicy.findUnique({ where: { uid } })) ?? {
        uid,
        enabled: false,
        autoCleanup: false,
        retentionDays: 30,
        excludedRequestIds: [] as string[],
        lastCleanupAt: null,
        lastAutoCleanupAt: null,
        lastCleanup: null,
      }
    );
  }

  private async lockPolicy(db: Prisma.TransactionClient, uid: string) {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'workbench-history:' + uid}))`;
  }

  async setPolicy(uid: string, body: Partial<PolicyInput>) {
    if (
      !body ||
      (body.enabled !== undefined && typeof body.enabled !== 'boolean') ||
      (body.autoCleanup !== undefined &&
        typeof body.autoCleanup !== 'boolean') ||
      (body.retentionDays !== undefined && !validDays(body.retentionDays)) ||
      (body.excludedRequestIds !== undefined &&
        (!Array.isArray(body.excludedRequestIds) ||
          !body.excludedRequestIds.every(
            (id) => typeof id === 'string' && id.length > 0 && id.length <= 256,
          )))
    ) {
      throw new BadRequestException('Invalid history results policy');
    }
    const settings = {
      enabled: body.enabled,
      autoCleanup: body.autoCleanup,
      retentionDays: body.retentionDays,
      excludedRequestIds: body.excludedRequestIds && [
        ...new Set(body.excludedRequestIds),
      ],
    };
    return this.prisma.$transaction(async (db) => {
      await this.lockPolicy(db, uid);
      return db.workbenchHistoryPolicy.upsert({
        where: { uid },
        create: { uid, ...settings },
        update: settings,
      });
    });
  }

  private async history(uid: string, id: string) {
    const history = await this.prisma.userHistory.findUnique({
      where: { id, userUid: uid },
      include: { workbenchResult: { include: { attachments: true } } },
    });
    if (!history) throw new NotFoundException();
    return history;
  }

  async detail(uid: string, id: string) {
    const {
      workbenchResult: result,
      reqType,
      responseMetadata,
    } = await this.history(uid, id);
    const summary =
      responseMetadata &&
      typeof responseMetadata === 'object' &&
      !Array.isArray(responseMetadata)
        ? {
            statusCode: responseMetadata.statusCode,
            duration: responseMetadata.duration,
          }
        : undefined;
    if (result?.cleanedAt) return { state: 'cleaned', summary };
    if (!result) {
      if (
        reqType === 'GQL' &&
        typeof responseMetadata === 'string' &&
        responseMetadata
      ) {
        return {
          state: 'saved',
          kind: 'json',
          size: String(Buffer.byteLength(responseMetadata)),
          metadata: { contentType: 'application/json', headers: [] },
          attachments: [],
          canAttach: false,
        };
      }
      if (
        responseMetadata &&
        typeof responseMetadata === 'object' &&
        'historyResultCleaned' in responseMetadata
      ) {
        return { state: 'cleaned', summary };
      }
      return { state: 'missing', summary };
    }
    return {
      state: 'saved',
      kind: result.kind,
      size: result.size.toString(),
      metadata: result.metadata,
      canAttach: true,
      attachments: result.attachments.map(
        ({ id, name, contentType, size }) => ({
          id,
          name,
          contentType,
          size: size.toString(),
        }),
      ),
    };
  }

  async body(uid: string, historyId: string, attachmentId?: string) {
    const {
      workbenchResult: result,
      reqType,
      responseMetadata,
    } = await this.history(uid, historyId);
    if (
      !result &&
      !attachmentId &&
      reqType === 'GQL' &&
      typeof responseMetadata === 'string' &&
      responseMetadata
    ) {
      return {
        text: responseMetadata,
        contentType: 'application/json',
        name: 'response.json',
      };
    }
    if (!result || result.cleanedAt) throw new NotFoundException();
    if (attachmentId) {
      const attachment = result.attachments.find(
        ({ id }) => id === attachmentId,
      );
      if (!attachment) throw new NotFoundException();
      return {
        path: join(this.root, result.id, attachment.id),
        contentType: attachment.contentType,
        name: attachment.name,
      };
    }
    const { contentType } = result.metadata as ResultMetadata;
    const extension =
      contentType.split('/')[1]?.replace(/[^a-z\d]/gi, '') || 'bin';
    return {
      path: join(this.root, result.id, 'body'),
      contentType,
      name: `response.${extension}`,
    };
  }

  async save(uid: string, historyId: string, request: Request) {
    if (!request.is('application/octet-stream'))
      throw new BadRequestException();
    if (!(await this.policy(uid)).enabled)
      throw new ConflictException('Saving results is disabled');
    const history = await this.history(uid, historyId);
    if (history.workbenchResult)
      throw new ConflictException('Result already exists');
    const id = randomUUID();
    const directory = join(this.root, id);
    this.incoming.add(id);

    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      let metadata: ReturnType<typeof readMetadata> | undefined;
      let prefix = Buffer.alloc(0);
      let size = 0n;
      // 首行是 JSON 元数据，其余字节按原样写入文件，避免整段响应在服务端内存中复制。
      async function* content() {
        for await (const chunk of request) {
          let data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          if (!metadata) {
            const newline = data.indexOf(10);
            const prefixEnd = newline === -1 ? data.length : newline;
            if (prefix.length + prefixEnd > 1024 * 1024) {
              throw new BadRequestException('Response metadata is too large');
            }
            prefix = Buffer.concat([prefix, data.subarray(0, prefixEnd)]);
            if (newline === -1) continue;
            metadata = readMetadata(prefix);
            data = data.subarray(newline + 1);
          }
          size += BigInt(data.length);
          yield data;
        }
      }
      await pipeline(
        Readable.from(content()),
        createWriteStream(join(directory, 'body'), {
          flags: 'wx',
          mode: 0o600,
        }),
      );
      if (!metadata) throw new BadRequestException('Missing response metadata');
      const { requestId, ...response } = metadata as ReturnType<
        typeof readMetadata
      >;
      await this.prisma.$transaction(async (db) => {
        await this.lockPolicy(db, uid);
        if (!(await this.policy(uid, db)).enabled)
          throw new ConflictException('Saving results is disabled');
        await db.workbenchHistoryResult.create({
          data: {
            id,
            historyId,
            requestId,
            metadata: response,
            size,
            kind: responseKind(response.contentType),
          },
        });
      });
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    } finally {
      this.incoming.delete(id);
    }
    return { saved: true };
  }

  async attach(uid: string, historyId: string, input: unknown) {
    const history = await this.history(uid, historyId);
    const result = history.workbenchResult;
    if (!result || result.cleanedAt) throw new NotFoundException();
    let target: URL;
    try {
      if (typeof input !== 'string') throw new Error();
      target = new URL(input);
    } catch {
      throw new BadRequestException('Invalid file URL');
    }
    if (
      !['http:', 'https:'].includes(target.protocol) ||
      target.username ||
      target.password
    ) {
      throw new BadRequestException('Invalid file URL');
    }
    const id = randomUUID();
    const temporary = join(this.root, `upload-${id}`);
    const path = join(this.root, result.id, id);
    this.incoming.add(`upload-${id}`);
    try {
      // 仅处理用户显式保存的链接。请求不携带工作台 Cookie 或接口认证头。
      const response = await fetch(target, {
        signal: AbortSignal.timeout(600_000),
      });
      if (!response.ok || !response.body)
        throw new BadRequestException('Could not fetch the file');
      await pipeline(
        response.body,
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
      );
      const { size } = await stat(temporary, { bigint: true });
      const name = target.pathname.split('/').at(-1) || 'attachment';
      const contentType = mimeType(response.headers.get('content-type'));
      await this.prisma.$transaction(async (db) => {
        await this.lockPolicy(db, uid);
        const current = await db.workbenchHistoryResult.findUnique({
          where: { id: result.id, historyId, cleanedAt: null },
        });
        if (!current) throw new NotFoundException();
        await rename(temporary, path);
        await db.workbenchHistoryAttachment.create({
          data: { id, resultId: result.id, name, contentType, size },
        });
      });
      return { saved: true };
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    } finally {
      this.incoming.delete(`upload-${id}`);
      await rm(temporary, { force: true });
    }
  }

  async cleanup(
    uid: string,
    input: CleanupCriteria,
    preview: boolean,
    scheduled = false,
  ) {
    if (
      !input ||
      !validDays(input.days) ||
      (input.kind !== undefined && !kinds.includes(input.kind))
    ) {
      throw new BadRequestException('Invalid history cleanup criteria');
    }
    const report = await this.prisma.$transaction(async (db) => {
      await this.lockPolicy(db, uid);
      const policy = await this.policy(uid, db);
      if (
        scheduled &&
        (!policy.autoCleanup ||
          (policy.lastAutoCleanupAt &&
            Date.now() - policy.lastAutoCleanupAt.getTime() < day))
      ) {
        return null;
      }
      const now = new Date();
      const before = new Date(
        now.getTime() - (scheduled ? policy.retentionDays : input.days) * day,
      );
      const where: Prisma.WorkbenchHistoryResultWhereInput = {
        history: { userUid: uid },
        cleanedAt: null,
        savedAt: { lt: before },
        ...(input.kind ? { kind: input.kind } : {}),
        OR: [
          { requestId: null },
          { requestId: { notIn: policy.excludedRequestIds } },
        ],
      };
      const bodies = await db.workbenchHistoryResult.aggregate({
        where,
        _sum: { size: true },
        _count: true,
      });
      const attachments = await db.workbenchHistoryAttachment.aggregate({
        where: { result: where },
        _sum: { size: true },
      });

      // 旧版 GraphQL 响应仍在历史元数据里，按原执行时间参与同一套清理。
      const legacyWhere = Prisma.sql`h."userUid" = ${uid} AND h."reqType" = 'GQL'
        AND h."executedOn" < ${before}
        AND jsonb_typeof(h."responseMetadata") = 'string'
        AND h."responseMetadata" <> '""'::jsonb
        AND NOT EXISTS (SELECT 1 FROM ${this.resultTable} r WHERE r."historyId" = h.id)`;
      const includeLegacy = !input.kind || input.kind === 'json';
      const legacy = includeLegacy
        ? (
            await db.$queryRaw<{ count: bigint; bytes: bigint }[]>`
          SELECT count(*) AS count, coalesce(sum(octet_length(h."responseMetadata" #>> '{}')), 0)::bigint AS bytes
          FROM ${this.historyTable} h WHERE ${legacyWhere}
        `
          )[0]
        : { count: 0n, bytes: 0n };
      const result = {
        count: bodies._count + Number(legacy.count),
        bytes: (
          (bodies._sum.size ?? 0n) +
          (attachments._sum.size ?? 0n) +
          legacy.bytes
        ).toString(),
      };
      if (preview) return result;
      if (
        !scheduled &&
        (input.expected?.count !== result.count ||
          input.expected?.bytes !== result.bytes)
      ) {
        throw new ConflictException('History cleanup preview has changed');
      }
      await db.workbenchHistoryResult.updateMany({
        where,
        data: { cleanedAt: now, metadata: Prisma.DbNull, size: 0n },
      });
      if (includeLegacy) {
        await db.$executeRaw`UPDATE ${this.historyTable} h SET "responseMetadata" = '{"historyResultCleaned":true}'::jsonb WHERE ${legacyWhere}`;
      }
      const report = {
        lastCleanupAt: now,
        lastCleanup: result,
        ...(scheduled ? { lastAutoCleanupAt: now } : {}),
      };
      await db.workbenchHistoryPolicy.upsert({
        where: { uid },
        create: { uid, ...report },
        update: report,
      });
      return result;
    });
    if (!preview && report) await this.reapDeletedHistory();
    return report;
  }

  reapDeletedHistory() {
    this.pendingRemoval ??= this.removeDeletedFiles()
      .catch(() =>
        this.logger.warn('History result file removal will be retried'),
      )
      .finally(() => {
        this.pendingRemoval = undefined;
      });
    return this.pendingRemoval;
  }

  private async removeDeletedFiles() {
    let after: string | undefined;
    for (;;) {
      const rows = await this.prisma.workbenchHistoryResult.findMany({
        where: {
          ...(after ? { id: { gt: after } } : {}),
          OR: [
            { historyId: null },
            { cleanedAt: { not: null }, filesRemoved: false },
          ],
        },
        select: { id: true, historyId: true },
        orderBy: { id: 'asc' },
        take: 100,
      });
      if (!rows.length) return;
      for (const row of rows) {
        try {
          await rm(join(this.root, row.id), { recursive: true, force: true });
          if (row.historyId === null) {
            await this.prisma.workbenchHistoryResult.deleteMany({
              where: { id: row.id, historyId: null },
            });
          } else {
            await this.prisma.workbenchHistoryAttachment.deleteMany({
              where: { resultId: row.id },
            });
            await this.prisma.workbenchHistoryResult.updateMany({
              where: { id: row.id },
              data: { filesRemoved: true },
            });
          }
        } catch {
          this.logger.warn('History result file removal will be retried');
        }
      }
      after = rows.at(-1)!.id;
    }
  }

  @Cron('0 * * * * *')
  async maintenance() {
    if (this.maintenanceRunning) return;
    this.maintenanceRunning = true;
    try {
      const policy = await this.policy(LOCAL_WORKSPACE_UID);
      if (policy.autoCleanup) {
        await this.cleanup(
          LOCAL_WORKSPACE_UID,
          { days: policy.retentionDays },
          false,
          true,
        );
      }
      await this.reapDeletedHistory();

      if (Date.now() < this.nextOrphanScan) return;
      // 重启后收回写盘后还未完成数据库登记的文件。
      const paths = await readdir(this.root, { withFileTypes: true }).catch(
        () => [],
      );
      for (const entry of paths) {
        if (
          !/^(?:upload-)?[0-9a-f-]{36}$/.test(entry.name) ||
          this.incoming.has(entry.name)
        )
          continue;
        const path = join(this.root, entry.name);
        const info = await stat(path).catch(() => null);
        if (!info || Date.now() - info.mtimeMs < day) continue;
        const result = entry.isDirectory()
          ? await this.prisma.workbenchHistoryResult.findUnique({
              where: { id: entry.name },
              select: { attachments: { select: { id: true } } },
            })
          : null;
        if (result) {
          const referenced = new Set(result.attachments.map(({ id }) => id));
          for (const file of await readdir(path)) {
            if (!/^[0-9a-f-]{36}$/.test(file) || referenced.has(file)) continue;
            const filePath = join(path, file);
            const attachment = await stat(filePath).catch(() => null);
            if (attachment && Date.now() - attachment.mtimeMs >= day) {
              await rm(filePath, { force: true });
            }
          }
          continue;
        }
        await rm(path, { recursive: true, force: true });
      }
      this.nextOrphanScan = Date.now() + day;
    } catch {
      this.logger.warn('History results maintenance did not complete');
    } finally {
      this.maintenanceRunning = false;
    }
  }
}
