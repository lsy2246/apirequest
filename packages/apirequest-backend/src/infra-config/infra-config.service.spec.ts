import { mockDeep, mockReset } from 'jest-mock-extended';
import * as E from 'fp-ts/Either';
import { PrismaService } from 'src/prisma/prisma.service';
import { InfraConfigEnum } from 'src/types/InfraConfig';
import { INFRA_CONFIG_NOT_FOUND } from 'src/errors';
import { encrypt } from 'src/utils';
import { InfraConfigService } from './infra-config.service';
import * as helper from './helper';

const prisma = mockDeep<PrismaService>();
const service = new InfraConfigService(prisma);
const previousKey = process.env.DATA_ENCRYPTION_KEY;
const now = new Date('2026-01-01T00:00:00Z');
const record = (name: InfraConfigEnum, value: string, isEncrypted = false) => ({
  id: name,
  name,
  value,
  isEncrypted,
  lastSyncedEnvFileValue: null,
  createdOn: now,
  updatedOn: now,
});
beforeAll(() => {
  process.env.DATA_ENCRYPTION_KEY = '12345678901234567890123456789012';
});
afterAll(() => {
  if (previousKey === undefined) delete process.env.DATA_ENCRYPTION_KEY;
  else process.env.DATA_ENCRYPTION_KEY = previousKey;
});
beforeEach(() => mockReset(prisma));
afterEach(() => jest.restoreAllMocks());

describe('workspace infrastructure configuration', () => {
  it('initializes only missing defaults and preserves existing keys', async () => {
    const defaults = [
      {
        name: InfraConfigEnum.RATE_LIMIT_MAX,
        value: '100',
        isEncrypted: false,
      },
      {
        name: InfraConfigEnum.JWT_SECRET,
        value: 'encrypted-secret',
        isEncrypted: true,
      },
    ];
    jest.spyOn(helper, 'getDefaultInfraConfigs').mockResolvedValue(defaults);
    jest
      .spyOn(helper, 'getMissingInfraConfigEntries')
      .mockResolvedValue([defaults[0]]);
    await service.onModuleInit();
    expect(helper.getMissingInfraConfigEntries).toHaveBeenCalledWith(defaults);
    expect(prisma.infraConfig.createMany).toHaveBeenCalledWith({
      data: [defaults[0]],
    });
  });
  it('does not rewrite configuration when all defaults already exist', async () => {
    jest.spyOn(helper, 'getDefaultInfraConfigs').mockResolvedValue([]);
    jest.spyOn(helper, 'getMissingInfraConfigEntries').mockResolvedValue([]);
    await service.onModuleInit();
    expect(prisma.infraConfig.createMany).not.toHaveBeenCalled();
  });
  it('reads an unencrypted configuration value', async () => {
    const config = record(InfraConfigEnum.RATE_LIMIT_MAX, '100');
    prisma.infraConfig.findUniqueOrThrow.mockResolvedValue(config);
    expect(await service.get(InfraConfigEnum.RATE_LIMIT_MAX)).toEqual(
      E.right(config),
    );
  });
  it('decrypts an encrypted configuration value', async () => {
    const config = record(
      InfraConfigEnum.JWT_SECRET,
      encrypt('workspace-signing-secret'),
      true,
    );
    prisma.infraConfig.findUniqueOrThrow.mockResolvedValue(config);
    expect(await service.get(InfraConfigEnum.JWT_SECRET)).toEqual(
      E.right({ ...config, value: 'workspace-signing-secret' }),
    );
  });
  it('reports unavailable or unreadable configuration', async () => {
    prisma.infraConfig.findUniqueOrThrow.mockRejectedValue(
      new Error('missing'),
    );
    expect(await service.get(InfraConfigEnum.JWT_SECRET)).toEqual(
      E.left(INFRA_CONFIG_NOT_FOUND),
    );
    prisma.infraConfig.findUniqueOrThrow.mockResolvedValue(
      record(InfraConfigEnum.JWT_SECRET, 'invalid-ciphertext', true),
    );
    expect(await service.get(InfraConfigEnum.JWT_SECRET)).toEqual(
      E.left(INFRA_CONFIG_NOT_FOUND),
    );
  });
  it.each([
    ['true', 'ENABLE'],
    ['false', 'DISABLE'],
    ['ENABLE', 'ENABLE'],
    ['DISABLE', 'DISABLE'],
  ])(
    'reads the history policy %s as %s without rewriting it',
    async (stored, expected) => {
      const config = record(InfraConfigEnum.USER_HISTORY_STORE_ENABLED, stored);
      prisma.infraConfig.findUniqueOrThrow.mockResolvedValue(config);
      expect(await service.isUserHistoryEnabled()).toEqual(
        E.right({ ...config, value: expected }),
      );
      expect(prisma.infraConfig.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { name: InfraConfigEnum.USER_HISTORY_STORE_ENABLED },
      });
      expect(prisma.infraConfig.update).not.toHaveBeenCalled();
    },
  );
  it('enables recording only when explicitly requested', async () => {
    await service.enableHistory();
    expect(prisma.infraConfig.upsert).toHaveBeenCalledWith({
      where: { name: InfraConfigEnum.USER_HISTORY_STORE_ENABLED },
      create: {
        name: InfraConfigEnum.USER_HISTORY_STORE_ENABLED,
        value: 'ENABLE',
        isEncrypted: false,
      },
      update: { value: 'ENABLE', isEncrypted: false },
    });
  });
  it('closes the shared configuration connection at shutdown', async () => {
    const disconnect = jest
      .spyOn(helper, 'disconnectSharedPrismaInstance')
      .mockResolvedValue(undefined);
    await service.onModuleDestroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
