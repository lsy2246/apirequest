import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleInit,
  PayloadTooLargeException,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from 'src/generated/prisma/client';

export const MIB = 1024 * 1024;
export const JSON_BODY_MAX_MIB = 100;
const id = 'workbench:service-capacity';

const defaultValues = {
  rateWindowSeconds: 10,
  workspaceReads: 100,
  batchReads: 100,
  sessionRequests: 100,
  externalMcp: 100,
  publicMock: 100,
  relayRequests: 100,
  relayConcurrency: 32,
  relayDefaultTimeoutSeconds: 120,
  relayMaxTimeoutSeconds: 300,
  relayBodyMiB: 32,
  collectionImportMiB: 50,
  configImportMiB: 90,
  detailBatchSize: 200,
  eventConnections: 16,
} as const;

type Setting = keyof typeof defaultValues;
export type CapacityValues = Record<Setting, number>;
export type CapacityRateGroup =
  | 'workspaceReads'
  | 'batchReads'
  | 'sessionRequests'
  | 'externalMcp'
  | 'publicMock'
  | 'relayRequests';

export const CAPACITY_RATE = Symbol('capacity-rate');
export const CapacityRate = (group: CapacityRateGroup) =>
  SetMetadata(CAPACITY_RATE, group);

export type RelayCapacity = Pick<
  CapacityValues,
  | 'relayConcurrency'
  | 'relayDefaultTimeoutSeconds'
  | 'relayMaxTimeoutSeconds'
  | 'relayBodyMiB'
>;

const rateGroups: CapacityRateGroup[] = [
  'workspaceReads',
  'batchReads',
  'sessionRequests',
  'externalMcp',
  'publicMock',
  'relayRequests',
];
const rateSettings = new Set<Setting>(rateGroups);
const timerSettings = new Set<Setting>([
  'rateWindowSeconds',
  'relayDefaultTimeoutSeconds',
  'relayMaxTimeoutSeconds',
]);
// Node timers roll over to a 1 ms delay above this value.
const maxTimerMs = 2 ** 31 - 1;

@Injectable()
export class CapacityService implements OnModuleInit {
  private baseline?: CapacityValues;
  private state?: { values: CapacityValues; revision: number };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private defaults(): CapacityValues {
    if (this.baseline) return this.baseline;
    const values: CapacityValues = { ...defaultValues };
    const legacyRate = Number(this.config.get('INFRA.RATE_LIMIT_MAX'));
    const legacyWindow = Number(this.config.get('INFRA.RATE_LIMIT_TTL')) / 1000;
    if (Number.isSafeInteger(legacyRate) && legacyRate > 0)
      for (const key of rateGroups) values[key] = legacyRate;
    if (
      Number.isSafeInteger(legacyWindow) &&
      legacyWindow > 0 &&
      legacyWindow * 1000 <= maxTimerMs
    )
      values.rateWindowSeconds = legacyWindow;
    this.baseline = values;
    return values;
  }

  private parse(input: unknown): Partial<CapacityValues> {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new BadRequestException('Invalid service capacity');
    const overrides: Partial<CapacityValues> = {};
    for (const [key, value] of Object.entries(input)) {
      if (!Object.hasOwn(defaultValues, key))
        throw new BadRequestException('Unknown capacity setting');
      const setting = key as Setting;
      const allowsZero = rateSettings.has(setting);
      if (!Number.isSafeInteger(value) || value < (allowsZero ? 0 : 1))
        throw new BadRequestException(
          `${key} 必须为${allowsZero ? '非负' : '正'}整数`,
        );
      if (timerSettings.has(setting) && value * 1000 > maxTimerMs)
        throw new BadRequestException(`${key} 超出系统计时器可表示的时长`);
      if (key.endsWith('MiB') && !Number.isSafeInteger(value * 2 * MIB + MIB))
        throw new BadRequestException(`${key} 超出系统可表示的字节数`);
      overrides[setting] = value;
    }
    const values = { ...this.defaults(), ...overrides };
    if (values.relayDefaultTimeoutSeconds > values.relayMaxTimeoutSeconds)
      throw new BadRequestException('Default relay timeout exceeds maximum');
    return overrides;
  }

  async onModuleInit() {
    const row = await this.prisma.workbenchConfig.findUnique({ where: { id } });
    if (!row) return;
    const overrides = this.parse(JSON.parse(row.value));
    this.state = {
      values: { ...this.defaults(), ...overrides },
      revision: row.revision,
    };
  }

  get current(): CapacityValues {
    return this.state?.values ?? this.defaults();
  }

  checkCollectionSize(value: string) {
    const limitMiB = this.current.collectionImportMiB;
    if (Buffer.byteLength(value) > limitMiB * MIB)
      throw new PayloadTooLargeException({
        code: 'COLLECTION_IMPORT_TOO_LARGE',
        limitMiB,
        message: `Collection import exceeds ${limitMiB} MiB`,
      });
  }

  jsonBodyLimit(path: string) {
    const defaultLimit = JSON_BODY_MAX_MIB * MIB;
    const current = this.current;
    switch (path.toLowerCase().replace(/\/$/, '')) {
      case '/v1/auth/local-collections':
        // Collection JSON is embedded as a string and may need escaping.
        return Math.max(
          defaultLimit,
          (current.collectionImportMiB * 2 + 1) * MIB,
        );
      case '/v1/auth/local-relay':
        // Allow space for base64 encoding and the relay request metadata.
        return Math.max(
          defaultLimit,
          4 * Math.ceil((current.relayBodyMiB * MIB) / 3) + MIB,
        );
      case '/v1/workbench-mcp/data/workspace/import':
        return Math.max(defaultLimit, current.configImportMiB * MIB);
      default:
        return defaultLimit;
    }
  }

  rate(group: CapacityRateGroup) {
    const current = this.current;
    return { limit: current[group], ttl: current.rateWindowSeconds * 1000 };
  }

  view() {
    const defaults = this.defaults();
    return {
      revision: this.state?.revision ?? 0,
      values: this.current,
      fields: Object.fromEntries(
        Object.entries(defaults).map(([key, value]) => [key, { default: value }]),
      ),
    };
  }

  async save(ownerUid: string, input: unknown, revision: unknown) {
    if (
      typeof revision !== 'number' ||
      !Number.isSafeInteger(revision) ||
      revision < 0
    )
      throw new BadRequestException('Invalid capacity revision');
    const overrides = this.parse(input);
    const value = JSON.stringify(overrides);
    const next = {
      values: { ...this.defaults(), ...overrides },
      revision: revision + 1,
    };
    if (revision === 0) {
      try {
        await this.prisma.workbenchConfig.create({
          data: {
            id,
            ownerUid,
            kind: 'service_capacity',
            value,
            revision: next.revision,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException(
            'Service capacity changed. Reload and try again.',
          );
        throw error;
      }
    } else {
      const { count } = await this.prisma.workbenchConfig.updateMany({
        where: { id, revision, ownerUid },
        data: { value, revision: next.revision },
      });
      if (!count)
        throw new ConflictException(
          'Service capacity changed. Reload and try again.',
        );
    }
    if (!this.state || this.state.revision < next.revision) this.state = next;
  }
}
