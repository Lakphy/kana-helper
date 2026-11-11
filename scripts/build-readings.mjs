import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { TokenizerBuilder } from '@patdx/kuromoji';
import NodeDictionaryLoader from '@patdx/kuromoji/node';
import { toHiragana } from 'wanakana';

const dic = fileURLToPath(new URL('../node_modules/@patdx/kuromoji/dict/', import.meta.url));
const out = fileURLToPath(new URL('../src/kanji-readings.json', import.meta.url));
const tokenizer = await new TokenizerBuilder({ loader: new NodeDictionaryLoader({ dic_path: dic }) }).build();

const isKanji = (ch) => {
  const code = ch.codePointAt(0) ?? 0;
  return (code >= 0x4e00 && code <= 0x9fff) || code === 0x3005 || code === 0x3006;
};
const isKana = (ch) => {
  const code = ch.codePointAt(0) ?? 0;
  return code >= 0x3041 && code <= 0x3096;
};
const kanaOnly = (text) => text.length > 0 && [...text].every(isKana);

const RENDAKU = {
  か: 'が', き: 'ぎ', く: 'ぐ', け: 'げ', こ: 'ご',
  さ: 'ざ', し: 'じ', す: 'ず', せ: 'ぜ', そ: 'ぞ',
  た: 'だ', ち: 'ぢ', つ: 'づ', て: 'で', と: 'ど',
  は: 'ば', ひ: 'び', ふ: 'ぶ', へ: 'べ', ほ: 'ぼ',
};
const HANDAKU = { は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ' };

function variants(reading, allowRendaku) {
  const forms = new Set([reading]);
  const chars = [...reading];
  const last = chars[chars.length - 1];
  if (last === 'く' || last === 'つ' || last === 'ち' || last === 'き') {
    forms.add(`${chars.slice(0, -1).join('')}っ`);
  }
  if (allowRendaku && chars.length > 0) {
    const rest = chars.slice(1).join('');
    if (RENDAKU[chars[0]]) forms.add(RENDAKU[chars[0]] + rest);
    if (HANDAKU[chars[0]]) forms.add(HANDAKU[chars[0]] + rest);
  }
  return [...forms].filter(kanaOnly);
}

const seeds = new Map();
const compounds = [];
for (const ids of Object.values(tokenizer.token_info_dictionary.target_map)) {
  for (const id of ids) {
    const line = tokenizer.token_info_dictionary.getFeatures(String(id));
    if (!line) continue;
    const parts = line.split(',');
    const chars = [...parts[0]];
    if (chars.length === 0 || chars.length > 4 || !chars.every(isKanji)) continue;
    const raw = parts[9] && parts[9] !== '*' ? parts[9] : parts[8];
    if (!raw || raw === '*') continue;
    const reading = toHiragana(raw);
    if (!kanaOnly(reading)) continue;
    if (chars.length === 1) {
      let set = seeds.get(chars[0]);
      if (!set) seeds.set(chars[0], (set = new Set()));
      set.add(reading);
    } else {
      compounds.push([chars, reading]);
    }
  }
}

function covers(chars, reading, gap) {
  const target = [...reading];
  const width = chars.length;
  const height = target.length;
  const ok = Array.from({ length: width + 1 }, () => Array(height + 1).fill(false));
  const gapText = Array.from({ length: width + 1 }, () => Array(height + 1).fill(''));
  ok[0][0] = true;
  for (let i = 0; i < width; i++) {
    for (let j = 0; j <= height; j++) {
      if (!ok[i][j]) continue;
      if (i === gap) {
        for (let length = 1; length <= 6 && j + length <= height; length++) {
          const next = j + length;
          if (ok[i + 1][next]) continue;
          ok[i + 1][next] = true;
          gapText[i + 1][next] = target.slice(j, next).join('');
        }
        continue;
      }
      const options = seeds.get(chars[i]);
      if (!options) continue;
      for (const base of options) {
        for (const form of variants(base, i > 0)) {
          const piece = [...form];
          if (j + piece.length > height) continue;
          let matched = true;
          for (let k = 0; k < piece.length; k++) {
            if (target[j + k] !== piece[k]) {
              matched = false;
              break;
            }
          }
          if (!matched || form.length < 2 || ok[i + 1][j + piece.length]) continue;
          ok[i + 1][j + piece.length] = true;
          gapText[i + 1][j + piece.length] = gapText[i][j];
        }
      }
    }
  }
  if (!ok[width][height]) return null;
  if (gap < 0) return true;
  return gapText[width][height] || null;
}

const learned = new Map();
function learn(ch, reading) {
  if (!kanaOnly(reading) || reading.length > 6) return;
  if (seeds.get(ch)?.has(reading)) return;
  const key = `${ch}\t${reading}`;
  learned.set(key, (learned.get(key) ?? 0) + 1);
}

for (const [chars, reading] of compounds) {
  if (covers(chars, reading, -1)) continue;
  const found = new Map();
  for (let gap = 0; gap < chars.length; gap++) {
    const piece = covers(chars, reading, gap);
    if (!piece) continue;
    const list = found.get(chars[gap]) ?? [];
    list.push(piece);
    found.set(chars[gap], list);
  }
  if (found.size !== 1) continue;
  const [ch, pieces] = [...found.entries()][0];
  if (new Set(pieces).size !== 1) continue;
  learn(ch, pieces[0]);
}

const kept = new Map();
for (const [key, count] of learned) {
  if (count < 2) continue;
  const [ch, reading] = key.split('\t');
  const ownSeeds = seeds.get(ch);
    if (ownSeeds) {
      const fold = (text) => text.replaceAll('づ', 'ず').replaceAll('ぢ', 'じ');
      const folded = fold(reading);
      let derived = false;
      for (const base of ownSeeds) {
        if (variants(base, true).some((form) => fold(form) === folded)) {
          derived = true;
          break;
        }
      }
      if (derived) continue;
    }
  let set = kept.get(ch);
  if (!set) kept.set(ch, (set = new Set()));
  set.add(reading);
}

const table = {};
const chars = new Set([...seeds.keys(), ...kept.keys()]);
for (const ch of [...chars].sort()) {
  const values = [...new Set([...(seeds.get(ch) ?? []), ...(kept.get(ch) ?? [])])]
    .filter(kanaOnly)
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  if (values.length) table[ch] = values;
}

await writeFile(out, `${JSON.stringify(table)}\n`);

const sample = ['東京', '学生', '漢字', '今日', '天気', '学校', '三日月', '世界', '勉強', '映画', '新聞', '図書館', '日本', '明日', '大人', '私'];
console.log('kanji', Object.keys(table).length, 'bytes', JSON.stringify(table).length);
for (const word of sample) {
  const token = tokenizer.tokenize(word)[0];
  const reading = toHiragana(token.pronunciation && token.pronunciation !== '*' ? token.pronunciation : token.reading);
  console.log(word, token.surface_form, reading);
}
