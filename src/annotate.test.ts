import { fileURLToPath } from 'node:url';
import { TokenizerBuilder, type Tokenizer } from '@patdx/kuromoji';
import NodeDictionaryLoader from '@patdx/kuromoji/node';
import { beforeAll, describe, expect, it } from 'vitest';
import { annotateText, annotateTokens, type ReadingToken } from './annotate';
import type { AnnotationScope, KanaScript } from './settings';
import type { Piece } from './types';

let tokenizer: Tokenizer;

beforeAll(async () => {
  const dicPath = fileURLToPath(new URL('../node_modules/@patdx/kuromoji/dict/', import.meta.url));
  tokenizer = await new TokenizerBuilder({
    loader: new NodeDictionaryLoader({ dic_path: dicPath }),
  }).build();
});

function run(
  text: string,
  script: KanaScript = 'hiragana',
  scope: AnnotationScope = 'all',
  skipChinese = true,
): Piece[] {
  return annotateText(text, script, (value) => tokenizer.tokenize(value), scope, skipChinese);
}

function flat(pieces: Piece[]): string {
  return pieces.map((piece) => (piece.kind === 'text' ? piece.text : piece.base)).join('');
}

function rubies(pieces: Piece[]): Array<{ base: string; romaji: string; kana?: string; columns?: { kana: string; romaji: string }[] }> {
  return pieces
    .filter((piece): piece is Extract<Piece, { kind: 'ruby' }> => piece.kind === 'ruby')
    .map(({ base, romaji, kana, columns }) => {
      const item: { base: string; romaji: string; kana?: string; columns?: { kana: string; romaji: string }[] } = { base, romaji };
      if (kana) item.kana = kana;
      if (columns && columns.length > 1) item.columns = columns;
      return item;
    });
}

describe('annotateTokens', () => {
  it('keeps the original text when readings are unknown', () => {
    const tokens: ReadingToken[] = [{ surface_form: '漢字', reading: '*', pronunciation: '*' }];
    expect(annotateTokens(tokens, 'hiragana', '漢字')).toEqual([{ kind: 'text', text: '漢字' }]);
  });

  it('refuses to drop or duplicate characters', () => {
    expect(annotateTokens([{ surface_form: 'あ' }], 'hiragana', 'あい')).toEqual([{ kind: 'text', text: 'あい' }]);
  });

  it('reads the topic particle as wa and the object particle as o', () => {
    expect(
      rubies(
        annotateTokens(
          [{ surface_form: 'は', pos: '助詞', reading: 'ハ', pronunciation: 'ワ' }],
          'hiragana',
          'は',
        ),
      ),
    ).toEqual([{ base: 'は', romaji: 'wa' }]);
    expect(
      rubies(
        annotateTokens(
          [{ surface_form: 'を', pos: '助詞', reading: 'ヲ', pronunciation: 'ヲ' }],
          'hiragana',
          'を',
        ),
      ),
    ).toEqual([{ base: 'を', romaji: 'o' }]);
  });
});

describe('kuromoji readings', () => {
  const samples = [
    '東京に行きます',
    '食べ物を食べた',
    '今日はいい天気です',
    'コンピューター',
    'すもももももももものうち',
    '私は学生です',
    'コーヒーをください',
    '取り上げる',
    '映画を見ました',
    'Hello 世界 123',
    'カタカナとひらがな',
    '行きました',
    '勉強しています',
    'お姉さん',
    '一日',
    '漢字',
    'では',
    '東京スカイツリー',
    'よろしくお願いします',
    '彼は本を読んでいる',
    '小さい犬',
    '三日月',
    '行ってきました',
    '学校へ行く',
    '申し込み',
    'Hello\n私は学生です。\nコーヒーをください。',
  ];

  it('reconstructs every sample exactly', () => {
    for (const sample of samples) {
      expect(flat(run(sample)), sample).toBe(sample);
      expect(flat(run(sample, 'katakana')), sample).toBe(sample);
    }
  });

  it('leaves Chinese prose alone and still reads Japanese kanji', () => {
    expect(rubies(run('我是中国人。今天天气很好'))).toEqual([]);
    expect(rubies(run('这是一个中文句子'))).toEqual([]);
    expect(rubies(run('汉字'))).toEqual([]);
    expect(rubies(run('東京')).length).toBeGreaterThan(0);
    expect(rubies(run('電光石火')).length).toBeGreaterThan(0);
    expect(rubies(run('中国の首都は東京です')).some((item) => item.base.includes('東'))).toBe(true);
    expect(rubies(run('我是中国人', 'hiragana', 'all', false)).length).toBeGreaterThan(0);
  });

  it('puts kana above kanji and romaji on every Japanese piece', () => {
    expect(rubies(run('漢字'))).toEqual([
      {
        base: '漢',
        romaji: 'kan',
        kana: 'かん',
        columns: [
          { kana: 'か', romaji: 'ka' },
          { kana: 'ん', romaji: 'n' },
        ],
      },
      { base: '字', romaji: 'ji', kana: 'じ' },
    ]);
    expect(rubies(run('漢字', 'katakana'))).toEqual([
      {
        base: '漢',
        romaji: 'kan',
        kana: 'カン',
        columns: [
          { kana: 'カ', romaji: 'ka' },
          { kana: 'ン', romaji: 'n' },
        ],
      },
      { base: '字', romaji: 'ji', kana: 'ジ' },
    ]);
    expect(rubies(run('食べ物'))).toEqual([
      { base: '食', romaji: 'ta', kana: 'た' },
      { base: 'べ', romaji: 'be' },
      {
        base: '物',
        romaji: 'mono',
        kana: 'もの',
        columns: [
          { kana: 'も', romaji: 'mo' },
          { kana: 'の', romaji: 'no' },
        ],
      },
    ]);
    expect(rubies(run('私は学生です'))).toEqual([
      {
        base: '私',
        romaji: 'watashi',
        kana: 'わたし',
        columns: [
          { kana: 'わ', romaji: 'wa' },
          { kana: 'た', romaji: 'ta' },
          { kana: 'し', romaji: 'shi' },
        ],
      },
      { base: 'は', romaji: 'wa' },
      {
        base: '学',
        romaji: 'gaku',
        kana: 'がく',
        columns: [
          { kana: 'が', romaji: 'ga' },
          { kana: 'く', romaji: 'ku' },
        ],
      },
      {
        base: '生',
        romaji: 'sei',
        kana: 'せい',
        columns: [
          { kana: 'せ', romaji: 'se' },
          { kana: 'い', romaji: 'i' },
        ],
      },
      { base: 'で', romaji: 'de' },
      { base: 'す', romaji: 'su' },
    ]);
    expect(rubies(run('今日はいい天気です'))).toEqual([
      {
        base: '今日',
        romaji: 'kyou',
        kana: 'きょう',
        columns: [
          { kana: 'きょ', romaji: 'kyo' },
          { kana: 'う', romaji: 'u' },
        ],
      },
      { base: 'は', romaji: 'wa' },
      { base: 'い', romaji: 'i' },
      { base: 'い', romaji: 'i' },
      {
        base: '天',
        romaji: 'ten',
        kana: 'てん',
        columns: [
          { kana: 'て', romaji: 'te' },
          { kana: 'ん', romaji: 'n' },
        ],
      },
      { base: '気', romaji: 'ki', kana: 'き' },
      { base: 'で', romaji: 'de' },
      { base: 'す', romaji: 'su' },
    ]);
    expect(rubies(run('行ってきました'))).toEqual([
      { base: '行', romaji: 'i', kana: 'い' },
      { base: 'って', romaji: 'tte' },
      { base: 'き', romaji: 'ki' },
      { base: 'ま', romaji: 'ma' },
      { base: 'し', romaji: 'shi' },
      { base: 'た', romaji: 'ta' },
    ]);
    expect(rubies(run('学校へ行く'))).toEqual([
      { base: '学', romaji: 'ga', kana: 'がっ' },
      {
        base: '校',
        romaji: 'kkou',
        kana: 'こう',
        columns: [
          { kana: 'こ', romaji: 'kko' },
          { kana: 'う', romaji: 'u' },
        ],
      },
      { base: 'へ', romaji: 'e' },
      { base: '行', romaji: 'i', kana: 'い' },
      { base: 'く', romaji: 'ku' },
    ]);
    expect(rubies(run('では'))).toEqual([
      { base: 'で', romaji: 'de' },
      { base: 'は', romaji: 'wa' },
    ]);
    expect(rubies(run('コンピューター'))).toEqual([
      { base: 'コ', romaji: 'ko' },
      { base: 'ン', romaji: 'n' },
      { base: 'ピュー', romaji: 'pyuu' },
      { base: 'ター', romaji: 'taa' },
    ]);
    expect(rubies(run('Hello 世界 123'))).toEqual([
      { base: '世', romaji: 'se', kana: 'せ' },
      {
        base: '界',
        romaji: 'kai',
        kana: 'かい',
        columns: [
          { kana: 'か', romaji: 'ka' },
          { kana: 'い', romaji: 'i' },
        ],
      },
    ]);
    expect(run('Hello, world')).toEqual([{ kind: 'text', text: 'Hello, world' }]);
    expect(rubies(run('私は学生です', 'hiragana', 'kanji')).map((item) => item.base)).toEqual(['私', '学', '生']);
  });

  it('keeps every ruby readable', () => {
    for (const sample of samples) {
      for (const piece of run(sample)) {
        if (piece.kind !== 'ruby') continue;
        expect(piece.romaji, sample).toMatch(/[A-Za-z]/);
        expect(piece.base.length, sample).toBeGreaterThan(0);
        if (piece.kana) expect(piece.kana, sample).not.toMatch(/[A-Za-z\u4e00-\u9fff]/);
      }
    }
  });
});
