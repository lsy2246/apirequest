import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';
import { decrypt, encrypt } from 'src/utils';

const id = 'workbench:site-settings';
export function normalizeSiteURL(value: unknown): string {
  try {
    if (typeof value !== 'string' || value.length > 4096) throw new Error();
    const url = new URL(value.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.toString().replace(/\/+$/, '');
  } catch {
    throw new BadRequestException('Invalid site URL');
  }
}

@Injectable()
export class SiteSettingsService implements OnModuleInit {
  private configuredURL = '';
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}
  async onModuleInit() {
    const row = await this.prisma.workbenchConfig.findUnique({ where: { id } });
    if (row)
      this.configuredURL = normalizeSiteURL(
        JSON.parse(decrypt(row.value)).siteURL,
      );
    else {
      // Preserve the public address already used in notification links.
      const legacy = await this.prisma.workbenchConfig.findFirst({
        where: { kind: 'automation_webhook_settings' },
      });
      const url = legacy ? JSON.parse(decrypt(legacy.value)).reportBaseURL : '';
      if (url) this.configuredURL = normalizeSiteURL(url);
    }
  }
  get() {
    const defaultURL = normalizeSiteURL(
      this.config.get<string>('VITE_BASE_URL'),
    );
    return { siteURL: this.configuredURL || defaultURL, defaultURL };
  }
  url(path: string) {
    return new URL(
      path.replace(/^\/+/, ''),
      `${this.get().siteURL}/`,
    ).toString();
  }
  async save(ownerUid: string, input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new BadRequestException('Invalid site settings');
    const siteURL = normalizeSiteURL(
      (input as Record<string, unknown>).siteURL,
    );
    const value = encrypt(JSON.stringify({ siteURL }));
    await this.prisma.workbenchConfig.upsert({
      where: { id },
      create: { id, ownerUid, kind: 'site_settings', value },
      update: { value, revision: { increment: 1 } },
    });
    this.configuredURL = siteURL;
    return this.get();
  }
}
