import { BadRequestException } from '@nestjs/common';
import { UserCollectionService } from 'src/user-collection/user-collection.service';
import { ReqType } from 'src/types/RequestTypes';
import { ReqType as DBReqType } from 'src/generated/prisma/client';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as E from 'fp-ts/Either';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthService } from '../auth.service';
import { LOCAL_WORKSPACE_UID, getLocalWorkspaceConfig } from './policy';
import { throwHTTPErr } from 'src/utils';

@Injectable()
export class LocalWorkspaceService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
    private readonly collections: UserCollectionService,
  ) {}

  private adoptionQueue: Promise<void> = Promise.resolve();

  async adoptCollections(json: string, type: 'REST' | 'GQL') {
    if (!getLocalWorkspaceConfig(this.config)) throw new NotFoundException();
    const incoming: unknown = JSON.parse(json);
    if (
      !Array.isArray(incoming) ||
      incoming.some(
        (item) =>
          !item || typeof item.data?._ref_id !== 'string' || !item.data._ref_id,
      )
    )
      throw new BadRequestException('Invalid local collection identity');
    const previous = this.adoptionQueue;
    let release: () => void;
    this.adoptionQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      // 浏览器多标签可同时首次连接；串行检查稳定引用，避免重复迁入同一份设备集合。
      const existing = await this.prisma.userCollection.findMany({
        where: {
          userUid: LOCAL_WORKSPACE_UID,
          parentID: null,
          type: type as DBReqType,
        },
        select: { data: true },
      });
      const refs = new Set(
        existing.map((item) => (item.data as Record<string, unknown>)?._ref_id),
      );
      const missing = incoming.filter((item) => !refs.has(item.data._ref_id));
      if (missing.length) {
        const imported = await this.collections.importCollectionsFromJSON(
          JSON.stringify(missing),
          LOCAL_WORKSPACE_UID,
          null,
          type as DBReqType,
        );
        if (E.isLeft(imported)) throw new BadRequestException(imported.left);
      }
      const result = await this.collections.exportUserCollectionsToJSON(
        LOCAL_WORKSPACE_UID,
        null,
        type as ReqType,
      );
      if (E.isLeft(result)) throw new BadRequestException(result.left);
      return result.right;
    } finally {
      release();
    }
  }

  async establishSession(accessToken?: string) {
    if (!getLocalWorkspaceConfig(this.config)) throw new NotFoundException();
    // 独立固定归属，不复用邮箱账户或测试账户；并发打开标签时依靠数据库主键保证只创建一份。
    await this.prisma.user.upsert({
      where: { uid: LOCAL_WORKSPACE_UID },
      update: {},
      create: {
        uid: LOCAL_WORKSPACE_UID,
        displayName: '本地工作区',
        isAdmin: true,
      },
    });
    if (accessToken) {
      try {
        const payload = await this.jwt.verifyAsync(accessToken, {
          issuer: this.config.get('VITE_BASE_URL'),
          audience: this.config.get('VITE_BASE_URL'),
          algorithms: ['HS256'],
        });
        if (payload.sub === LOCAL_WORKSPACE_UID) return undefined;
      } catch {
        /* 过期或其他身份的凭证不复用，重新建立本地会话。 */
      }
    }
    const tokens = await this.auth.generateAuthTokens(LOCAL_WORKSPACE_UID);
    if (E.isLeft(tokens)) throwHTTPErr(tokens.left);
    return E.isRight(tokens) ? tokens.right : undefined;
  }
}
