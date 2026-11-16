import { LOCAL_WORKSPACE_UID } from 'src/auth/local-workspace/policy';

// The public Mock route shares the workbench host. Its own session cookies are
// control-plane credentials, rather than part of the API request being mocked.
export function mockRequestHeaders(headers: Record<string, string>) {
  const result = { ...headers };
  if (!result.cookie) return result;
  const cookies = result.cookie.split(';').filter((part) => {
    const split = part.indexOf('=');
    if (split < 0) return true;
    const name = part.slice(0, split).trim();
    if (!['access_token', 'refresh_token'].includes(name)) return true;
    try {
      const token = decodeURIComponent(part.slice(split + 1).trim());
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
      );
      return payload.sub !== LOCAL_WORKSPACE_UID;
    } catch {
      return true;
    }
  });
  if (cookies.length)
    result.cookie = cookies.map((value) => value.trim()).join('; ');
  else delete result.cookie;
  return result;
}
