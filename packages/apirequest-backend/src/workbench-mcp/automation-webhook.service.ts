import { SiteSettingsService } from 'src/site-settings/site-settings.service';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { decrypt, encrypt } from 'src/utils';
import {
  AutomationWebhookReportSchema,
  AutomationConfigSchema,
  getAutomationWebhookFormat,
  type AutomationConfig,
} from '@apirequest/data';
import { workbenchEvents } from '../workbench-events';
import { object } from './contract';
import {
  assertFeishuResponse,
  feishuWebhookBody,
  WebhookDeliveryError,
} from './feishu-webhook';

const settingsKind = 'automation_webhook_settings';
const channelKind = 'automation_notification_channel';
const deliveryKind = 'automation_webhook_delivery';
const reportKind = 'automation_report';
const encode = (value: unknown) => encrypt(JSON.stringify(value));
const decode = (value: string) => JSON.parse(decrypt(value));
type Settings = {
  url: string;
  secret: string;
  reportBaseURL: string;
  format: 'json' | 'feishu';
};
type Channel = {
  id: string;
  name: string;
  format: 'json' | 'feishu';
  enabled: boolean;
  url: string;
  secret: string;
};
type Delivery = {
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  attempts: number;
  error?: string;
};

type ChannelDelivery = Delivery & {
  reportID: string;
  channelID: string;
  name: string;
};
type DeliverySummary = {
  status: Delivery['status'] | 'partial';
  attempts: number;
  error?: string;
  channels?: ChannelDelivery[];
};

function httpURL(value: unknown, optional = false) {
  if (optional && value === '') return '';
  if (typeof value !== 'string' || value.length > 4096)
    throw new BadRequestException('Invalid Webhook URL');
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error();
    return url.toString();
  } catch {
    throw new BadRequestException('Invalid Webhook URL');
  }
}
const short = (value: unknown, max = 2000) => String(value ?? '').slice(0, max);
function reason(value: any): string {
  if (typeof value === 'string') return short(value);
  if (!value || typeof value !== 'object') return '';
  return short(
    value.message ?? value.data?.message ?? value.code ?? value.name ?? '',
  );
}

/** A compact, stable contract; raw responses, headers and VM stacks are excluded. */
export function automationWebhookPayload(
  report: any,
  includeDetails: boolean,
  baseURL: string,
) {
  const steps: any[] = Array.isArray(report.steps) ? report.steps : [];
  const timedOut = (step: any) =>
    (step.errorDetails ?? []).some(
      (error: any) =>
        error.code === 'CASE_TIMEOUT' || error.data?.code === 'CASE_TIMEOUT',
    );
  const timeout = steps.filter(timedOut).length;
  const passed = steps.filter((step) => step.passed === true).length;
  const failed = steps.filter(
    (step) => step.passed !== true && !timedOut(step),
  ).length;
  const runErrors = (report.errorDetails ?? []).map((error: any) => ({
    code: short(error.code),
    message: reason(error.data),
  }));
  const reportURL = new URL('automation', `${baseURL.replace(/\/+$/, '')}/`);
  reportURL.searchParams.set('report', report.id);
  const payload: Record<string, unknown> = {
    event: 'automation.completed',
    version: 1,
    id: report.id,
    name: report.name,
    createdAt: report.createdAt,
    environment: {
      id: report.environmentID ?? null,
      name: report.environmentName ?? null,
    },
    status: report.errorDetails?.length
      ? 'error'
      : failed || timeout || report.summary.failed
        ? 'failed'
        : 'passed',
    summary: {
      total: report.automation?.totalRequests ?? report.summary.completed,
      completed: report.summary.completed,
      passed,
      failed,
      timeout,
      errors: runErrors.length,
      elapsedMs: Math.round(report.summary.elapsedMs),
    },
    reportURL: reportURL.toString(),
  };
  if (
    includeDetails &&
    (steps.some((step) => !step.passed) || runErrors.length)
  ) {
    const failedSteps = steps.filter((step) => !step.passed);
    payload.failures = failedSteps.slice(0, 100).map((step) => ({
      name: short(step.name),
      iteration: step.iteration,
      statusCode: step.statusCode,
      type: timedOut(step) ? 'timeout' : 'failure',
      errors: (step.errorDetails ?? []).slice(0, 20).map((error: any) => ({
        code: short(error.code),
        message: reason(error.data),
      })),
      assertions: (step.assertions ?? [])
        .filter((assertion: any) => assertion.failed > 0)
        .slice(0, 20)
        .map((assertion: any) => ({
          name: short(assertion.descriptor),
          messages: (assertion.expectResults ?? [])
            .filter((item: any) => item.status !== 'pass')
            .slice(0, 20)
            .map((item: any) => short(item.message)),
        })),
    }));
    payload.omittedFailures = Math.max(0, failedSteps.length - 100);
    if (runErrors.length) payload.errors = runErrors;
  }
  return payload;
}

@Injectable()
export class AutomationWebhookService {
  private readonly logger = new Logger(AutomationWebhookService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly site: SiteSettingsService,
  ) {}

  private async settings(ownerUid: string): Promise<Settings> {
    const row = await this.prisma.workbenchConfig.findFirst({
      where: { ownerUid, kind: settingsKind },
    });
    const settings = row
      ? decode(row.value)
      : { url: '', secret: '', reportBaseURL: '' };
    // Keep existing configurations working until their explicit format is saved.
    return {
      ...settings,
      format: settings.format ?? getAutomationWebhookFormat(settings.url),
    };
  }
  private legacyID(ownerUid: string) {
    return `${ownerUid}:legacy-notification`;
  }

  private async channelConfigs(ownerUid: string): Promise<Channel[]> {
    const rows = await this.prisma.workbenchConfig.findMany({
      where: { ownerUid, kind: channelKind },
    });
    const channels = rows.map((row) => ({
      ...decode(row.value),
      id: row.id,
    })) as (Channel & { deleted?: boolean })[];
    const legacyID = this.legacyID(ownerUid);
    if (!channels.some((channel) => channel.id === legacyID)) {
      const legacy = await this.settings(ownerUid);
      if (legacy.url)
        channels.push({
          id: legacyID,
          name: '默认通知',
          enabled: true,
          format: legacy.format,
          url: legacy.url,
          secret: legacy.secret,
        });
    }
    return channels.filter((channel) => !channel.deleted);
  }
  async channels(ownerUid: string) {
    return (await this.channelConfigs(ownerUid)).map(
      ({ secret, ...channel }) => ({
        ...channel,
        hasSecret: !!secret,
        legacy: channel.id === this.legacyID(ownerUid),
      }),
    );
  }
  async saveChannel(ownerUid: string, input: unknown, id?: string) {
    object(input);
    const channels = await this.channelConfigs(ownerUid);
    const before = channels.find((channel) => channel.id === id);
    if (id && !before)
      throw new NotFoundException('Notification channel not found');
    if (!id && channels.length >= 50)
      throw new BadRequestException(
        'At most 50 notification channels are allowed',
      );
    const merged = { ...before, ...input };
    if (
      typeof merged.name !== 'string' ||
      !merged.name.trim() ||
      merged.name.trim().length > 100
    )
      throw new BadRequestException('Invalid notification channel name');
    if (merged.format !== 'json' && merged.format !== 'feishu')
      throw new BadRequestException('Invalid notification format');
    if (merged.enabled !== undefined && typeof merged.enabled !== 'boolean')
      throw new BadRequestException('Invalid channel status');
    if (
      merged.secret !== undefined &&
      (typeof merged.secret !== 'string' || merged.secret.length > 4096)
    )
      throw new BadRequestException('Invalid signing secret');
    const url = httpURL(merged.url);
    const channelID = id ?? randomUUID();
    const channel: Omit<Channel, 'id'> = {
      name: merged.name.trim(),
      format: merged.format,
      enabled: merged.enabled ?? true,
      url,
      secret: merged.secret ?? '',
    };
    await this.prisma.workbenchConfig.upsert({
      where: { id: channelID },
      create: {
        id: channelID,
        ownerUid,
        kind: channelKind,
        value: encode(channel),
      },
      update: { value: encode(channel), revision: { increment: 1 } },
    });
    return { id: channelID };
  }
  async deleteChannel(ownerUid: string, id: string) {
    if (
      !(await this.channelConfigs(ownerUid)).some(
        (channel) => channel.id === id,
      )
    )
      throw new NotFoundException('Notification channel not found');
    if (id === this.legacyID(ownerUid)) {
      // A tombstone prevents the old single-channel configuration reappearing.
      const value = encode({ deleted: true });
      await this.prisma.workbenchConfig.upsert({
        where: { id },
        create: { id, ownerUid, kind: channelKind, value },
        update: { value },
      });
    } else
      await this.prisma.workbenchConfig.deleteMany({
        where: { id, ownerUid, kind: channelKind },
      });
    return { deleted: true };
  }

  async get(ownerUid: string) {
    const { secret, ...settings } = await this.settings(ownerUid);
    return { ...settings, hasSecret: !!secret };
  }
  async save(ownerUid: string, input: unknown) {
    object(input);
    const url = httpURL(input.url, true);
    const reportBaseURL = httpURL(input.reportBaseURL);
    if (
      input.secret !== undefined &&
      (typeof input.secret !== 'string' || input.secret.length > 4096)
    )
      throw new BadRequestException('Invalid Webhook signing secret');
    const before = await this.settings(ownerUid);
    if (
      input.format !== undefined &&
      input.format !== 'json' &&
      input.format !== 'feishu'
    )
      throw new BadRequestException('Invalid notification format');
    const value = encode({
      url,
      reportBaseURL,
      secret: input.secret ?? before.secret,
      format: input.format ?? before.format,
    });
    await this.prisma.workbenchConfig.upsert({
      where: { id: `${ownerUid}:automation-webhook` },
      create: {
        id: `${ownerUid}:automation-webhook`,
        ownerUid,
        kind: settingsKind,
        value,
      },
      update: { value, revision: { increment: 1 } },
    });
    return this.get(ownerUid);
  }
  async test(ownerUid: string, channelID?: string) {
    const settings = channelID
      ? (await this.channelConfigs(ownerUid)).find(
          (channel) => channel.id === channelID,
        )
      : await this.settings(ownerUid);
    if (!settings)
      throw new NotFoundException('Notification channel not found');
    if (!settings.url)
      throw new BadRequestException('Configure a Webhook URL first');
    try {
      await this.send(
        settings,
        {
          event: 'automation.webhook_test',
          message: 'APIRequest Webhook 测试通知',
          createdAt: new Date().toISOString(),
        },
        randomUUID(),
      );
    } catch (error) {
      throw new BadRequestException(
        error instanceof WebhookDeliveryError
          ? error.message
          : 'Webhook delivery failed; check the configured URL and connection',
      );
    }
    return { sent: true };
  }

  private async send(
    settings: Pick<Settings, 'url' | 'secret' | 'format'>,
    payload: Record<string, any>,
    id: string,
  ) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const feishu = settings.format === 'feishu';
    const body = feishu
      ? feishuWebhookBody(payload, timestamp, settings.secret)
      : JSON.stringify(payload);
    const response = await fetch(settings.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-APIRequest-Event-ID': id,
        ...(settings.secret && !feishu
          ? {
              'X-APIRequest-Timestamp': timestamp,
              'X-APIRequest-Signature': `sha256=${createHmac('sha256', settings.secret).update(`${timestamp}.${body}`).digest('hex')}`,
            }
          : {}),
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new WebhookDeliveryError(
        `Webhook HTTP ${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }
    if (feishu)
      await assertFeishuResponse(response, [
        settings.url,
        new URL(settings.url).pathname.split('/').filter(Boolean).at(-1) ?? '',
        settings.secret,
      ]);
    else await response.body?.cancel();
  }
  async deliveries(ownerUid: string): Promise<Map<string, DeliverySummary>> {
    const rows = await this.prisma.workbenchConfig.findMany({
      where: { ownerUid, kind: deliveryKind },
    });
    const grouped = new Map<string, ChannelDelivery[]>();
    const result = new Map<string, DeliverySummary>();
    for (const row of rows) {
      const delivery = decode(row.value);
      if (!delivery.reportID) {
        result.set(row.id.slice('webhook:'.length), delivery);
        continue;
      }
      const list = grouped.get(delivery.reportID) ?? [];
      list.push(delivery);
      grouped.set(delivery.reportID, list);
    }
    for (const [reportID, channels] of grouped) {
      const status = channels.some((item) => item.status === 'pending')
        ? 'pending'
        : channels.some((item) => item.status === 'failed')
          ? channels.some((item) => item.status === 'sent')
            ? 'partial'
            : 'failed'
          : channels.every((item) => item.status === 'skipped')
            ? 'skipped'
            : 'sent';
      result.set(reportID, {
        status,
        error: channels.find((item) => item.status === 'failed')?.error,
        attempts: channels.reduce((sum, item) => sum + item.attempts, 0),
        channels,
      });
    }
    return result;
  }

  async notify(
    ownerUid: string,
    report: any,
    options: AutomationConfig['webhook'],
  ) {
    if (!options?.enabled) return;
    // Do not repeat a notification already sent by the previous single-channel sender.
    if (
      await this.prisma.workbenchConfig.findFirst({
        where: { id: `webhook:${report.id}`, ownerUid, kind: deliveryKind },
      })
    )
      return;
    const channels = await this.channelConfigs(ownerUid);
    const ids = [...new Set(options.channelIDs ?? [this.legacyID(ownerUid)])];
    const operations = await Promise.allSettled(
      ids.map(async (channelID) => {
        const channel = channels.find((item) => item.id === channelID);
        const id = `webhook:${report.id}:${channelID}`;
        const delivery: ChannelDelivery = {
          reportID: report.id,
          channelID,
          name: channel?.name ?? channelID,
          status: 'pending',
          attempts: 0,
        };
        try {
          await this.prisma.workbenchConfig.create({
            data: { id, ownerUid, kind: deliveryKind, value: encode(delivery) },
          });
        } catch (error) {
          if (error?.code === 'P2002') return;
          throw error;
        }
        workbenchEvents.publish(ownerUid, 'automation');
        try {
          if (!channel)
            throw new WebhookDeliveryError('通知渠道已删除或不可用');
          if (!channel.enabled) delivery.status = 'skipped';
          else {
            const payload = automationWebhookPayload(
              report,
              options.includeErrorDetails,
              this.site.get().siteURL,
            );
            for (let attempt = 1; attempt <= 3; attempt++) {
              delivery.attempts = attempt;
              try {
                await this.send(channel, payload, report.id);
                delivery.status = 'sent';
                break;
              } catch (error) {
                if (attempt === 3 || error?.retryable === false) throw error;
                await new Promise((resolve) =>
                  setTimeout(resolve, attempt * 500),
                );
              }
            }
          }
        } catch (error) {
          delivery.status = 'failed';
          delivery.error =
            error instanceof WebhookDeliveryError
              ? error.message
              : 'Notification delivery failed; check the configured URL and connection';
        }
        await this.prisma.workbenchConfig.updateMany({
          where: { id, ownerUid, kind: deliveryKind },
          data: { value: encode(delivery) },
        });
        workbenchEvents.publish(ownerUid, 'automation');
      }),
    );
    for (const result of operations)
      if (result.status === 'rejected')
        this.logger.warn('A notification delivery could not be recorded');
  }

  async manual(ownerUid: string, input: unknown) {
    object(input);
    const options = AutomationConfigSchema.shape.webhook.safeParse(
      input.webhook,
    );
    const parsed = AutomationWebhookReportSchema.safeParse(input.report);
    if (!parsed.success || !options.success || !options.data?.enabled)
      throw new BadRequestException('Invalid completed automation report');
    const report = parsed.data;
    const existing = await this.prisma.workbenchConfig.findFirst({
      where: { id: report.id, ownerUid, kind: reportKind },
    });
    if (!existing) {
      await this.prisma.workbenchConfig.create({
        data: {
          id: report.id,
          ownerUid,
          kind: reportKind,
          value: encode(report),
        },
      });
    }
    // Dispatch separately: notification delivery cannot turn a test into a failure.
    void this.notify(
      ownerUid,
      existing ? decode(existing.value) : report,
      options.data,
    ).catch(() => this.logger.warn('Webhook delivery could not be recorded'));
    return { id: report.id };
  }
}
