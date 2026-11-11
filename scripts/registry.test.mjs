import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { registryRawUrl } from './publish-foss.mjs';

describe('FOSS registry entry', () => {
  it('has the fields the store schema requires', async () => {
    const yaml = await readFile(new URL('../store/kana-helper.yaml', import.meta.url), 'utf8');
    for (const key of ['id: kana-helper', 'name: Kana Helper', 'source_repo: https://github.com/Lakphy/kana-helper', 'developer_email:', 'license: MIT']) {
      expect(yaml).toContain(key);
    }
    expect(registryRawUrl()).toBe(
      'https://codeberg.org/foss-extensions/registry/raw/branch/main/extensions/kana-helper.yaml',
    );
  });
});
