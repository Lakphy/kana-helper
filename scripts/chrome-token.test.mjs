import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { accessToken, tokenRequest } from './chrome-token.mjs';

describe('Chrome authentication', () => {
  it('signs a one-hour JWT scoped only to Chrome Web Store', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const body = tokenRequest({ CWS_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: 'publisher@example.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    }) }, 1000);
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [header, claims, signature] = body.get('assertion').split('.');
    expect(JSON.parse(Buffer.from(claims, 'base64url'))).toEqual({
      iss: 'publisher@example.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/chromewebstore',
      aud: 'https://oauth2.googleapis.com/token', iat: 1000, exp: 4600,
    });
    expect(createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  const oauth = { CHROME_CLIENT_ID: 'client', CHROME_CLIENT_SECRET: 'secret', CHROME_REFRESH_TOKEN: 'refresh' };

  it('retains refresh-token authentication as a fallback', () => {
    expect(Object.fromEntries(tokenRequest(oauth))).toEqual({
      client_id: 'client', client_secret: 'secret', refresh_token: 'refresh', grant_type: 'refresh_token',
    });
    expect(() => tokenRequest({})).toThrow(/Configure/);
  });

  it('rejects failed authentication and tokens that could inject workflow output', async () => {
    await expect(accessToken(oauth, async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) }))).rejects.toThrow(/invalid_grant/);
    await expect(accessToken(oauth, async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'token\ninjected=value' }) }))).rejects.toThrow(/invalid access token/);
    await expect(accessToken(oauth, async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'valid-token' }) }))).resolves.toBe('valid-token');
  });
});
