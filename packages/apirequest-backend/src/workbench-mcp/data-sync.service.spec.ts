import { createServer } from 'node:http';
import { WorkbenchDataSyncService } from './data-sync.service';
describe('configuration cloud transport', () => {
  const service = new WorkbenchDataSyncService(
    {} as any,
    { publish: jest.fn() } as any,
  );
  it('round trips WebDAV with conditional writes without forwarding cookies', async () => {
    let content = '{"hello":"world"}',
      etag = '"1"';
    const server = createServer(async (req, res) => {
      if (req.headers.cookie) throw new Error('cookie forwarded');
      if (req.method === 'PROPFIND') {
        res.writeHead(207).end();
        return;
      }
      if (req.method === 'PUT') {
        if (req.headers['if-match'] !== etag) {
          res.writeHead(412).end();
          return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        content = Buffer.concat(chunks).toString();
        etag = '"2"';
        res.writeHead(204, { etag }).end();
        return;
      }
      res.writeHead(200, { etag }).end(content);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as any).port}/config.json`;
    try {
      const first = await service.http({
        provider: 'webdav',
        url,
        method: 'GET',
      });
      expect(first.headers.etag).toBe('"1"');
      expect(
        (
          await service.http({
            provider: 'webdav',
            url,
            method: 'PUT',
            headers: { 'If-Match': first.headers.etag },
            body: 'changed',
          })
        ).status,
      ).toBe(204);
      expect(
        (await service.http({ provider: 'webdav', url, method: 'GET' })).body,
      ).toBe('changed');
      expect(
        (
          await service.http({
            provider: 'webdav',
            url,
            method: 'PUT',
            headers: { 'If-Match': first.headers.etag },
            body: 'overwrite',
          })
        ).status,
      ).toBe(412);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
  it('rejects invalid destinations and credential-leaking redirects', async () => {
    await expect(
      service.http({
        provider: 'google',
        url: 'http://evil.example/token',
        method: 'POST',
      }),
    ).rejects.toThrow();
    await expect(
      service.http({
        provider: 'webdav',
        url: 'file:///etc/passwd',
        method: 'GET',
      }),
    ).rejects.toThrow();
    await expect(
      service.http({
        provider: 'webdav',
        url: 'http://localhost/',
        method: 'GET',
        headers: { Cookie: 'secret' },
      }),
    ).rejects.toThrow();
  });
  it('binds loopback OAuth callback to the flow state and owner', async () => {
    const flow = await service.oauthStart('owner');
    expect(() => service.oauthPoll('other', flow.id)).toThrow();
    expect(
      (await fetch(`${flow.redirectUri}?state=wrong&code=wrong`)).status,
    ).toBe(400);
    expect(service.oauthPoll('owner', flow.id).pending).toBe(true);
    expect(
      (await fetch(`${flow.redirectUri}?state=${flow.id}&code=sample`)).status,
    ).toBe(200);
    expect(service.oauthPoll('owner', flow.id).code).toBe('sample');
    expect(() => service.oauthPoll('owner', flow.id)).toThrow();
  });
});
