import readings from './kanji-readings.json';

const TABLE = readings as Record<string, readonly string[]>;

const RENDAKU: Record<string, string> = {
  か: 'が', き: 'ぎ', く: 'ぐ', け: 'げ', こ: 'ご',
  さ: 'ざ', し: 'じ', す: 'ず', せ: 'ぜ', そ: 'ぞ',
  た: 'だ', ち: 'ぢ', つ: 'づ', て: 'で', と: 'ど',
  は: 'ば', ひ: 'び', ふ: 'ぶ', へ: 'べ', ほ: 'ぼ',
};

const HANDAKU: Record<string, string> = {
  は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ',
};

function variants(reading: string, allowRendaku: boolean): string[] {
  const forms = new Set<string>([reading]);
  const chars = [...reading];
  const last = chars[chars.length - 1];
  if (last === 'く' || last === 'つ' || last === 'ち' || last === 'き') {
    forms.add(`${chars.slice(0, -1).join('')}っ`);
  }
  if (allowRendaku && chars.length > 0) {
    const rest = chars.slice(1).join('');
    const voiced = RENDAKU[chars[0]];
    const halfVoiced = HANDAKU[chars[0]];
    if (voiced) forms.add(voiced + rest);
    if (halfVoiced) forms.add(halfVoiced + rest);
  }
  return [...forms];
}

type Choice = { from: number; text: string; score: number };

/** Split a kanji run's hiragana reading into one reading per character. */
export function splitKanjiReading(chars: string[], reading: string): string[] | null {
  if (chars.length < 2) return null;
  const target = [...reading];
  const width = chars.length;
  const height = target.length;
  const best: Array<Array<Choice | null>> = Array.from({ length: width + 1 }, () => Array(height + 1).fill(null));
  best[0][0] = { from: 0, text: '', score: 0 };

  for (let index = 0; index < width; index++) {
    const options = TABLE[chars[index]];
    if (!options) continue;
    const listed = new Set(options);
    for (let cursor = 0; cursor <= height; cursor++) {
      const state = best[index][cursor];
      if (!state) continue;
      for (const base of options) {
        for (const form of variants(base, index > 0)) {
          const piece = [...form];
          const next = cursor + piece.length;
          if (next > height) continue;
          let matched = true;
          for (let offset = 0; offset < piece.length; offset++) {
            if (target[cursor + offset] !== piece[offset]) {
              matched = false;
              break;
            }
          }
          if (!matched) continue;
          const score = state.score + piece.length + (listed.has(form) ? 5 : 0);
          const current = best[index + 1][next];
          if (current && current.score >= score) continue;
          best[index + 1][next] = { from: cursor, text: form, score };
        }
      }
    }
  }

  const end = best[width][height];
  if (!end) return null;
  const parts: string[] = [];
  let index = width;
  let cursor = height;
  while (index > 0) {
    const choice = best[index][cursor];
    if (!choice) return null;
    parts.push(choice.text);
    cursor = choice.from;
    index--;
  }
  parts.reverse();
  return parts.join('') === reading ? parts : null;
}
