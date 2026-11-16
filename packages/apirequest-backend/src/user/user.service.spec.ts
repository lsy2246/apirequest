import { mockDeep, mockReset } from 'jest-mock-extended';
import * as E from 'fp-ts/Either';
import * as O from 'fp-ts/Option';
import { PrismaService } from 'src/prisma/prisma.service';
import { PubSubService } from 'src/pubsub/pubsub.service';
import { USER_NOT_FOUND } from 'src/errors';
import { LOCAL_WORKSPACE_UID } from 'src/auth/local-workspace/policy';
import { UserService } from './user.service';

const prisma = mockDeep<PrismaService>();
const pubsub = mockDeep<PubSubService>();
const service = new UserService(prisma, pubsub);
const now = new Date('2026-01-01T00:00:00Z');
const user = {
  uid: LOCAL_WORKSPACE_UID,
  email: null,
  displayName: '工作区',
  photoURL: null,
  isAdmin: true,
  currentRESTSession: {},
  currentGQLSession: {},
  refreshToken: null,
  lastLoggedOn: now,
  lastActiveOn: now,
  createdOn: now,
};

beforeEach(() => {
  mockReset(prisma);
  mockReset(pubsub);
  jest.useFakeTimers().setSystemTime(now);
});
afterEach(() => jest.useRealTimers());

describe('single-user identity', () => {
  it('preserves the fixed identity when converting the stored user', () => {
    expect(service.convertDbUserToUser(user)).toEqual(user);
  });
  it('finds the workspace owner by ID without an email', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue(user);
    expect(await service.findUserById(user.uid)).toEqual(O.some(user));
    expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { uid: user.uid },
    });
  });
  it('returns None for an unavailable identity', async () => {
    prisma.user.findUniqueOrThrow.mockRejectedValue(new Error('missing'));
    expect(await service.findUserById('missing')).toEqual(O.none);
  });
  it('stores the refresh token hash for the same workspace owner', async () => {
    const updated = { ...user, refreshToken: 'hashed-token' };
    prisma.user.update.mockResolvedValue(updated);
    expect(
      await service.updateUserRefreshToken('hashed-token', user.uid),
    ).toEqual(E.right(updated));
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { uid: user.uid },
      data: { refreshToken: 'hashed-token' },
    });
  });
  it('reports a missing owner when updating the refresh token', async () => {
    prisma.user.update.mockRejectedValue(new Error('missing'));
    expect(
      await service.updateUserRefreshToken('hashed-token', 'missing'),
    ).toEqual(E.left(USER_NOT_FOUND));
  });
  it.each([
    ['updateUserLastLoggedOn', 'lastLoggedOn'],
    ['updateUserLastActiveOn', 'lastActiveOn'],
  ] as const)('%s records the current timestamp', async (method, field) => {
    prisma.user.update.mockResolvedValue(user);
    expect(await service[method](user.uid)).toEqual(E.right(true));
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { uid: user.uid },
      data: { [field]: now },
    });
  });
  it.each(['updateUserLastLoggedOn', 'updateUserLastActiveOn'] as const)(
    '%s reports a missing owner',
    async (method) => {
      prisma.user.update.mockRejectedValue(new Error('missing'));
      expect(await service[method]('missing')).toEqual(E.left(USER_NOT_FOUND));
    },
  );
});
