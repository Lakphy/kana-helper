import { DEFAULT_SETTINGS, normalizeSettings, type AnnotationScope, type KanaScript, type Settings } from './settings';
import { hasJapanese } from './text';
import type { AnnotateResponse, Piece } from './types';

const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'OPTION',
  'TEMPLATE',
  'CANVAS',
  'IFRAME',
  'OBJECT',
  'SVG',
  'MATH',
  'HEAD',
  'TITLE',
  'RP',
  'RT',
  'RUBY',
  'VIDEO',
  'AUDIO',
  'IMG',
  'PICTURE',
]);

const OBSERVER_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
};

type Pending = {
  resolve: (message: AnnotateResponse) => void;
  reject: (error: Error) => void;
  generation: number;
  timer: number;
};

let settings: Settings = { ...DEFAULT_SETTINGS };
let generation = 0;
let port: chrome.runtime.Port | null = null;
let sequence = 0;
let pumping = false;
let scheduled = false;
let observing = false;
let scrollBound = false;
let scrollScheduled = false;

const pending = new Map<number, Pending>();
const queue: Text[] = [];
const queued = new WeakSet<Text>();
const attempts = new WeakMap<Text, number>();
const scanQueue: ParentNode[] = [];
const shadowRoots = new Set<ShadowRoot>();
const tallParents = new Set<Element>();
let observed = new WeakSet<Element>();

const io = new IntersectionObserver(
  (entries) => {
    if (!pageActive()) return;
    let changed = false;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const element = entry.target;
      const rect = entry.boundingClientRect;
      const tall = rect.height > window.innerHeight * 1.7 || rect.width > window.innerWidth * 1.7;
      let waiting = false;
      for (const text of directJapaneseText(element)) {
        if (tall && !textNearViewport(text)) {
          waiting = true;
          continue;
        }
        enqueue(text);
        changed = true;
      }
      if (waiting) tallParents.add(element);
      else {
        tallParents.delete(element);
        io.unobserve(element);
      }
    }
    if (tallParents.size) bindScroll();
    else unbindScroll();
    if (changed) schedule();
  },
  { rootMargin: '280px 0px' },
);

const mo = new MutationObserver((records) => {
  if (!pageActive()) return;
  for (const record of records) {
    if (record.type === 'characterData') {
      noteText(record.target);
      continue;
    }
    for (const node of record.addedNodes) {
      if (node instanceof Element) {
        if (node.classList.contains('jkh-root') || node.closest('.jkh-root')) continue;
        scanQueue.push(node);
      } else {
        noteText(node);
      }
    }
  }
  if (scanQueue.length || queue.length) schedule();
});

function blocked(element: Element): boolean {
  if (SKIP_TAGS.has(element.tagName)) return true;
  if (element.classList.contains('jkh-root') || element.classList.contains('jkh-ann')) return true;
  const html = element as HTMLElement;
  if (html.hidden || element.hasAttribute('inert')) return true;
  if (html.isContentEditable) return true;
  if (element.getAttribute('translate') === 'no') return true;
  if (settings.skipCode && element.closest('pre, code, kbd, samp')) return true;
  return false;
}

function directJapaneseText(element: Element): Text[] {
  const texts: Text[] = [];
  for (const node of element.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const text = node as Text;
    if (!text.nodeValue || !hasJapanese(text.nodeValue)) continue;
    texts.push(text);
  }
  return texts;
}

function textNearViewport(text: Text): boolean {
  const range = document.createRange();
  range.selectNodeContents(text);
  const margin = 320;
  const height = window.innerHeight;
  const width = window.innerWidth;
  for (const rect of range.getClientRects()) {
    if (
      rect.bottom >= -margin &&
      rect.top <= height + margin &&
      rect.right >= -margin &&
      rect.left <= width + margin
    ) {
      return true;
    }
  }
  return false;
}

function elementNearViewport(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const margin = 320;
  return (
    rect.bottom >= -margin &&
    rect.top <= window.innerHeight + margin &&
    rect.right >= -margin &&
    rect.left <= window.innerWidth + margin &&
    rect.width + rect.height > 0
  );
}

function enqueue(text: Text): void {
  if (!pageActive() || queued.has(text) || !text.isConnected) return;
  if (!text.nodeValue || !hasJapanese(text.nodeValue)) return;
  if (text.parentElement?.closest('.jkh-root')) return;
  queued.add(text);
  queue.push(text);
}

function noteText(node: Node): void {
  if (node.nodeType !== Node.TEXT_NODE) return;
  const text = node as Text;
  const parent = text.parentElement;
  if (!parent || blocked(parent) || parent.closest('.jkh-root')) return;
  if (!hasJapanese(text.nodeValue ?? '')) return;
  const tall = parent.getBoundingClientRect().height > window.innerHeight * 1.7;
  if (tall ? textNearViewport(text) : elementNearViewport(parent)) enqueue(text);
  else observeParent(parent);
}

function observeParent(element: Element): void {
  if (!pageActive() || observed.has(element) || blocked(element)) return;
  observed.add(element);
  io.observe(element);
}

function watchShadow(root: ShadowRoot): void {
  if (shadowRoots.has(root)) return;
  shadowRoots.add(root);
  mo.observe(root, OBSERVER_OPTIONS);
  scanQueue.push(root);
}

function scan(root: ParentNode): void {
  if (!pageActive()) return;
  if ('isConnected' in root && !root.isConnected) return;
  if (root instanceof Element && blocked(root)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        if (blocked(element)) return NodeFilter.FILTER_REJECT;
        if (element.shadowRoot) watchShadow(element.shadowRoot);
        return NodeFilter.FILTER_SKIP;
      }
      const text = node as Text;
      if (!text.nodeValue || !hasJapanese(text.nodeValue)) return NodeFilter.FILTER_REJECT;
      const parent = text.parentElement;
      if (!parent || blocked(parent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) {
    const parent = (walker.currentNode as Text).parentElement;
    if (parent) observeParent(parent);
  }
}

function onScroll(): void {
  if (scrollScheduled) return;
  scrollScheduled = true;
  requestAnimationFrame(() => {
    scrollScheduled = false;
    let changed = false;
    for (const element of [...tallParents]) {
      if (!element.isConnected) {
        tallParents.delete(element);
        continue;
      }
      let waiting = false;
      for (const text of directJapaneseText(element)) {
        if (queued.has(text)) continue;
        if (!textNearViewport(text)) {
          waiting = true;
          continue;
        }
        enqueue(text);
        changed = true;
      }
      if (!waiting) {
        tallParents.delete(element);
        io.unobserve(element);
      }
    }
    if (!tallParents.size) unbindScroll();
    if (changed) schedule();
  });
}

function bindScroll(): void {
  if (scrollBound) return;
  scrollBound = true;
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window.addEventListener('resize', onScroll, { passive: true });
}

function unbindScroll(): void {
  if (!scrollBound) return;
  scrollBound = false;
  window.removeEventListener('scroll', onScroll, true);
  window.removeEventListener('resize', onScroll);
}

function connect(): chrome.runtime.Port {
  if (port) return port;
  const next = chrome.runtime.connect({ name: 'jkh' });
  next.onMessage.addListener((message: AnnotateResponse) => {
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    window.clearTimeout(item.timer);
    item.resolve(message);
  });
  next.onDisconnect.addListener(() => {
    port = null;
    for (const item of pending.values()) {
      window.clearTimeout(item.timer);
      item.reject(new Error(chrome.runtime.lastError?.message || 'disconnected'));
    }
    pending.clear();
  });
  port = next;
  return next;
}

function disconnectPort(): void {
  const current = port;
  port = null;
  current?.disconnect();
}

function request(texts: string[], script: KanaScript, scope: AnnotationScope): Promise<AnnotateResponse> {
  const id = ++sequence;
  const currentGeneration = generation;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error('timeout'));
    }, 20_000);
    pending.set(id, { resolve, reject, generation: currentGeneration, timer });
    try {
      connect().postMessage({ type: 'annotate', id, script, scope, texts });
    } catch (error) {
      window.clearTimeout(timer);
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function readingElement(romaji: string, kana: string | undefined, columns?: { kana: string; romaji: string }[]): HTMLSpanElement {
  const read = document.createElement('span');
  read.className = 'jkh-read';
  read.setAttribute('aria-hidden', 'true');
  read.translate = false;
  const cells = columns && columns.length > 0 ? columns : [{ kana: kana ?? '', romaji }];
  for (const cell of cells) {
    const mora = document.createElement('span');
    mora.className = 'jkh-m';
    if (cell.kana) {
      const kanaEl = document.createElement('span');
      kanaEl.className = 'jkh-k';
      kanaEl.textContent = cell.kana;
      mora.append(kanaEl);
    }
    const romajiEl = document.createElement('span');
    romajiEl.className = 'jkh-r';
    romajiEl.textContent = cell.romaji;
    mora.append(romajiEl);
    read.append(mora);
  }
  return read;
}

function render(pieces: Piece[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const piece of pieces) {
    if (piece.kind === 'text') {
      fragment.append(document.createTextNode(piece.text));
      continue;
    }
    const unit = document.createElement('span');
    unit.className = 'jkh-unit';
    unit.append(readingElement(piece.romaji, piece.kana, piece.columns));
    unit.append(document.createTextNode(piece.base));
    fragment.append(unit);
  }
  return fragment;
}

function wrap(text: Text, pieces: Piece[]): void {
  const parent = text.parentNode;
  if (!parent || parent instanceof Element && parent.closest('.jkh-root')) return;
  const host = document.createElement('span');
  host.className = 'jkh-root';
  host.append(render(pieces));
  parent.replaceChild(host, text);
}

function originalText(host: Element): string {
  let text = '';
  for (const node of host.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue ?? '';
      continue;
    }
    if (!(node instanceof HTMLElement) || !node.classList.contains('jkh-unit')) continue;
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text += child.nodeValue ?? '';
    }
  }
  return text;
}

function unwrap(host: Element): void {
  const text = originalText(host);
  host.replaceWith(document.createTextNode(text));
}

function unwrapAll(): void {
  const hosts = [...document.querySelectorAll('.jkh-root')];
  for (const root of shadowRoots) {
    if (root.isConnected) hosts.push(...root.querySelectorAll('.jkh-root'));
  }
  for (const host of hosts) unwrap(host);
}

function clearQueue(): void {
  for (const text of queue) queued.delete(text);
  queue.length = 0;
  scanQueue.length = 0;
}

function resetIntersection(): void {
  io.disconnect();
  observed = new WeakSet();
  tallParents.clear();
  unbindScroll();
}

function stopObserving(): void {
  mo.disconnect();
  observing = false;
  resetIntersection();
}

function ensureObserving(): void {
  if (!observing && document.documentElement) {
    mo.observe(document.documentElement, OBSERVER_OPTIONS);
    observing = true;
  }
  for (const root of shadowRoots) {
    if (root.isConnected) mo.observe(root, OBSERVER_OPTIONS);
  }
}

function takeBatch(): Text[] {
  const batch: Text[] = [];
  let chars = 0;
  while (queue.length && batch.length < 24 && chars < 8000) {
    const text = queue.shift();
    if (!text) break;
    queued.delete(text);
    if (!text.isConnected || text.parentElement?.closest('.jkh-root')) continue;
    const value = text.nodeValue ?? '';
    if (!hasJapanese(value)) continue;
    batch.push(text);
    chars += value.length;
  }
  return batch;
}

function retry(batch: Text[]): void {
  const again: Text[] = [];
  let delay = 500;
  for (const text of batch) {
    const count = (attempts.get(text) ?? 0) + 1;
    attempts.set(text, count);
    if (count <= 3 && text.isConnected) again.push(text);
    delay = Math.max(delay, 400 * count);
  }
  if (!again.length) return;
  window.setTimeout(() => {
    if (!pageActive()) return;
    for (const text of again) enqueue(text);
    schedule();
  }, Math.min(delay, 2500));
}

async function annotateBatch(batch: Text[]): Promise<void> {
  const currentGeneration = generation;
  const script = settings.kanaScript;
  const scope = settings.scope;
  const texts = batch.map((text) => text.nodeValue ?? '');
  let response: AnnotateResponse;
  try {
    response = await request(texts, script, scope);
  } catch {
    if (currentGeneration === generation && pageActive()) retry(batch);
    return;
  }
  if (currentGeneration !== generation || !pageActive()) return;
  if (response.error || response.pieces.length !== batch.length) {
    retry(batch);
    return;
  }
  for (let index = 0; index < batch.length; index++) {
    const text = batch[index];
    if (currentGeneration !== generation || !text.isConnected || text.nodeValue !== texts[index]) continue;
    const pieces = response.pieces[index] ?? [];
    if (!pieces.some((piece) => piece.kind === 'ruby')) continue;
    try {
      wrap(text, pieces);
    } catch {
      // Keep the original text node if a page constraint rejects the ruby.
    }
  }
}

function needsWork(): boolean {
  return scanQueue.length > 0 || queue.length > 0;
}

async function pump(): Promise<void> {
  if (pumping || !pageActive()) return;
  pumping = true;
  try {
    const started = performance.now();
    let scanned = 0;
    while (scanQueue.length && scanned < 30 && performance.now() - started < 8) {
      const root = scanQueue.shift();
      if (root) scan(root);
      scanned++;
    }
    const batch = takeBatch();
    if (batch.length) await annotateBatch(batch);
  } finally {
    pumping = false;
    if (pageActive() && needsWork()) schedule();
  }
}

function schedule(): void {
  if (!pageActive() || scheduled || pumping) return;
  scheduled = true;
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    scheduled = false;
    void pump();
  };
  const idle = window.requestIdleCallback?.bind(window);
  if (!idle) {
    window.setTimeout(start, 16);
    return;
  }
  const id = idle(() => start(), { timeout: 200 });
  // Hidden frames can delay idle callbacks indefinitely, so keep a short timer too.
  window.setTimeout(() => {
    if (started) return;
    window.cancelIdleCallback(id);
    start();
  }, 250);
}

function pageActive(value: Settings = settings): boolean {
  return value.enabled && !value.disabledHosts.includes(location.hostname);
}

function applyAppearance(value: Settings): void {
  const root = document.documentElement;
  root.style.setProperty('--jkh-size', `${value.fontSize / 100}em`);
  root.style.setProperty('--jkh-opacity', String(value.opacity / 100));
  root.dataset.jkhMode = value.mode;
  root.dataset.jkhScope = value.scope;
  root.dataset.jkhColor = value.color;
}

function reportBadge(): void {
  chrome.runtime.sendMessage({ type: 'badge', active: pageActive() }, () => {
    void chrome.runtime.lastError;
  });
}

function applySettings(next: Settings): void {
  const wasActive = pageActive();
  const willBeActive = pageActive(next);
  const rescan =
    wasActive !== willBeActive ||
    (willBeActive &&
      (settings.kanaScript !== next.kanaScript ||
        settings.scope !== next.scope ||
        settings.skipCode !== next.skipCode));
  settings = next;
  applyAppearance(next);
  reportBadge();
  if (!rescan) return;
  generation++;
  clearQueue();
  unwrapAll();
  if (!pageActive()) {
    disconnectPort();
    stopObserving();
    return;
  }
  resetIntersection();
  ensureObserving();
  if (document.body) scan(document.body);
  for (const root of shadowRoots) {
    if (root.isConnected) scan(root);
  }
  schedule();
}

function onStorage(changes: Record<string, chrome.storage.StorageChange>, area: string): void {
  if (area !== 'local') return;
  const watched = ['enabled', 'kanaScript', 'fontSize', 'mode', 'scope', 'color', 'opacity', 'skipCode', 'disabledHosts'];
  if (!watched.some((key) => key in changes)) return;
  const patch: Partial<Settings> = {};
  if ('enabled' in changes) patch.enabled = changes.enabled.newValue as Settings['enabled'];
  if ('kanaScript' in changes) patch.kanaScript = changes.kanaScript.newValue as Settings['kanaScript'];
  if ('fontSize' in changes) patch.fontSize = changes.fontSize.newValue as Settings['fontSize'];
  if ('mode' in changes) patch.mode = changes.mode.newValue as Settings['mode'];
  if ('scope' in changes) patch.scope = changes.scope.newValue as Settings['scope'];
  if ('color' in changes) patch.color = changes.color.newValue as Settings['color'];
  if ('opacity' in changes) patch.opacity = changes.opacity.newValue as Settings['opacity'];
  if ('skipCode' in changes) patch.skipCode = changes.skipCode.newValue as Settings['skipCode'];
  if ('disabledHosts' in changes) patch.disabledHosts = changes.disabledHosts.newValue as Settings['disabledHosts'];
  applySettings(normalizeSettings({ ...settings, ...patch }));
}

async function start(): Promise<void> {
  if (!document.documentElement || document.documentElement.namespaceURI === 'http://www.w3.org/2000/svg') return;
  settings = normalizeSettings(await chrome.storage.local.get(DEFAULT_SETTINGS));
  applyAppearance(settings);
  reportBadge();
  document.addEventListener('copy', (event) => {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !event.clipboardData) return;
    const fragment = selection.getRangeAt(0).cloneContents();
    if (!fragment.querySelector('.jkh-unit')) return;
    fragment.querySelectorAll('.jkh-read').forEach((node) => node.remove());
    event.preventDefault();
    event.clipboardData.setData('text/plain', fragment.textContent ?? '');
  });
  chrome.storage.onChanged.addListener(onStorage);
  if (!pageActive() || !document.body) return;
  ensureObserving();
  scan(document.body);
  schedule();
}

void start();
