import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const LOCALES = ['en', 'ja', 'zh_CN', 'zh_TW', 'ko'] as const;
const NAMED = ['commandToggle', 'titleOff', 'titleHiragana', 'titleKatakana'];

type Catalog = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;

function load(locale: string): Catalog {
  return JSON.parse(readFileSync(`_locales/${locale}/messages.json`, 'utf8')) as Catalog;
}

const catalogs = Object.fromEntries(LOCALES.map((locale) => [locale, load(locale)])) as Record<
  (typeof LOCALES)[number],
  Catalog
>;

describe('locales', () => {
  it('keeps the same keys, placeholders, and a short description in every language', () => {
    const english = catalogs.en;
    const keys = Object.keys(english).sort();
    for (const locale of LOCALES) {
      const catalog = catalogs[locale];
      expect(Object.keys(catalog).sort(), locale).toEqual(keys);
      for (const key of keys) {
        const message = catalog[key]?.message ?? '';
        expect(message.trim(), `${locale}.${key}`).not.toBe('');
        const tokens = [...message.matchAll(/\$([A-Z0-9_]+)\$/g)].map((match) => match[1]);
        const placeholders = Object.keys(catalog[key]?.placeholders ?? {}).map((name) => name.toUpperCase());
        expect(tokens.sort(), `${locale}.${key}`).toEqual(placeholders.sort());
        if (key === 'description') expect(message.length, `${locale}.description`).toBeLessThanOrEqual(132);
      }
    }
  });

  it('keeps the product name in English', () => {
    const manifest = JSON.parse(readFileSync('manifest.json', 'utf8')) as { name: string; default_locale: string };
    expect(manifest.name).toBe('Kana Helper');
    expect(manifest.default_locale).toBe('en');
    for (const locale of LOCALES) {
      for (const key of NAMED) expect(catalogs[locale][key]?.message).toContain('Kana Helper');
    }
  });
});
