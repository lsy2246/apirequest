import { UserCollectionService } from 'src/user-collection/user-collection.service';
import { ConfigService } from '@nestjs/config';
import { LocalWorkspaceService } from './local-workspace.service';
import { LOCAL_WORKSPACE_UID } from './policy';
import * as E from 'fp-ts/Either';
import { mockDeep } from 'jest-mock-extended';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthService } from '../auth.service';
import { JwtService } from '@nestjs/jwt';

describe('本机身份会话', () => {
  const prisma = mockDeep<PrismaService>();
  const auth = mockDeep<AuthService>();
  const jwt = mockDeep<JwtService>();
  const config = new ConfigService({
    VITE_BASE_URL: 'http://127.0.0.1:3000',
    VITE_BACKEND_GQL_URL: 'http://127.0.0.1:3170/graphql',
  });
  const collections = mockDeep<UserCollectionService>();
  const service = new LocalWorkspaceService(
    config,
    prisma,
    jwt,
    auth,
    collections,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    auth.generateAuthTokens.mockResolvedValue(
      E.right({ access_token: 'test-access', refresh_token: 'test-refresh' }),
    );
  });
  it('创建固定无邮箱归属，并通过原有令牌签发器建立会话', async () => {
    await service.establishSession();
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { uid: LOCAL_WORKSPACE_UID },
      update: {},
      create: {
        uid: LOCAL_WORKSPACE_UID,
        displayName: '本地工作区',
        isAdmin: true,
      },
    });
    expect(auth.generateAuthTokens).toHaveBeenCalledWith(LOCAL_WORKSPACE_UID);
  });
  it('已有有效本机会话不会因打开多个标签而轮换刷新令牌', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: LOCAL_WORKSPACE_UID });
    expect(await service.establishSession('existing')).toBeUndefined();
    expect(auth.generateAuthTokens).not.toHaveBeenCalled();
  });
  it.each(['expired', 'other-user'])(
    '过期或其他账户会话不会冒充本机归属 %s',
    async (mode) => {
      if (mode === 'expired')
        jwt.verifyAsync.mockRejectedValue(new Error('expired'));
      else jwt.verifyAsync.mockResolvedValue({ sub: 'other-account' });
      await service.establishSession('invalid');
      expect(auth.generateAuthTokens).toHaveBeenCalledWith(LOCAL_WORKSPACE_UID);
    },
  );
  it('重复及并发接入同一引用的集合时只迁入一次', async () => {
    let saved = false;
    prisma.userCollection.findMany.mockImplementation(async () =>
      saved ? ([{ data: { _ref_id: 'local-reference' } }] as never) : [],
    );
    collections.importCollectionsFromJSON.mockImplementation(async () => {
      saved = true;
      return E.right({} as never);
    });
    collections.exportUserCollectionsToJSON.mockResolvedValue(
      E.right({ exportedCollection: '[]', collectionType: 'REST' } as never),
    );
    const payload = JSON.stringify([
      {
        name: '示例',
        folders: [],
        requests: [],
        data: { _ref_id: 'local-reference' },
      },
    ]);
    await Promise.all([
      service.adoptCollections(payload, 'REST'),
      service.adoptCollections(payload, 'REST'),
    ]);
    expect(collections.importCollectionsFromJSON).toHaveBeenCalledTimes(1);
  });
});
