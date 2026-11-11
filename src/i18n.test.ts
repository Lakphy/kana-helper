import { describe, expect, it } from 'vitest';
import { formatMessage, languageTag, localeFolder } from './i18n';

describe('interface language', () => {
  it('maps a chosen language and falls back from the browser language', () => {
    expect(localeFolder('ja')).toBe('ja');
    expect(localeFolder('zh-CN')).toBe('zh_CN');
    expect(localeFolder('zh-TW')).toBe('zh_TW');
    expect(localeFolder('auto', 'zh-TW')).toBe('zh_TW');
    expect(localeFolder('auto', 'zh-HK')).toBe('zh_TW');
    expect(localeFolder('auto', 'zh-CN')).toBe('zh_CN');
    expect(localeFolder('auto', 'ja-JP')).toBe('ja');
    expect(localeFolder('auto', 'ko')).toBe('ko');
    expect(localeFolder('auto', 'en-US')).toBe('en');
    expect(localeFolder('auto', 'fr')).toBe('en');
    expect(languageTag('auto', 'zh-HK')).toBe('zh-TW');
    expect(languageTag('ja', 'zh-CN')).toBe('ja');
  });

  it('fills the first placeholder', () => {
    expect(
      formatMessage({ message: 'On $HOST$', placeholders: { host: { content: '$1' } } }, 'example.com'),
    ).toBe('On example.com');
    expect(formatMessage({ message: 'Shortcut $KEY$', placeholders: { key: { content: '$1' } } })).toBe(
      'Shortcut $KEY$',
    );
  });
});