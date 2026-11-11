import { appendFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function tokenRequest(env, now = Math.floor(Date.now() / 1000)) {
  if (env.CWS_SERVICE_ACCOUNT_JSON) {
    const account = JSON.parse(env.CWS_SERVICE_ACCOUNT_JSON);
    if (!account.client_email || !account.private_key) throw new Error('Service account email and private key are required.');
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/chromewebstore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key).toString('base64url');
    return new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    });
  }
  if (!env.CHROME_CLIENT_ID || !env.CHROME_CLIENT_SECRET || !env.CHROME_REFRESH_TOKEN) {
    throw new Error('Configure CWS_SERVICE_ACCOUNT_JSON or all three Chrome OAuth credentials.');
  }
  return new URLSearchParams({
    client_id: env.CHROME_CLIENT_ID,
    client_secret: env.CHROME_CLIENT_SECRET,
    refresh_token: env.CHROME_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
}

export async function accessToken(env, request = fetch) {
  const response = await request('https://oauth2.googleapis.com/token', { method: 'POST', body: tokenRequest(env) });
  const json = await response.json();
  if (!response.ok || typeof json.access_token !== 'string' || !json.access_token || /[\r\n]/.test(json.access_token)) {
    throw new Error(`OAuth token request failed (${response.status}): ${json.error ?? 'missing or invalid access token'}`);
  }
  return json.access_token;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is not set.');
    const token = await accessToken(process.env);
    console.log('::add-mask::' + token);
    await appendFile(process.env.GITHUB_OUTPUT, `access_token=${token}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'OAuth token request failed.');
    process.exit(1);
  }
}
