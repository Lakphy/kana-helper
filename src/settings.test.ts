import { describe, expect, it } from 'vitest';
import { fontSizeBand, normalizeFontSize, normalizeOpacity, normalizeSettings } from './settings';

describe('font size', () => {
  it('keeps the default when the stored value is missing or invalid', () => {
    expect(normalizeSettings({}).fontSize).toBe(48);
    expect(normalizeSettings({ fontSize: Number.NaN }).fontSize).toBe(48);
  });

  it('drops hostnames that are not real hosts and ignores unknown modes', () => {
    expect(normalizeSettings({ mode: 'kana', scope: 'kanji', color: 'blue', skipCode: true }).mode).toBe('kana');
    expect(normalizeSettings({ mode: 'sideways' as 'both' }).mode).toBe('both');
    expect(normalizeSettings({ disabledHosts: ['Example.com', 'bad host', 'example.com', ''] }).disabledHosts).toEqual([
      'example.com',
    ]);
  });

  it('snaps to the slider step and stays inside the range', () => {
    expect(normalizeFontSize(47)).toBe(48);
    expect(normalizeFontSize(10)).toBe(32);
    expect(normalizeFontSize(99)).toBe(80);
    expect(fontSizeBand(48)).toBe('sizeNormal');
    expect(fontSizeBand(72)).toBe('sizeHuge');
    expect(fontSizeBand(40)).toBe('sizeTiny');
  });

  it('keeps a translucent color and snaps opacity to the slider', () => {
    expect(normalizeSettings({}).opacity).toBe(50);
    expect(normalizeSettings({ color: 'fade' }).color).toBe('fade');
    expect(normalizeOpacity(33)).toBe(35);
    expect(normalizeOpacity(3)).toBe(20);
    expect(normalizeOpacity(99)).toBe(80);
    expect(normalizeSettings({ opacity: Number.NaN }).opacity).toBe(50);
  });

  it('keeps a known interface language and falls back to the browser', () => {
    expect(normalizeSettings({}).language).toBe('auto');
    expect(normalizeSettings({ language: 'ja' }).language).toBe('ja');
    expect(normalizeSettings({ language: 'zh-TW' }).language).toBe('zh-TW');
    expect(normalizeSettings({ language: 'esperanto' as 'en' }).language).toBe('auto');
  });
});
