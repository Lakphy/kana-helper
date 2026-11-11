import { TokenizerBuilder, type IpadicFeatures } from '@patdx/kuromoji';
import { annotateText } from './annotate';
import { t, useLocale } from './i18n';
import { DEFAULT_SETTINGS, normalizeSettings, type AnnotationScope, type KanaScript } from './settings';
import type { AnnotateRequest, AnnotateResponse, Piece, StatusResponse } from './types';

const CACHE_LIMIT = 800;
const cache = new Map<string, Piece[]>();

type Analyzer = Awaited<ReturnType<TokenizerBuilder['build']>>;

let building: Promise<Analyzer> | null = null;
let ready = false;
let loadError: string | null = null;

async function gunzip(data: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Response(data).body;
  if (!stream) throw new Error('Empty dictionary response');
  return new Response(stream.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

function dictionaryLoader() {
  const base = chrome.runtime.getURL('dict/');
  return {
    async loadArrayBuffer(filename: string): Promise<ArrayBuffer> {
      const response = await fetch(base + filename);
      if (!response.ok) throw new Error(`Could not load dictionary: ${filename}`);
      return gunzip(await response.arrayBuffer());
    },
  };
}

function getTokenizer(): Promise<Analyzer> {
  if (!building) {
    ready = false;
    loadError = null;
    building = new TokenizerBuilder({ loader: dictionaryLoader() })
      .build()
      .then((tokenizer) => {
        ready = true;
        return tokenizer;
      })
      .catch((error: unknown) => {
        building = null;
        ready = false;
        loadError = error instanceof Error ? error.message : String(error);
        throw error;
      });
  }
  return building;
}

function remember(key: string, pieces: Piece[]): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, pieces);
  if (cache.size <= CACHE_LIMIT) return;
  const oldest = cache.keys().next().value;
  if (oldest) cache.delete(oldest);
}

function annotate(tokenizer: Analyzer, text: string, script: KanaScript, scope: AnnotationScope): Piece[] {
  const key = `${script}\u0000${scope}\u0000${text}`;
  if (text.length <= 240) {
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
  }
  const pieces = annotateText(text, script, (value) => tokenizer.tokenize(value) as IpadicFeatures[], scope);
  if (text.length <= 240) remember(key, pieces);
  return pieces;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'jkh') return;
  port.onMessage.addListener((message: AnnotateRequest) => {
    if (!message || message.type !== 'annotate' || !Array.isArray(message.texts)) return;
    void (async () => {
      const reply = async (payload: AnnotateResponse) => {
        try {
          port.postMessage(payload);
        } catch {
          // The frame closed while the dictionary was loading.
        }
      };
      try {
        const tokenizer = await getTokenizer();
        const scope = message.scope === 'kanji' ? 'kanji' : 'all';
        const pieces = message.texts.map((text) => annotate(tokenizer, String(text), message.script, scope));
        await reply({ type: 'annotate', id: message.id, pieces });
      } catch (error) {
        await reply({
          type: 'annotate',
          id: message.id,
          pieces: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'status') {
    const status: StatusResponse = {
      ready,
      loading: building !== null && !ready,
      error: loadError,
    };
    sendResponse(status);
    return;
  }
  if (message?.type === 'badge' && sender.tab?.id != null) {
    const active = Boolean(message.active);
    void chrome.action.setBadgeText({ tabId: sender.tab.id, text: active ? '' : 'OFF' });
    void chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#8a847c' });
  }
});

async function updateBadge(): Promise<void> {
  try {
    const settings = normalizeSettings(await chrome.storage.local.get(DEFAULT_SETTINGS));
    await useLocale(settings.language);
    if (!settings.enabled) {
      await chrome.action.setBadgeText({ text: 'OFF' });
      await chrome.action.setBadgeBackgroundColor({ color: '#8a847c' });
      await chrome.action.setTitle({ title: t('titleOff') });
      return;
    }
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({
      title: t(settings.kanaScript === 'katakana' ? 'titleKatakana' : 'titleHiragana'),
    });
  } catch (error) {
    console.warn('Kana Helper badge update failed', error);
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle') return;
  void (async () => {
    const settings = normalizeSettings(await chrome.storage.local.get(DEFAULT_SETTINGS));
    await chrome.storage.local.set({ enabled: !settings.enabled });
  })();
});
chrome.runtime.onStartup.addListener(() => {
  void updateBadge();
});
chrome.runtime.onInstalled.addListener(() => {
  void updateBadge();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.enabled || changes.kanaScript || changes.language)) void updateBadge();
});
void updateBadge();
