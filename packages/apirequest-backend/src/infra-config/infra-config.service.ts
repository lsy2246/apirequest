import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { InfraConfig as DBInfraConfig } from 'src/generated/prisma/client';
import * as E from 'fp-ts/Either';
import { InfraConfigEnum } from 'src/types/InfraConfig';
import { INFRA_CONFIG_NOT_FOUND } from 'src/errors';
import { decrypt } from 'src/utils';
import {
  disconnectSharedPrismaInstance,
  getDefaultInfraConfigs,
  getMissingInfraConfigEntries,
  ServiceStatus,
} from './helper';

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
    const result = await this.get(InfraConfigEnum.USER_HISTORY_STORE_ENABLED);
    return E.map((config: ReturnType<InfraConfigService['cast']>) => ({
      ...config,
      // Older local installations stored boolean strings. Normalize the wire
      // value without changing the user's saved policy or rewriting the row.
      value:
        config.value === 'true'
          ? ServiceStatus.ENABLE
          : config.value === 'false'
            ? ServiceStatus.DISABLE
            : config.value,
    }))(result);
  }

  async enableHistory() {
    await this.prisma.infraConfig.upsert({
      where: { name: InfraConfigEnum.USER_HISTORY_STORE_ENABLED },
      create: {
        name: InfraConfigEnum.USER_HISTORY_STORE_ENABLED,
        value: ServiceStatus.ENABLE,
        isEncrypted: false,
      },
      update: { value: ServiceStatus.ENABLE, isEncrypted: false },
    });
  }
}
