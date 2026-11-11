import type { UiLanguage } from './settings';

export const APP_NAME = 'Kana Helper';

const FOLDERS = {
  en: 'en',
  ja: 'ja',
  'zh-CN': 'zh_CN',
  'zh-TW': 'zh_TW',
  ko: 'ko',
} as const;

type Folder = (typeof FOLDERS)[keyof typeof FOLDERS];

export type MessageEntry = {
  message: string;
  placeholders?: Record<string, { content: string }>;
};

export type Catalog = Record<string, MessageEntry>;

export function localeFolder(language: UiLanguage, uiLanguage = 'en'): Folder {
  if (language !== 'auto') return FOLDERS[language];
  const code = uiLanguage.toLowerCase().replace(/_/g, '-');
  if (code.startsWith('zh')) {
    if (code.includes('tw') || code.includes('hk') || code.includes('mo') || code.includes('hant')) return 'zh_TW';
    return 'zh_CN';
  }
  if (code.startsWith('ja')) return 'ja';
  if (code.startsWith('ko')) return 'ko';
  return 'en';
}

export function languageTag(language: UiLanguage, uiLanguage = 'en'): string {
  if (language !== 'auto') return language;
  const folder = localeFolder('auto', uiLanguage);
  if (folder === 'zh_CN') return 'zh-CN';
  if (folder === 'zh_TW') return 'zh-TW';
  return folder;
}

export function formatMessage(entry: MessageEntry | undefined, substitution?: string): string {
  if (!entry?.message) return '';
  let message = entry.message;
  if (substitution === undefined || !entry.placeholders) return message;
  for (const [name, placeholder] of Object.entries(entry.placeholders)) {
    if (placeholder.content === '$1') message = message.replaceAll(`$${name.toUpperCase()}$`, substitution);
  }
  return message;
}

const catalogs = new Map<Folder, Catalog>();
let active: Catalog | null = null;
let activeTag = 'en';

export async function useLocale(language: UiLanguage): Promise<void> {
  const uiLanguage = chrome.i18n.getUILanguage();
  const folder = localeFolder(language, uiLanguage);
  activeTag = languageTag(language, uiLanguage);
  let catalog = catalogs.get(folder);
  if (!catalog) {
    const response = await fetch(chrome.runtime.getURL(`_locales/${folder}/messages.json`));
    if (!response.ok) throw new Error(`Missing locale ${folder}`);
    catalog = (await response.json()) as Catalog;
    catalogs.set(folder, catalog);
  }
  active = catalog;
}

export function t(key: string, substitution?: string): string {
  const formatted = formatMessage(active?.[key], substitution);
  if (formatted) return formatted;
  const message = substitution === undefined ? chrome.i18n.getMessage(key) : chrome.i18n.getMessage(key, substitution);
  return message || key;
}

export function applyDocumentLocale(): void {
  document.documentElement.lang = activeTag;
  document.title = APP_NAME;
  const name = document.querySelector('#app-name');
  if (name) name.textContent = APP_NAME;
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = node.dataset.i18n;
    if (key) node.textContent = t(key);
  }
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const key = node.dataset.i18nTitle;
    if (key) node.title = t(key);
  }
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n-label]')) {
    const key = node.dataset.i18nLabel;
    if (key) node.setAttribute('aria-label', t(key));
  }
}
