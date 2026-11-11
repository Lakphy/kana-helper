import { applyDocumentLocale, t, useLocale } from './i18n';
import {
  DEFAULT_SETTINGS,
  fontSizeBand,
  normalizeSettings,
  type AnnotationColor,
  type AnnotationMode,
  type AnnotationScope,
  type KanaScript,
  type Settings,
  type UiLanguage,
} from './settings';
import type { StatusResponse } from './types';

const enabledInput = document.querySelector<HTMLInputElement>('#enabled');
const siteRow = document.querySelector<HTMLElement>('#site-row');
const siteInput = document.querySelector<HTMLInputElement>('#site');
const siteLabel = document.querySelector<HTMLElement>('#site-label');
const fontSizeInput = document.querySelector<HTMLInputElement>('#font-size');
const sizeLabel = document.querySelector<HTMLElement>('#size-label');
const opacityRow = document.querySelector<HTMLElement>('#opacity-row');
const opacityInput = document.querySelector<HTMLInputElement>('#opacity');
const opacityLabel = document.querySelector<HTMLElement>('#opacity-label');
const skipCodeInput = document.querySelector<HTMLInputElement>('#skip-code');
const skipChineseInput = document.querySelector<HTMLInputElement>('#skip-chinese');
const languageInput = document.querySelector<HTMLSelectElement>('#language');
const status = document.querySelector<HTMLElement>('#status');
const shortcut = document.querySelector<HTMLElement>('#shortcut');
const resetButton = document.querySelector<HTMLButtonElement>('#reset');

let saved: Settings = { ...DEFAULT_SETTINGS };
let host: string | null = null;

function checkedValue(name: string): string {
  return document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '';
}

function selectRadio(name: string, value: string): void {
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}

function showFontSize(size: number): void {
  if (sizeLabel) sizeLabel.textContent = `${t(fontSizeBand(size))} ${size}%`;
}

function showOpacity(settings: Settings): void {
  if (opacityRow) opacityRow.hidden = settings.color !== 'fade';
  if (opacityInput) opacityInput.value = String(settings.opacity);
  if (opacityLabel) opacityLabel.textContent = `${settings.opacity}%`;
}

function currentSettings(): Settings {
  const mode = checkedValue('mode');
  const scope = checkedValue('scope');
  const color = checkedValue('color');
  const kana = checkedValue('kana');
  return normalizeSettings({
    enabled: enabledInput?.checked ?? true,
    kanaScript: kana === 'katakana' ? 'katakana' : 'hiragana',
    fontSize: Number(fontSizeInput?.value),
    mode: mode as AnnotationMode,
    scope: scope as AnnotationScope,
    color: color as AnnotationColor,
    opacity: Number(opacityInput?.value),
    skipCode: skipCodeInput?.checked ?? false,
    skipChinese: skipChineseInput?.checked ?? true,
    language: (languageInput?.value ?? 'auto') as UiLanguage,
    disabledHosts: saved.disabledHosts,
  });
}

function applyForm(settings: Settings): void {
  saved = settings;
  if (enabledInput) enabledInput.checked = settings.enabled;
  if (skipCodeInput) skipCodeInput.checked = settings.skipCode;
  if (skipChineseInput) skipChineseInput.checked = settings.skipChinese;
  selectRadio('kana', settings.kanaScript);
  selectRadio('mode', settings.mode);
  selectRadio('scope', settings.scope);
  selectRadio('color', settings.color);
  if (fontSizeInput) fontSizeInput.value = String(settings.fontSize);
  showFontSize(settings.fontSize);
  showOpacity(settings);
  if (languageInput) languageInput.value = settings.language;
  if (siteInput) siteInput.checked = host ? !settings.disabledHosts.includes(host) : true;
  if (siteInput) siteInput.disabled = !settings.enabled;
}

function save(next: Settings = currentSettings()): void {
  saved = next;
  void chrome.storage.local.set(next);
}

async function currentHost(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;
  try {
    const url = new URL(tab.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname;
  } catch {
    return null;
  }
}

async function load(): Promise<void> {
  host = await currentHost();
  const settings = normalizeSettings(await chrome.storage.local.get(DEFAULT_SETTINGS));
  await useLocale(settings.language);
  applyDocumentLocale();
  if (siteRow && siteLabel) {
    if (host) {
      siteRow.hidden = false;
      siteLabel.textContent = t('siteHost', host);
    } else {
      siteRow.hidden = true;
    }
  }
  applyForm(settings);
  chrome.runtime.sendMessage({ type: 'status' }, (response: StatusResponse | undefined) => {
    if (!status || chrome.runtime.lastError || !response) return;
    status.textContent = response.error
      ? t('statusError')
      : response.ready
        ? t('statusReady')
        : response.loading
          ? t('statusLoading')
          : t('statusIdle');
  });
  const commands = await chrome.commands.getAll();
  const toggle = commands.find((command) => command.name === 'toggle');
  if (shortcut) shortcut.textContent = toggle?.shortcut ? t('shortcut', toggle.shortcut) : t('shortcutMissing');
}

enabledInput?.addEventListener('change', () => {
  if (siteInput) siteInput.disabled = !enabledInput.checked;
  save();
});

siteInput?.addEventListener('change', () => {
  if (!host) return;
  const hosts = new Set(saved.disabledHosts);
  if (siteInput.checked) hosts.delete(host);
  else hosts.add(host);
  save({ ...currentSettings(), disabledHosts: [...hosts] });
});

for (const input of document.querySelectorAll<HTMLInputElement>('input[type="radio"], #skip-code, #skip-chinese')) {
  input.addEventListener('change', () => {
    const next = currentSettings();
    showOpacity(next);
    save(next);
  });
}

opacityInput?.addEventListener('input', () => {
  const next = currentSettings();
  showOpacity(next);
  save(next);
});

languageInput?.addEventListener('change', () => save());

fontSizeInput?.addEventListener('input', () => {
  const next = currentSettings();
  showFontSize(next.fontSize);
  save(next);
});

resetButton?.addEventListener('click', () => {
  const kanaScript: KanaScript = 'hiragana';
  save({ ...DEFAULT_SETTINGS, kanaScript, disabledHosts: [] });
  applyForm({ ...DEFAULT_SETTINGS });
});

chrome.storage.onChanged.addListener(() => {
  void load();
});

void load();
