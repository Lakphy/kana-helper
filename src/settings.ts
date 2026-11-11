export type KanaScript = 'hiragana' | 'katakana';
export type AnnotationMode = 'both' | 'kana' | 'romaji';
export type AnnotationScope = 'all' | 'kanji';
export type AnnotationColor = 'auto' | 'fade' | 'blue' | 'green' | 'orange';
export type UiLanguage = 'auto' | 'en' | 'ja' | 'zh-CN' | 'zh-TW' | 'ko';

export type Settings = {
  enabled: boolean;
  kanaScript: KanaScript;
  /** Annotation size as a percentage of the page text. 48 means 0.48em. */
  fontSize: number;
  mode: AnnotationMode;
  scope: AnnotationScope;
  color: AnnotationColor;
  /** Annotation opacity as a percentage. Used when color is fade. */
  opacity: number;
  skipCode: boolean;
  language: UiLanguage;
  disabledHosts: string[];
};

export const FONT_SIZE_MIN = 32;
export const FONT_SIZE_MAX = 80;
export const FONT_SIZE_STEP = 4;

export const OPACITY_MIN = 20;
export const OPACITY_MAX = 80;
export const OPACITY_STEP = 5;

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  kanaScript: 'hiragana',
  fontSize: 48,
  mode: 'both',
  scope: 'all',
  color: 'auto',
  opacity: 50,
  skipCode: false,
  language: 'auto',
  disabledHosts: [],
};

const MODES = new Set<AnnotationMode>(['both', 'kana', 'romaji']);
const SCOPES = new Set<AnnotationScope>(['all', 'kanji']);
const COLORS = new Set<AnnotationColor>(['auto', 'fade', 'blue', 'green', 'orange']);
const LANGUAGES = new Set<UiLanguage>(['auto', 'en', 'ja', 'zh-CN', 'zh-TW', 'ko']);

export function normalizeFontSize(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return DEFAULT_SETTINGS.fontSize;
  const clamped = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, number));
  return Math.round(clamped / FONT_SIZE_STEP) * FONT_SIZE_STEP;
}

export function normalizeOpacity(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return DEFAULT_SETTINGS.opacity;
  const clamped = Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, number));
  return Math.round(clamped / OPACITY_STEP) * OPACITY_STEP;
}

export function fontSizeBand(size: number): 'sizeTiny' | 'sizeSmall' | 'sizeNormal' | 'sizeLarge' | 'sizeHuge' {
  if (size <= 40) return 'sizeTiny';
  if (size < 48) return 'sizeSmall';
  if (size <= 52) return 'sizeNormal';
  if (size <= 64) return 'sizeLarge';
  return 'sizeHuge';
}

export function normalizeHosts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const hosts = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const host = item.trim().toLowerCase();
    if (!host || host.length > 253 || /[\s/]/.test(host)) continue;
    hosts.add(host);
    if (hosts.size >= 300) break;
  }
  return [...hosts];
}

export function normalizeSettings(raw: Partial<Settings> | undefined): Settings {
  const script = raw?.kanaScript;
  const mode = raw?.mode;
  const scope = raw?.scope;
  const color = raw?.color;
  const language = raw?.language;
  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : DEFAULT_SETTINGS.enabled,
    kanaScript: script === 'katakana' || script === 'hiragana' ? script : DEFAULT_SETTINGS.kanaScript,
    fontSize: normalizeFontSize(raw?.fontSize),
    mode: mode && MODES.has(mode) ? mode : DEFAULT_SETTINGS.mode,
    scope: scope && SCOPES.has(scope) ? scope : DEFAULT_SETTINGS.scope,
    color: color && COLORS.has(color) ? color : DEFAULT_SETTINGS.color,
    opacity: normalizeOpacity(raw?.opacity),
    skipCode: typeof raw?.skipCode === 'boolean' ? raw.skipCode : DEFAULT_SETTINGS.skipCode,
    language: language && LANGUAGES.has(language) ? language : DEFAULT_SETTINGS.language,
    disabledHosts: normalizeHosts(raw?.disabledHosts),
  };
}
