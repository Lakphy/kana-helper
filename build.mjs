import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const shared = {
  bundle: true,
  target: 'chrome111',
  minify: true,
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'info',
};

await Promise.all([
  build({
    ...shared,
    entryPoints: [resolve(root, 'src/background.ts')],
    outfile: resolve(dist, 'background.js'),
    format: 'esm',
    platform: 'browser',
    banner: {
      js: '/* Includes @patdx/kuromoji (Apache-2.0) and wanakana (MIT). */',
    },
  }),
  build({
    ...shared,
    entryPoints: [resolve(root, 'src/content.ts')],
    outfile: resolve(dist, 'content.js'),
    format: 'iife',
    platform: 'browser',
  }),
  build({
    ...shared,
    entryPoints: [resolve(root, 'src/popup.ts')],
    outfile: resolve(dist, 'popup.js'),
    format: 'iife',
    platform: 'browser',
  }),
]);

await cp(resolve(root, 'src/content.css'), resolve(dist, 'content.css'));
await cp(resolve(root, 'src/popup.css'), resolve(dist, 'popup.css'));
await cp(resolve(root, 'src/popup.html'), resolve(dist, 'popup.html'));
await cp(resolve(root, 'manifest.json'), resolve(dist, 'manifest.json'));
await cp(resolve(root, '_locales'), resolve(dist, '_locales'), { recursive: true });
await cp(resolve(root, 'icons'), resolve(dist, 'icons'), { recursive: true });
await cp(resolve(root, 'node_modules/@patdx/kuromoji/dict'), resolve(dist, 'dict'), { recursive: true });
await cp(resolve(root, 'node_modules/@patdx/kuromoji/LICENSE-2.0.txt'), resolve(dist, 'LICENSE.kuromoji.txt'));
await cp(resolve(root, 'node_modules/wanakana/LICENSE'), resolve(dist, 'LICENSE.wanakana.txt'));
