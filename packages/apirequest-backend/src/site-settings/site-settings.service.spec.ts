import { SiteSettingsService, normalizeSiteURL } from './site-settings.service';
jest.mock('src/utils', () => ({
  encrypt: (value: string) => value,
  decrypt: (value: string) => value,
}));
jest.mock('src/prisma/prisma.service', () => ({ PrismaService: class {} }));
function fixture() {
  const rows = new Map<string, any>();
  const db = {
    findUnique: jest.fn(async ({ where }) => rows.get(where.id) ?? null),
    findFirst: jest.fn(
      async ({ where }) =>
        [...rows.values()].find((row) => row.kind === where.kind) ?? null,
    ),
    upsert: jest.fn(async ({ where, create, update }) =>
      rows.set(
        where.id,
        rows.has(where.id) ? { ...rows.get(where.id), ...update } : create,
      ),
    ),
  };
  const service = new SiteSettingsService(
    { workbenchConfig: db } as any,
    { get: () => 'http://127.0.0.1:3000' } as any,
  );
  return { service, db, rows };
}
describe('shared public site settings', () => {
  it('defaults to the deployment URL and shares saved URLs with all link builders', async () => {
    const { service, rows } = fixture();
    await service.onModuleInit();
    expect(service.url('automation?report=id')).toBe(
      'http://127.0.0.1:3000/automation?report=id',
    );
    await service.save('owner', { siteURL: 'https://site.example.com/tools/' });
    expect(service.url('/view/slug/1.0')).toBe(
      'https://site.example.com/tools/view/slug/1.0',
    );
    expect(service.url('automation?report=id')).toBe(
      'https://site.example.com/tools/automation?report=id',
    );
    const restored = fixture();
    restored.rows.set(
      'workbench:site-settings',
      rows.get('workbench:site-settings'),
    );
    await restored.service.onModuleInit();
    expect(restored.service.get().siteURL).toBe(
      'https://site.example.com/tools',
    );
  });
  it('preserves the previous report base URL on upgrade and prioritizes explicit site settings thereafter', async () => {
    const { service, rows } = fixture();
    rows.set('legacy', {
      kind: 'automation_webhook_settings',
      value: JSON.stringify({ reportBaseURL: 'https://public.example.com' }),
    });
    await service.onModuleInit();
    expect(service.get().siteURL).toBe('https://public.example.com');
    await service.save('owner', { siteURL: 'https://new.example.com' });
    await service.onModuleInit();
    expect(service.get().siteURL).toBe('https://new.example.com');
  });
  it.each([
    'file:///tmp/site',
    'https://user:secret@example.com',
    'https://example.com/?key=secret',
    'https://example.com/#hash',
    '',
    null,
  ])('rejects invalid site URLs: %j', (url) => {
    expect(() => normalizeSiteURL(url)).toThrow('Invalid site URL');
  });
});
