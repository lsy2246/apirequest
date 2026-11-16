import { workbenchEvents } from '../workbench-events';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as E from 'fp-ts/Either';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserCollectionService } from 'src/user-collection/user-collection.service';
import { UserRequestService } from 'src/user-request/user-request.service';
import { UserEnvironmentsService } from 'src/user-environment/user-environments.service';
import { PublishedDocsService } from 'src/published-docs/published-docs.service';
import { AuthUser } from 'src/types/AuthUser';
import { ReqType } from 'src/types/RequestTypes';
import { WorkspaceType } from 'src/types/WorkspaceTypes';
import { encrypt, decrypt } from 'src/utils';
import {
  Change,
  Entity,
  fields,
  defaultRequest,
  merge,
  validateData,
} from './contract';

@Injectable()
export class McpDomainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly collections: UserCollectionService,
    private readonly requests: UserRequestService,
    private readonly envs: UserEnvironmentsService,
    private readonly docs: PublishedDocsService,
  ) {}
  private unwrap<T>(value: E.Either<string, T>): T {
    if (E.isLeft(value)) throw new BadRequestException(value.left);
    return value.right;
  }
  private delegate(kind: Entity): any {
    const names = {
      collection: 'userCollection',
      request: 'userRequest',
      environment: 'userEnvironment',
      documentation: 'publishedDocs',
    };
    return this.prisma[names[kind]];
  }
  private where(kind: Entity, uid: string) {
    if (kind === 'documentation')
      return { creatorUid: uid, workspaceType: 'USER', workspaceID: uid };
    return { userUid: uid };
  }
  isPlan(kind: Entity) {
    return ['automation', 'load_test', 'websocket'].includes(kind);
  }
  private decode(row: any) {
    return {
      ...JSON.parse(decrypt(row.value)),
      id: row.id,
      revision: row.revision,
    };
  }
  async list(kind: Entity, uid: string, limit = 50, offset = 0) {
    if (this.isPlan(kind)) {
      const rows = await this.prisma.workbenchConfig.findMany({
        where: { ownerUid: uid, kind },
        orderBy: { id: 'asc' },
        take: limit + 1,
        skip: offset,
      });
      return {
        items: rows.slice(0, limit).map((row) => this.decode(row)),
        nextOffset: rows.length > limit ? offset + limit : null,
      };
    }
    const rows = await this.delegate(kind).findMany({
      where: this.where(kind, uid),
      orderBy: { id: 'asc' },
      take: limit + 1,
      skip: offset,
    });
    return {
      items: rows.slice(0, limit).map((row) => this.summary(kind, row)),
      nextOffset: rows.length > limit ? offset + limit : null,
    };
  }
  private summary(kind: Entity, row: any) {
    // 列表只返回定位配置所需的概要；完整配置由单条查询按需读取。
    const keys: Partial<Record<Entity, string[]>> = {
      collection: ['id', 'title', 'parentID', 'type'],
      request: ['id', 'title', 'collectionID', 'type'],
      environment: ['id', 'name', 'isGlobal'],
      documentation: [
        'id',
        'title',
        'version',
        'slug',
        'autoSync',
        'collectionID',
      ],
    };
    return Object.fromEntries(keys[kind].map((key) => [key, row[key]]));
  }
  private clean(row: any): any {
    const privateFields = new Set([
      'userUid',
      'creatorUid',
      'workspaceID',
      'hitCount',
      'lastHitAt',
      'deletedAt',
      'createdOn',
      'updatedOn',
    ]);
    return Object.fromEntries(
      Object.entries(row).filter(([key]) => !privateFields.has(key)),
    );
  }
  async get(kind: Entity, id: string, uid: string): Promise<any> {
    if (this.isPlan(kind)) {
      const row = await this.prisma.workbenchConfig.findFirst({
        where: { id, ownerUid: uid, kind },
      });
      if (!row) throw new NotFoundException('Configuration not found');
      return this.decode(row);
    }
    const row = await this.delegate(kind).findFirst({
      where: { ...this.where(kind, uid), id },
    });
    if (!row) throw new NotFoundException('Configuration not found');
    return this.clean(row);
  }
  // 删除目录的预览包含整棵受影响子树，审批期间新增接口也会导致版本冲突。
  async before(change: Change, uid: string) {
    if (change.operation === 'create') return null;
    const target = await this.get(change.entity, change.id, uid);
    if (change.entity !== 'collection' || change.operation !== 'delete')
      return target;
    const ids = [change.id];
    let level = [change.id];
    const children = [];
    while (level.length) {
      const rows = await this.prisma.userCollection.findMany({
        where: { userUid: uid, parentID: { in: level } },
        orderBy: { id: 'asc' },
      });
      if (ids.length + rows.length > 1000)
        throw new BadRequestException(
          'Collection tree is too large for one change',
        );
      children.push(...rows.map((row) => this.clean(row)));
      level = rows.map((row) => row.id);
      ids.push(...level);
    }
    const requests = await this.prisma.userRequest.findMany({
      where: { userUid: uid, collectionID: { in: ids } },
      orderBy: { id: 'asc' },
    });
    const docs = await this.prisma.publishedDocs.findMany({
      where: { creatorUid: uid, collectionID: { in: ids } },
      select: { id: true, title: true },
      orderBy: { id: 'asc' },
    });
    if (docs.length)
      throw new BadRequestException(
        'Remove linked documentation before deleting this collection',
      );
    return {
      ...target,
      children,
      requests: requests.map((row) => this.clean(row)),
    };
  }
  async normalize(change: Change, before: any, uid: string) {
    if (change.operation === 'delete') {
      if (change.entity === 'environment' && before.isGlobal)
        throw new BadRequestException(
          'The global environment cannot be deleted',
        );
      return null;
    }
    validateData(change.entity, change.data, true);
    if (
      change.operation === 'update' &&
      ['type', 'parentID', 'collectionID', 'isGlobal'].some(
        (key) =>
          change.data[key] !== undefined && change.data[key] !== before[key],
      )
    )
      throw new BadRequestException(
        'Changing the type, parent or ownership requires creating a new configuration',
      );
    const result = merge(before ?? {}, change.data);
    const requiredName = ['collection', 'request', 'documentation'].includes(
      change.entity,
    )
      ? 'title'
      : 'name';
    if (!result[requiredName]?.trim())
      throw new BadRequestException(`${requiredName} is required`);
    if (change.entity === 'collection') {
      result.type ??= 'REST';
      result.parentID ??= null;
      result.data ??= {};
    }
    if (change.entity === 'request') {
      result.type ??= 'REST';
      result.request = merge(
        change.operation === 'create'
          ? defaultRequest(result.type, result.title)
          : before.request,
        change.data.request ?? {},
      );
      result.request.name = result.title;
      const r = result.request;
      if (
        !Array.isArray(r.headers) ||
        !Array.isArray(r.params ?? []) ||
        !r.auth ||
        typeof r.auth !== 'object' ||
        (result.type === 'REST' &&
          (!r.body || !r.method || typeof r.endpoint !== 'string')) ||
        (result.type === 'GQL' &&
          (typeof r.query !== 'string' || typeof r.url !== 'string'))
      )
        throw new BadRequestException('Invalid request structure');
    }
    if (change.entity === 'environment') {
      result.variables ??= [];
      result.isGlobal ??= false;
    }
    if (change.entity === 'documentation') {
      result.version ??= 'CURRENT';
      result.autoSync ??= true;
      result.metadata ??= {};
      if (!/^[\w.-]+$/.test(result.version))
        throw new BadRequestException('Invalid document version');
    }
    if (change.entity === 'websocket') {
      if (typeof result.url !== 'string')
        throw new BadRequestException('WebSocket url is required');
      result.protocols ??= [];
    }
    if (change.entity === 'automation')
      result.config = merge({ iterations: 1, delay: 0 }, result.config ?? {});
    if (change.entity === 'load_test')
      result.config = merge(
        {
          mode: 'requests',
          concurrency: 2,
          requests: 20,
          durationSeconds: 10,
          timeoutMs: 10000,
        },
        result.config ?? {},
      );
    // 只验证本机用户的引用；不能用猜测 ID 操作其他工作区。
    for (const [key, kind] of [
      ['parentID', 'collection'],
      ['collectionID', 'collection'],
      ['requestID', 'request'],
      ['environmentID', 'environment'],
    ] as const)
      if (result[key]) {
        const ref = await this.get(kind, result[key], uid);
        if (key === 'collectionID' && result.type && ref.type !== result.type)
          throw new BadRequestException(
            'Request and collection types must match',
          );
        if (
          change.entity === 'load_test' &&
          key === 'requestID' &&
          ref.type !== 'REST'
        )
          throw new BadRequestException('Load tests require an HTTP request');
      }
    if (
      ['request', 'documentation', 'automation'].includes(change.entity) &&
      !result.collectionID
    )
      throw new BadRequestException('collectionID is required');
    if (change.entity === 'load_test' && !result.requestID)
      throw new BadRequestException('requestID is required');
    const configFields = Object.fromEntries(
      Object.entries(result).filter(([key]) =>
        (fields[change.entity] as string[]).includes(key),
      ),
    );
    validateData(change.entity, configFields);
    return result;
  }
  async deleteAutomationPlan(id: string, ownerUid: string) {
    // 计划与定时绑定一并删除，已经生成的报告可独立保留。
    await this.prisma.$transaction([
      this.prisma.workbenchConfig.deleteMany({
        where: { id, ownerUid, kind: 'automation' },
      }),
      this.prisma.workbenchConfig.deleteMany({
        where: { id: `${id}:schedule`, ownerUid, kind: 'automation_schedule' },
      }),
    ]);
    workbenchEvents.publish(ownerUid, 'plans');
    workbenchEvents.publish(ownerUid, 'automation');
    return { id, deleted: true };
  }

  async execute(change: Change, data: any, user: AuthUser) {
    const serviceUser = user;
    const uid = user.uid;
    const id = change.id;
    if (this.isPlan(change.entity)) {
      if (change.entity === 'automation' && change.operation === 'delete')
        return this.deleteAutomationPlan(id, uid);
      if (change.operation === 'delete')
        return this.prisma.workbenchConfig
          .delete({ where: { id } })
          .then(() => ({ deleted: true, id }));
      const value = encrypt(JSON.stringify(data));
      const row =
        change.operation === 'create'
          ? await this.prisma.workbenchConfig.create({
              data: {
                id: randomUUID(),
                ownerUid: uid,
                kind: change.entity,
                value,
              },
            })
          : await this.prisma.workbenchConfig.update({
              where: { id },
              data: { value, revision: { increment: 1 } },
            });
      return this.decode(row);
    }
    let result: any;
    switch (change.entity) {
      case 'collection':
        result =
          change.operation === 'create'
            ? await this.collections.createUserCollection(
                user,
                data.title,
                JSON.stringify(data.data),
                data.parentID,
                ReqType[data.type],
              )
            : change.operation === 'update'
              ? await this.collections.updateUserCollection(
                  data.title,
                  JSON.stringify(data.data),
                  id,
                  uid,
                )
              : await this.collections.deleteUserCollection(id, uid);
        break;
      case 'request':
        result =
          change.operation === 'create'
            ? await this.requests.createRequest(
                data.collectionID,
                data.title,
                JSON.stringify(data.request),
                ReqType[data.type],
                user,
              )
            : change.operation === 'update'
              ? await this.requests.updateRequest(
                  id,
                  data.title,
                  ReqType[data.type],
                  JSON.stringify(data.request),
                  user,
                )
              : await this.requests.deleteRequest(id, user);
        break;
      case 'environment':
        result =
          change.operation === 'create'
            ? await this.envs.createUserEnvironment(
                uid,
                data.name,
                JSON.stringify(data.variables),
                data.isGlobal,
              )
            : change.operation === 'update'
              ? await this.envs.updateUserEnvironment(
                  id,
                  data.name,
                  JSON.stringify(data.variables),
                  serviceUser,
                )
              : await this.envs.deleteUserEnvironment(uid, id);
        break;
      case 'documentation':
        result =
          change.operation === 'create'
            ? await this.docs.createPublishedDoc(
                {
                  ...data,
                  workspaceType: WorkspaceType.USER,
                  workspaceID: uid,
                  metadata: JSON.stringify(data.metadata),
                },
                serviceUser,
              )
            : change.operation === 'update'
              ? await this.docs.updatePublishedDoc(
                  id,
                  {
                    title: data.title,
                    version: data.version,
                    autoSync: data.autoSync,
                    environmentID: data.environmentID,
                    metadata: JSON.stringify(data.metadata),
                  },
                  serviceUser,
                )
              : await this.docs.deletePublishedDoc(id, serviceUser);
        break;
    }
    const done: any = this.unwrap(result);
    return {
      id: done?.id ?? id,
      entity: change.entity,
      operation: change.operation,
    };
  }
}
