import { appendFile } from 'node:fs/promises';

const body = new URLSearchParams({
  client_id: process.env.CHROME_CLIENT_ID ?? '',
  client_secret: process.env.CHROME_CLIENT_SECRET ?? '',
  refresh_token: process.env.CHROME_REFRESH_TOKEN ?? '',
  grant_type: 'refresh_token',
});
const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
const json = await response.json();
if (!response.ok || !json.access_token) {
  console.error(`OAuth token refresh failed (${response.status}): ${json.error ?? ''} ${json.error_description ?? ''}`.trim());
  process.exit(1);
}
const output = process.env.GITHUB_OUTPUT;
if (!output) {
  console.error('GITHUB_OUTPUT is not set.');
  process.exit(1);
}
console.log('::add-mask::' + json.access_token);
await appendFile(output, `access_token=${json.access_token}\n`);
