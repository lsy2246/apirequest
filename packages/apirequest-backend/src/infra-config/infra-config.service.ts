import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { InfraConfig as DBInfraConfig } from 'src/generated/prisma/client';
import * as E from 'fp-ts/Either';
import { InfraConfigEnum } from 'src/types/InfraConfig';
import { INFRA_CONFIG_NOT_FOUND } from 'src/errors';
import { decrypt } from 'src/utils';
import { disconnectSharedPrismaInstance, getDefaultInfraConfigs, getMissingInfraConfigEntries } from './helper';

@Injectable()
export class InfraConfigService implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly prisma: PrismaService) {}
  async onModuleInit() {
    const defaults = await getDefaultInfraConfigs();
    const missing = await getMissingInfraConfigEntries(defaults);
    if (missing.length)
      await this.prisma.infraConfig.createMany({ data: missing });
  }
  async onModuleDestroy() {
    await disconnectSharedPrismaInstance();
  }
  cast(config: DBInfraConfig) {
    return {
      ...config,
      value: config.isEncrypted ? decrypt(config.value) : config.value,
    };
  }
  async get(name: InfraConfigEnum) {
    try {
      return E.right(
        this.cast(
          await this.prisma.infraConfig.findUniqueOrThrow({ where: { name } }),
        ),
      );
    } catch {
      return E.left(INFRA_CONFIG_NOT_FOUND);
    }
  }
  async isUserHistoryEnabled() {
    return this.get(InfraConfigEnum.USER_HISTORY_STORE_ENABLED);
  }
}
