import { JAPANESE_KANJI } from './japanese-kanji';

const KANA = /[\u3041-\u3096\u309d\u309e\u30a1-\u30fa\u30fc-\u30fe\uff66-\uff9d]/;
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const JAPANESE = /[\u3040-\u30ff\uff66-\uff9d\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3005\u3006\u303b]/;
const MARKS = new Set(['々', '〆', '〻']);

export function hasKana(text: string): boolean {
  return KANA.test(text);
}

export function hasJapanese(text: string): boolean {
  return JAPANESE.test(text);
}

function isHan(ch: string): boolean {
  return HAN.test(ch);
}

/** A kana-less block that uses characters or grammar Japanese text does not. */
export function blockLooksChinese(text: string): boolean {
  if (!text || hasKana(text)) return false;
  for (const ch of text) {
    if (!isHan(ch) || MARKS.has(ch)) continue;
    if (!JAPANESE_KANJI.has(ch)) return true;
  }
  return /[\u4e00-\u9fff]是[\u4e00-\u9fff]/.test(text);
}
