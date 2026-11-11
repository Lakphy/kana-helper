import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));

await exec(process.execPath, ['build.mjs'], { cwd: root, stdio: 'inherit' });
const { version } = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const zip = resolve(root, `kana-helper-v${version}.zip`);
await rm(zip, { force: true });
await exec('zip', ['-r', zip, '.'], { cwd: resolve(root, 'dist'), stdio: 'inherit' });
console.log(zip);
