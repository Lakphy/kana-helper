import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REGISTRY = 'foss-extensions/registry';
const FILE = 'extensions/kana-helper.yaml';
const API = 'https://codeberg.org/api/v1';

export function registryRawUrl() {
  return `https://codeberg.org/${REGISTRY}/raw/branch/main/${FILE}`;
}

async function codeberg(path, token, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text };
    }
  }
  if (!response.ok) {
    const error = new Error(`Codeberg ${response.status} ${path}: ${body.message ?? text}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function ensurePullRequest(token, yaml) {
  const user = await codeberg('/user', token);
  const login = user.login;
  try {
    await codeberg(`/repos/${REGISTRY}/forks`, token, { method: 'POST', body: '{}' });
  } catch (error) {
    if (error.status !== 409) throw error;
  }
  const branch = 'add-kana-helper';
  try {
    await codeberg(`/repos/${login}/registry/branches`, token, {
      method: 'POST',
      body: JSON.stringify({ new_branch_name: branch, old_branch_name: 'main' }),
    });
  } catch (error) {
    if (error.status !== 409) throw error;
  }
  const content = Buffer.from(yaml).toString('base64');
  try {
    await codeberg(`/repos/${login}/registry/contents/${FILE}`, token, {
      method: 'POST',
      body: JSON.stringify({
        branch,
        content,
        message: 'Add Kana Helper',
      }),
    });
  } catch (error) {
    if (error.status !== 422) throw error;
  }
  const pulls = await codeberg(`/repos/${REGISTRY}/pulls?state=open`, token);
  const existing = Array.isArray(pulls) && pulls.find((pull) => pull.head?.ref === branch && pull.user?.login === login);
  if (existing) {
    console.log(`Registry pull request already open: ${existing.html_url}`);
    return;
  }
  const created = await codeberg(`/repos/${REGISTRY}/pulls`, token, {
    method: 'POST',
    body: JSON.stringify({
      head: `${login}:${branch}`,
      base: 'main',
      title: 'Add Kana Helper',
      body: 'The Kana Helper developer asked to list this extension. Tagged v* releases on https://github.com/Lakphy/kana-helper are the versions to build. Please do not add this GitHub account to CONTRIBUTORS.md.',
    }),
  });
  console.log(`Opened registry pull request: ${created.html_url}`);
}

export async function publishFoss(env = process.env) {
  const listed = await fetch(registryRawUrl());
  if (listed.ok) {
    console.log('FOSS Extensions Store already lists kana-helper. New v* tags are built from the public repository.');
    return;
  }
  if (!env.CODEBERG_TOKEN) {
    throw new Error(
      `kana-helper is not in the FOSS Extensions Store registry yet. Add a Codeberg CODEBERG_TOKEN secret so this job can open the registry pull request, or open it by hand with store/kana-helper.yaml. Listing URL checked: ${registryRawUrl()}`,
    );
  }
  const root = fileURLToPath(new URL('..', import.meta.url));
  const yaml = await readFile(resolve(root, 'store/kana-helper.yaml'), 'utf8');
  await ensurePullRequest(env.CODEBERG_TOKEN, yaml);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await publishFoss();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
