import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const UPLOAD = 'https://chromewebstore.googleapis.com/upload/v2/publishers';
const API = 'https://chromewebstore.googleapis.com/v2/publishers';

export function chromeConfigError(env) {
  if (!env.CHROME_PUBLISHER_ID || !env.CHROME_EXTENSION_ID || !env.CHROME_ACCESS_TOKEN) {
    return 'Set CHROME_ACCESS_TOKEN, CHROME_PUBLISHER_ID, and CHROME_EXTENSION_ID. The Chrome Web Store item must already exist; the API cannot create the first listing.';
  }
  return '';
}

async function request(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Chrome Web Store ${response.status} for ${url}: ${text}`);
  return text ? JSON.parse(text) : {};
}

function uploadState(body) {
  return body.uploadState ?? body.item?.uploadState ?? '';
}

export async function publishZip(zipPath, env = process.env) {
  const error = chromeConfigError(env);
  if (error) throw new Error(error);
  const { CHROME_ACCESS_TOKEN: token, CHROME_PUBLISHER_ID: publisher, CHROME_EXTENSION_ID: extension } = env;
  const item = `${publisher}/items/${extension}`;
  const body = await readFile(zipPath);
  let uploaded = await request(`${UPLOAD}/${item}:upload`, token, { method: 'POST', body });
  const deadline = Date.now() + 90_000;
  while (uploadState(uploaded) === 'IN_PROGRESS' && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 3000));
    uploaded = await request(`${API}/${item}:fetchStatus`, token);
  }
  const state = uploadState(uploaded);
  if (state && state !== 'SUCCEEDED' && state !== 'SUCCESS') {
    throw new Error(`Chrome Web Store upload finished as ${state}: ${JSON.stringify(uploaded)}`);
  }
  return request(`${API}/${item}:publish`, token, {
    method: 'POST',
    headers: { 'Content-Length': '0' },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const error = chromeConfigError(process.env);
  if (error || !process.argv[2]) {
    console.error(error || 'Pass the extension zip path.');
    process.exit(1);
  }
  try {
    const result = await publishZip(process.argv[2]);
    console.log(JSON.stringify(result));
  } catch (failure) {
    console.error(failure instanceof Error ? failure.message : failure);
    process.exit(1);
  }
}
