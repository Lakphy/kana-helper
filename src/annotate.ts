import { toHiragana, toKatakana, toRomaji } from 'wanakana';
import { splitKanjiReading } from './kanji-split';
import { alignMorae, morae } from './mora';
import type { AnnotationScope, KanaScript } from './settings';
import { blockLooksChinese, hasJapanese, hasKana } from './text';
import type { AnnotationColumn, Piece } from './types';

export type ReadingToken = {
  surface_form: string;
  pos?: string;
  reading?: string;
  pronunciation?: string;
  word_type?: string;
};

type Draft =
  | { kind: 'text'; text: string }
  | {
      kind: 'ruby';
      base: string;
      romaji: string;
      spoken: string;
      kana?: string;
      columns?: AnnotationColumn[];
    };

const CHUNK = 1600;
const CHINESE_TOKEN = new Set(['是', '的', '了', '在', '都', '不', '没', '但', '与', '或', '被', '把', '就', '而', '你', '他', '她']);

function isKanjiChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x20000 && code <= 0x3ffff) ||
    code === 0x3005 ||
    code === 0x3006 ||
    code === 0x303b
  );
}

function isKanaChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x3041 && code <= 0x3096) ||
    (code >= 0x309d && code <= 0x309e) ||
    (code >= 0x30a1 && code <= 0x30fa) ||
    (code >= 0x30fc && code <= 0x30fe) ||
    (code >= 0xff66 && code <= 0xff9d)
  );
}

function hasKanji(text: string): boolean {
  for (const ch of text) {
    if (isKanjiChar(ch)) return true;
  }
  return false;
}

function hasLatin(text: string): boolean {
  return /[A-Za-z]/.test(text);
}

function spokenHiragana(token: ReadingToken): string | null {
  const raw =
    token.pronunciation && token.pronunciation !== '*'
      ? token.pronunciation
      : token.reading && token.reading !== '*'
        ? token.reading
        : '';
  if (!raw) return null;
  const hira = toHiragana(raw);
  if (!hira || hasKanji(hira)) return null;
  return hira;
}

function formatKana(hira: string, script: KanaScript): string {
  return script === 'katakana' ? toKatakana(hira) : hira;
}

function pushText(out: Draft[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.kind === 'text') last.text += text;
  else out.push({ kind: 'text', text });
}

function pushKanji(out: Draft[], base: string, spoken: string, script: KanaScript): void {
  const chars = Array.from(base);
  if (chars.length > 1 && chars.every(isKanjiChar)) {
    const parts = splitKanjiReading(chars, spoken);
    if (parts && parts.length === chars.length) {
      for (let index = 0; index < chars.length; index++) {
        pushRuby(out, chars[index], parts[index], script, true);
      }
      return;
    }
  }
  pushRuby(out, base, spoken, script, true);
}

function moraColumns(spoken: string, script: KanaScript): AnnotationColumn[] {
  const parts = morae(spoken);
  return parts.map((mora, index) => {
    const previous = parts[index - 1] ?? '';
    let source = mora;
    if (previous.endsWith('っ')) source = `っ${mora}`;
    else if (mora.endsWith('っ') && index + 1 < parts.length) source = mora.slice(0, -1);
    const romaji = toRomaji(source);
    return { kana: formatKana(mora, script), romaji };
  });
}

function pushAlignedKana(out: Draft[], surface: string, spoken: string, script: KanaScript): void {
  const aligned = alignMorae(surface, spoken);
  const parts = aligned ?? morae(surface).map((base) => ({ base, spoken: toHiragana(base) }));
  if (parts.length <= 1) {
    emitRuby(out, surface, spoken, script, false);
    return;
  }
  for (const part of parts) emitRuby(out, part.base, part.spoken, script, false);
}

function emitRuby(out: Draft[], base: string, spoken: string, script: KanaScript, withKana: boolean): void {
  if (!base) return;
  if (base === 'っ' || base === 'ッ') {
    pushText(out, base);
    return;
  }
  const romaji = toRomaji(spoken);
  if (!hasLatin(romaji)) {
    pushText(out, base);
    return;
  }
  const draft: Draft = { kind: 'ruby', base, romaji, spoken };
  if (withKana && spoken) {
    draft.kana = formatKana(spoken, script);
    const columns = moraColumns(spoken, script).filter((column) => /[A-Za-z]/.test(column.romaji));
    if (columns.length > 1) draft.columns = columns;
  }
  out.push(draft);
}

function pushRuby(out: Draft[], base: string, spoken: string, script: KanaScript, withKana: boolean): void {
  if (!base) return;
  if (!withKana && [...base].length > 1) pushAlignedKana(out, base, spoken, script);
  else emitRuby(out, base, spoken, script, withKana);
}

function indexOfChars(hay: string[], needle: string[], from: number): number {
  if (needle.length === 0) return -1;
  const last = hay.length - needle.length;
  for (let i = Math.max(0, from); i <= last; i++) {
    let matched = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }
  return -1;
}

function tryAlign(surface: string, spoken: string, script: KanaScript): Draft[] | null {
  const chars = Array.from(surface);
  const reading = Array.from(spoken);
  const out: Draft[] = [];
  let index = 0;
  let read = 0;

  while (index < chars.length) {
    if (isKanjiChar(chars[index])) {
      let end = index + 1;
      while (end < chars.length && isKanjiChar(chars[end])) end++;

      if (end >= chars.length) {
        const rest = reading.slice(read).join('');
        if (!rest) return null;
        pushKanji(out, chars.slice(index).join(''), rest, script);
        read = reading.length;
        index = chars.length;
        break;
      }

      if (!isKanaChar(chars[end])) {
        let onlyOther = true;
        for (let cursor = end; cursor < chars.length; cursor++) {
          if (isKanjiChar(chars[cursor]) || isKanaChar(chars[cursor])) {
            onlyOther = false;
            break;
          }
        }
        if (!onlyOther) return null;
        const rest = reading.slice(read).join('');
        if (!rest) return null;
        pushKanji(out, chars.slice(index, end).join(''), rest, script);
        pushText(out, chars.slice(end).join(''));
        read = reading.length;
        index = chars.length;
        break;
      }

      let kanaEnd = end;
      while (kanaEnd < chars.length && isKanaChar(chars[kanaEnd])) kanaEnd++;
      const needle = Array.from(toHiragana(chars.slice(end, kanaEnd).join('')));
      const found = indexOfChars(reading.slice(read), needle, 1);
      if (found < 0) return null;
      const kanjiReading = reading.slice(read, read + found).join('');
      if (!kanjiReading) return null;
      pushKanji(out, chars.slice(index, end).join(''), kanjiReading, script);
      read += found;
      index = end;
      continue;
    }

    if (isKanaChar(chars[index])) {
      let end = index + 1;
      while (end < chars.length && isKanaChar(chars[end])) end++;
      const base = chars.slice(index, end).join('');
      const hira = toHiragana(base);
      const hiraChars = Array.from(hira);
      const slice = reading.slice(read, read + hiraChars.length).join('');
      if (slice !== hira) return null;
      read += hiraChars.length;
      pushRuby(out, base, hira, script, false);
      index = end;
      continue;
    }

    let end = index + 1;
    while (end < chars.length && !isKanjiChar(chars[end]) && !isKanaChar(chars[end])) end++;
    pushText(out, chars.slice(index, end).join(''));
    index = end;
  }

  if (read !== reading.length) return null;
  const built = out.map((piece) => (piece.kind === 'text' ? piece.text : piece.base)).join('');
  return built === surface ? out : null;
}

function kanaToken(
  surface: string,
  spoken: string,
  token: ReadingToken,
  script: KanaScript,
  scope: AnnotationScope,
): Draft[] {
  if (scope === 'kanji') return [{ kind: 'text', text: surface }];
  if (token.pos === '助詞' && (surface === 'を' || surface === 'ヲ' || spoken === 'を')) {
    return [{ kind: 'ruby', base: surface, romaji: 'o', spoken }];
  }
  const out: Draft[] = [];
  pushRuby(out, surface, spoken, script, false);
  return out.length > 0 ? out : [{ kind: 'text', text: surface }];
}

function coarse(
  surface: string,
  spoken: string,
  script: KanaScript,
  token: ReadingToken,
  scope: AnnotationScope,
): Draft[] {
  if (!hasKanji(surface)) return kanaToken(surface, spoken, token, script, scope);
  const out: Draft[] = [];
  pushKanji(out, surface, spoken, script);
  return out.length > 0 ? out : [{ kind: 'text', text: surface }];
}

function draftsForToken(token: ReadingToken, script: KanaScript, scope: AnnotationScope): Draft[] {
  const surface = token.surface_form ?? '';
  if (!surface) return [];
  if (!hasJapanese(surface)) return [{ kind: 'text', text: surface }];
  const spoken = spokenHiragana(token) ?? (hasKanji(surface) ? null : toHiragana(surface));
  if (!spoken) return [{ kind: 'text', text: surface }];
  if (!hasKanji(surface)) return kanaToken(surface, spoken, token, script, scope);
  return tryAlign(surface, spoken, script) ?? coarse(surface, spoken, script, token, scope);
}

function mergeSokuon(pieces: Draft[]): Draft[] {
  const out: Draft[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const current = pieces[i];
    const base = current.kind === 'text' ? current.text : current.base;
    const next = pieces[i + 1];
    if ((base === 'っ' || base === 'ッ') && next?.kind === 'ruby' && !next.kana) {
      const spoken = `っ${next.spoken}`;
      next.base = `${base}${next.base}`;
      next.spoken = spoken;
      next.romaji = toRomaji(spoken);
      continue;
    }
    out.push(current);
  }
  return out;
}

function adjustReadingSokuon(pieces: Draft[]): void {
  for (let index = 0; index < pieces.length - 1; index++) {
    const current = pieces[index];
    const next = pieces[index + 1];
    if (current.kind !== 'ruby' || next.kind !== 'ruby') continue;
    if (!current.spoken.endsWith('っ')) continue;
    if (current.base.endsWith('っ') || current.base.endsWith('ッ')) continue;
    const head = toRomaji(current.spoken.slice(0, -1));
    const tail = toRomaji(`っ${next.spoken}`);
    if (/[A-Za-z]/.test(head)) current.romaji = head;
    if (/[A-Za-z]/.test(tail)) next.romaji = tail;
    const last = current.columns?.[current.columns.length - 1];
    if (last && /[A-Za-z]/.test(head)) last.romaji = toRomaji(toHiragana(last.kana.replace(/っ$/, ''))) || head;
    const first = next.columns?.[0];
    if (first) {
      const doubled = toRomaji(`っ${toHiragana(first.kana)}`);
      if (/[A-Za-z]/.test(doubled)) first.romaji = doubled;
    }
  }
}

function publish(pieces: Draft[]): Piece[] {
  const out: Piece[] = [];
  for (const piece of pieces) {
    if (piece.kind === 'text') {
      if (!piece.text) continue;
      const last = out[out.length - 1];
      if (last?.kind === 'text') last.text += piece.text;
      else out.push({ kind: 'text', text: piece.text });
      continue;
    }
    const ruby: Piece = { kind: 'ruby', base: piece.base, romaji: piece.romaji };
    if (piece.kana) ruby.kana = piece.kana;
    if (piece.columns && piece.columns.length > 1) ruby.columns = piece.columns;
    out.push(ruby);
  }
  return out;
}

export function annotateTokens(
  tokens: ReadingToken[],
  script: KanaScript,
  original: string,
  scope: AnnotationScope = 'all',
): Piece[] {
  let built = '';
  const drafts: Draft[] = [];
  for (const token of tokens) {
    built += token.surface_form ?? '';
    drafts.push(...draftsForToken(token, script, scope));
  }
  if (built !== original) return [{ kind: 'text', text: original }];
  const merged = mergeSokuon(drafts);
  adjustReadingSokuon(merged);
  const pieces = publish(merged);
  const flat = pieces.map((piece) => (piece.kind === 'text' ? piece.text : piece.base)).join('');
  if (flat !== original) return [{ kind: 'text', text: original }];
  return pieces;
}

function splitChunk(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + max);
    if (end < text.length) {
      const window = text.slice(start, end);
      const breaks = ['\n', '。', '！', '？', '、', ' '];
      for (const mark of breaks) {
        const at = window.lastIndexOf(mark);
        if (at > max * 0.5) {
          end = start + at + mark.length;
          break;
        }
      }
    }
    parts.push(text.slice(start, end));
    if (end <= start) break;
    start = end;
  }
  return parts;
}

function looksChinese(text: string, tokens: ReadingToken[]): boolean {
  if (hasKana(text) || !hasKanji(text)) return false;
  if (blockLooksChinese(text)) return true;
  for (const token of tokens) {
    const surface = token.surface_form ?? '';
    if (!surface) continue;
    if (CHINESE_TOKEN.has(surface)) return true;
    if (token.word_type === 'UNKNOWN' && hasKanji(surface)) return true;
  }
  return false;
}

function annotateChunk(
  text: string,
  script: KanaScript,
  tokenize: (input: string) => ReadingToken[],
  scope: AnnotationScope,
  skipChinese: boolean,
): Piece[] {
  let tokens: ReadingToken[];
  try {
    tokens = tokenize(text);
  } catch {
    return [{ kind: 'text', text }];
  }
  if (skipChinese && looksChinese(text, tokens)) return [{ kind: 'text', text }];
  return annotateTokens(tokens, script, text, scope);
}

function concatPieces(groups: Piece[][]): Piece[] {
  const out: Piece[] = [];
  for (const group of groups) {
    for (const piece of group) {
      const last = out[out.length - 1];
      if (piece.kind === 'text' && last?.kind === 'text') last.text += piece.text;
      else out.push(piece);
    }
  }
  return out;
}

export function annotateText(
  text: string,
  script: KanaScript,
  tokenize: (input: string) => ReadingToken[],
  scope: AnnotationScope = 'all',
  skipChinese = true,
): Piece[] {
  if (!text) return [];
  if (!hasJapanese(text)) return [{ kind: 'text', text }];
  const parts = splitChunk(text, CHUNK);
  const groups = parts.map((part) => annotateChunk(part, script, tokenize, scope, skipChinese));
  const pieces = groups.length === 1 ? groups[0] : concatPieces(groups);
  const flat = pieces.map((piece) => (piece.kind === 'text' ? piece.text : piece.base)).join('');
  return flat === text ? pieces : [{ kind: 'text', text }];
}
