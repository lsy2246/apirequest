import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { createServer, Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { decrypt, encrypt } from 'src/utils';
import { validateData } from './contract';
import { parseMockRules } from '../mock-server/mock-rule.service';
import { parseOptions } from '../mock-server/mock-engine';
import { workbenchEvents } from '../workbench-events';
import { PubSubService } from 'src/pubsub/pubsub.service';
import { TopicDef } from 'src/pubsub/topicsDefs';
import {
  HoppCollection,
  HoppRESTRequest,
  HoppGQLRequest,
  Environment,
} from '@apirequest/data';

const LIMIT = 90 * 1024 * 1024;
type Flow = {
  uid: string;
  server: Server;
  expires: number;
  code?: string;
  error?: string;
};
@Injectable()
export class WorkbenchDataSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pubsub: PubSubService,
  ) {}
  private flows = new Map<string, Flow>();

  async http(body: any) {
    let url: URL;
    try {
      url = new URL(body?.url);
    } catch {
      throw new BadRequestException('无效的同步地址');
    }
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      url.href.length > 8000
    )
      throw new BadRequestException('同步地址必须是 HTTP 或 HTTPS');
    if (body.provider !== 'webdav' && body.provider !== 'google')
      throw new BadRequestException('无效的同步源');
    if (
      body.provider === 'google' &&
      (url.protocol !== 'https:' ||
        !['www.googleapis.com', 'oauth2.googleapis.com'].includes(
          url.hostname,
        ) ||
        url.port)
    )
      throw new BadRequestException('无效的 Google API 地址');
    if (
      !['GET', 'POST', 'PUT', 'PATCH', 'PROPFIND', 'MKCOL'].includes(
        body.method,
      )
    )
      throw new BadRequestException('无效的同步操作');
    const allowed = [
      'authorization',
      'content-type',
      'if-match',
      'if-none-match',
      'depth',
      'x-upload-content-type',
    ];
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(body.headers ?? {})) {
      if (
        !allowed.includes(key.toLowerCase()) ||
        typeof value !== 'string' ||
        /[\r\n]/.test(value)
      )
        throw new BadRequestException('无效的同步请求头');
      headers[key] = value;
    }
    if (
      body.body !== undefined &&
      (typeof body.body !== 'string' || Buffer.byteLength(body.body) > LIMIT)
    )
      throw new BadRequestException('同步文件过大');
    try {
      const response = await fetch(url, {
        method: body.method,
        headers,
        body: body.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(45000),
      });
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (response.body)
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > LIMIT) {
            await response.body.cancel().catch(() => {});
            throw new Error('同步文件超过大小限制');
          }
          chunks.push(chunk);
        }
      return {
        status: response.status,
        headers: Object.fromEntries(
          ['etag', 'location', 'content-type'].flatMap((key) =>
            response.headers.has(key) ? [[key, response.headers.get(key)]] : [],
          ),
        ),
        body: Buffer.concat(chunks).toString('utf8'),
      };
    } catch (error) {
      throw new BadRequestException(
        error?.name === 'TimeoutError'
          ? '同步连接超时'
          : '同步连接失败，请检查地址、证书和网络',
      );
    }
  }
  async oauthStart(uid: string) {
    for (const [id, flow] of this.flows)
      if (flow.expires < Date.now()) {
        flow.server.close();
        this.flows.delete(id);
      }
    if ([...this.flows.values()].filter((flow) => flow.uid === uid).length >= 3)
      throw new BadRequestException('已有授权窗口，请完成或等待其过期');
    const id = randomBytes(32).toString('hex');
    const flow: Flow = { uid, expires: Date.now() + 300000, server: undefined };
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (
        req.method !== 'GET' ||
        url.pathname !== '/callback' ||
        url.searchParams.get('state') !== id ||
        flow.expires < Date.now()
      ) {
        res.writeHead(400).end('Invalid authorization callback');
        return;
      }
      flow.code = url.searchParams.get('code') ?? undefined;
      flow.error = url.searchParams.has('error')
        ? 'Google 授权被取消或拒绝'
        : undefined;
      if (!flow.code && !flow.error) {
        res.writeHead(400).end('Missing authorization code');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'",
      });
      res.end(
        '<!doctype html><meta charset="utf-8"><title>API Request</title><p>授权已处理，可以关闭此页面并返回 API Request。</p>',
      );
      server.close();
    });
    flow.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    this.flows.set(id, flow);
    const address = server.address() as { port: number };
    const timer = setTimeout(() => {
      server.close();
      this.flows.delete(id);
    }, 300000);
    timer.unref();
    return { id, redirectUri: `http://127.0.0.1:${address.port}/callback` };
  }
  oauthPoll(uid: string, id: string, cancel = false) {
    const flow = this.flows.get(id);
    if (!flow || flow.uid !== uid || flow.expires < Date.now())
      throw new BadRequestException('授权已过期，请重新连接');
    if (cancel || flow.code || flow.error) {
      flow.server.close();
      this.flows.delete(id);
    }
    return {
      code: flow.code,
      error: flow.error,
      pending: !flow.code && !flow.error && !cancel,
    };
  }
  async extras(uid: string) {
    const plans = await this.prisma.workbenchConfig.findMany({
      where: {
        ownerUid: uid,
        kind: { in: ['automation', 'load_test', 'websocket'] },
      },
      orderBy: { id: 'asc' },
    });
    const mocks = await this.prisma.mockServer.findMany({
      where: {
        workspaceID: uid,
        workspaceType: 'USER',
        deletedAt: null,
        collectionID: '',
      },
      orderBy: { id: 'asc' },
    });
    return [
      ...plans.map((row) => {
        const { revision: _revision, ...data } = JSON.parse(decrypt(row.value));
        return {
          id: `${row.kind}:${row.id}`,
          kind: row.kind,
          name: data.name,
          dependencies: [],
          data,
          omitted: [],
        };
      }),
      ...mocks.map((row) => ({
        id: `mock:${row.id}`,
        kind: 'mock',
        name: row.name,
        dependencies: [],
        data: {
          name: row.name,
          collectionID: row.collectionID,
          isActive: row.isActive,
          isPublic: row.isPublic,
          delayInMs: row.delayInMs,
          kind: (row.ruleSet as any)?.kind ?? 'collection',
          rules: (row.ruleSet as any)?.rules ?? [],
          options: (row.ruleSet as any)?.options ?? {},
        },
        omitted: [],
      })),
    ];
  }
  validate(body: any) {
    if (!Array.isArray(body?.entries) || body.entries.length > 2000)
      throw new BadRequestException('无效的配置列表');
    for (const entry of body.entries) {
      if (
        !entry ||
        !['automation', 'load_test', 'websocket', 'mock'].includes(
          entry.kind,
        ) ||
        typeof entry.id !== 'string' ||
        !entry.id.startsWith(entry.kind + ':') ||
        entry.id.length > 512 ||
        !entry.data ||
        typeof entry.data !== 'object'
      )
        throw new BadRequestException('无效的配置条目');
      if (entry.kind === 'mock') {
        if (entry.data.collectionID)
          throw new BadRequestException('基于接口示例的 Mock 已移除');
        const rules = parseMockRules(entry.data.rules ?? []);
        if (
          !['single', 'collection'].includes(entry.data.kind ?? 'collection') ||
          (entry.data.kind === 'single' && rules.length !== 1)
        )
          throw new BadRequestException('无效的 Mock 类型');
        parseOptions(entry.data.options ?? {});
        if (
          typeof entry.data.name !== 'string' ||
          !entry.data.name.trim() ||
          entry.data.name.length > 100
        )
          throw new BadRequestException('无效的 Mock 名称');
        if (
          (entry.data.isActive !== undefined &&
            typeof entry.data.isActive !== 'boolean') ||
          (entry.data.isPublic !== undefined &&
            typeof entry.data.isPublic !== 'boolean') ||
          (entry.data.delayInMs !== undefined &&
            (!Number.isInteger(entry.data.delayInMs) ||
              entry.data.delayInMs < 0 ||
              entry.data.delayInMs > 30000))
        )
          throw new BadRequestException('无效的 Mock 选项');
        if (entry.data.rules) parseMockRules(entry.data.rules);
      } else {
        const { id: _id, revision: _revision, ...data } = entry.data;
        validateData(entry.kind, data);
      }
    }
    return { valid: true };
  }
  async importWorkspace(uid: string, body: any) {
    if (!Array.isArray(body?.entries) || body.entries.length > 20000)
      throw new BadRequestException('无效的配置列表');
    const entries = body.entries;
    for (const e of entries)
      if (
        !e ||
        ![
          'collection',
          'request',
          'environment',
          'mock',
          'automation',
          'load_test',
          'websocket',
        ].includes(e.kind) ||
        typeof e.id !== 'string' ||
        e.id.length > 512 ||
        e.id.length <= e.kind.length + 1 ||
        !e.id.startsWith(e.kind + ':') ||
        typeof e.name !== 'string' ||
        e.name.length > 1000 ||
        !e.data ||
        typeof e.data !== 'object' ||
        Array.isArray(e.data)
      )
        throw new BadRequestException('无效的配置条目');
    const extras = entries.filter((e: any) =>
      ['mock', 'automation', 'load_test', 'websocket'].includes(e.kind),
    );
    this.validate({ entries: extras });
    const ids: Record<string, string> = {};
    const events: { topic: keyof TopicDef; data: any }[] = [];
    const validationOnly = Symbol('validation-only');
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const collections = await tx.userCollection.findMany({
            where: { userUid: uid },
          });
          const requests = await tx.userRequest.findMany({
            where: { userUid: uid },
          });
          const read = (v: any) =>
            typeof v === 'string' ? JSON.parse(v) : (v ?? {});
          for (const c of collections) {
            ids[`collection:${c.id}`] = c.id;
            const ref = read(c.data)._ref_id;
            if (ref) ids[`collection:${ref}`] = c.id;
          }
          for (const r of requests) {
            ids[`request:${r.id}`] = r.id;
            const ref = read(r.request)._ref_id;
            if (ref) ids[`request:${ref}`] = r.id;
          }
          const pending = entries.filter((e: any) => e.kind === 'collection');
          while (pending.length) {
            const i = pending.findIndex((e: any) => !e.parent || ids[e.parent]);
            if (i < 0) throw new BadRequestException('缺少上级集合');
            const e = pending.splice(i, 1)[0],
              data = { ...e.data, folders: [], requests: [] };
            if (
              typeof e.id !== 'string' ||
              !e.id.startsWith('collection:') ||
              HoppCollection.safeParse(data).type !== 'ok'
            )
              throw new BadRequestException('无效的集合配置');
            const id = ids[e.id] ?? e.id.slice(11),
              previous = await tx.userCollection.findUnique({ where: { id } }),
              parentID = e.parent ? ids[e.parent] : null;
            if (
              previous &&
              (previous.userUid !== uid || previous.parentID !== parentID)
            )
              throw new ConflictException('集合位置或归属已变化');
            const { folders: _folders, requests: _requests, ...meta } = e.data;
            meta._ref_id = e.id.slice(11);
            meta.name = e.name;
            if (Array.isArray(meta.variables))
              meta.variables = meta.variables.map((v: any) => ({
                ...v,
                initialValue: v.secret ? '' : v.initialValue,
                currentValue: '',
              }));
            const last = await tx.userCollection.aggregate({
              where: { userUid: uid, parentID },
              _max: { orderIndex: true },
            });
            const saved = await tx.userCollection.upsert({
              where: { id },
              create: {
                id,
                parentID,
                userUid: uid,
                title: e.name,
                type: 'REST',
                orderIndex: (last._max.orderIndex ?? 0) + 1,
                data: meta,
              },
              update: { title: e.name, data: meta },
            });
            ids[e.id] = id;
            events.push({
              topic: `user_coll/${uid}/${previous ? 'updated' : 'created'}`,
              data: { ...saved, userID: uid, data: JSON.stringify(saved.data) },
            });
          }
          for (const e of entries.filter((e: any) => e.kind === 'request')) {
            const value = e.data?.request,
              parsed = (
                value && 'url' in value ? HoppGQLRequest : HoppRESTRequest
              ).safeParse(value);
            if (
              parsed.type !== 'ok' ||
              typeof e.id !== 'string' ||
              !e.id.startsWith('request:') ||
              !ids[e.parent]
            )
              throw new BadRequestException('无效的接口配置或缺少所属集合');
            const id = ids[e.id] ?? e.id.slice(8),
              previous = await tx.userRequest.findUnique({ where: { id } }),
              collectionID = ids[e.parent];
            if (
              previous &&
              (previous.userUid !== uid ||
                previous.collectionID !== collectionID)
            )
              throw new ConflictException('接口位置或归属已变化');
            const last = await tx.userRequest.aggregate({
              where: { userUid: uid, collectionID },
              _max: { orderIndex: true },
            });
            const request = JSON.parse(
              JSON.stringify({
                ...parsed.value,
                id,
                name: e.name,
                _ref_id: e.id.slice(8),
              }),
            );
            const saved = await tx.userRequest.upsert({
              where: { id },
              create: {
                id,
                collectionID,
                userUid: uid,
                title: e.name,
                type: 'REST',
                orderIndex: (last._max.orderIndex ?? 0) + 1,
                request: request,
              },
              update: { title: e.name, request: request },
            });
            ids[e.id] = id;
            events.push({
              topic: `user_request/${uid}/${previous ? 'updated' : 'created'}`,
              data: { ...saved, request: JSON.stringify(saved.request) },
            });
          }
          for (const e of entries.filter(
            (e: any) => e.kind === 'environment',
          )) {
            if (
              typeof e.id !== 'string' ||
              !e.id.startsWith('environment:') ||
              Environment.safeParse({
                v: 2,
                id: e.id.slice(12),
                name: e.name,
                variables: e.data?.variables,
              }).type !== 'ok'
            )
              throw new BadRequestException('无效的环境配置');
            const global = e.id === 'environment:global',
              globalRow = global
                ? await tx.userEnvironment.findFirst({
                    where: { userUid: uid, isGlobal: true },
                  })
                : undefined;
            const id =
                globalRow?.id ??
                (global ? `sync-global-${uid}` : e.id.slice(12)),
              previous = await tx.userEnvironment.findUnique({ where: { id } });
            if (previous && previous.userUid !== uid)
              throw new ConflictException('环境 ID 已被其他工作区使用');
            const variables = e.data.variables.map((v: any) => ({
              ...v,
              initialValue: v.secret ? '' : v.initialValue,
              currentValue: '',
            }));
            const saved = await tx.userEnvironment.upsert({
              where: { id },
              create: {
                id,
                userUid: uid,
                name: e.name,
                isGlobal: global,
                variables: global ? { v: 2, variables } : variables,
              },
              update: {
                name: e.name,
                variables: global ? { v: 2, variables } : variables,
              },
            });
            ids[e.id] = id;
            events.push({
              topic: `user_environment/${uid}/${previous ? 'updated' : 'created'}`,
              data: { ...saved, variables: JSON.stringify(saved.variables) },
            });
          }
          for (const e of extras) {
            const data = { ...e.data },
              id = e.id.slice(e.kind.length + 1);
            for (const field of ['collectionID', 'requestID', 'environmentID'])
              if (
                typeof data[field] === 'string' &&
                /^(collection|request|environment):/.test(data[field])
              ) {
                data[field] =
                  ids[data[field]] ??
                  (data[field].startsWith('environment:')
                    ? data[field].slice(12)
                    : undefined);
                if (!data[field]) throw new BadRequestException('缺少关联配置');
              }

            for (const [field, table] of [
              ['collectionID', 'userCollection'],
              ['requestID', 'userRequest'],
              ['environmentID', 'userEnvironment'],
            ] as const) {
              if (!data[field]) continue;
              const query = {
                where: { id: String(data[field]), userUid: uid },
              };
              const related =
                table === 'userCollection'
                  ? await tx.userCollection.findFirst(query)
                  : table === 'userRequest'
                    ? await tx.userRequest.findFirst(query)
                    : await tx.userEnvironment.findFirst(query);
              if (!related)
                throw new BadRequestException(
                  '关联配置不存在或不属于当前工作区',
                );
            }
            if (e.kind === 'mock') {
              const previous = await tx.mockServer.findUnique({
                where: { id },
              });
              if (
                previous &&
                (previous.workspaceID !== uid ||
                  previous.workspaceType !== 'USER')
              )
                throw new ConflictException('Mock ID 已被占用');
              if (data.collectionID)
                throw new BadRequestException('基于接口示例的 Mock 已移除');
              const value = {
                name: e.name,
                collectionID: '',
                isActive: data.isActive ?? false,
                isPublic: data.isPublic ?? true,
                delayInMs: data.delayInMs ?? 0,
                ruleSet: {
                  kind: data.kind ?? 'collection',
                  revision: ((previous?.ruleSet as any)?.revision ?? 0) + 1,
                  rules: parseMockRules(data.rules ?? []),
                  options: parseOptions(data.options ?? {}),
                  hits: {},
                },
              };
              await tx.mockServer.upsert({
                where: { id },
                create: {
                  id,
                  ...value,
                  subdomain: randomBytes(12).toString('hex'),
                  creatorUid: uid,
                  workspaceID: uid,
                  workspaceType: 'USER',
                },
                update: { ...value, deletedAt: null },
              });
            } else {
              const previous = await tx.workbenchConfig.findUnique({
                where: { id },
              });
              if (
                previous &&
                (previous.ownerUid !== uid || previous.kind !== e.kind)
              )
                throw new ConflictException('配置 ID 已被占用');
              await tx.workbenchConfig.upsert({
                where: { id },
                create: {
                  id,
                  kind: e.kind,
                  ownerUid: uid,
                  value: encrypt(JSON.stringify({ ...data, id })),
                },
                update: {
                  value: encrypt(JSON.stringify({ ...data, id })),
                  revision: { increment: 1 },
                },
              });
            }
          }
          if (body.dryRun === true) throw validationOnly;
        },
        { timeout: 30000 },
      );
    } catch (error) {
      if (error !== validationOnly) throw error;
    }
    if (body.dryRun === true) return { ids };
    for (const event of events)
      await this.pubsub.publish(event.topic, event.data);
    workbenchEvents.publish(uid, 'plans');
    workbenchEvents.publish(uid, 'automation');
    workbenchEvents.publish(uid, 'mock');
    return { ids };
  }
}
