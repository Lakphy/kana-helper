const YOON = new Set([...'ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ']);

/** Group kana into morae: youon, chōon, and a leading っ stay with the syllable they belong to. */
export function morae(text: string): string[] {
  const chars = [...text];
  const out: string[] = [];
  let index = 0;
  while (index < chars.length) {
    let chunk = '';
    if ((chars[index] === 'っ' || chars[index] === 'ッ') && index + 1 < chars.length) {
      chunk += chars[index++];
    }
    if (index >= chars.length) {
      if (chunk) out.push(chunk);
      break;
    }
    chunk += chars[index++];
    if (index < chars.length && YOON.has(chars[index])) chunk += chars[index++];
    if (index < chars.length && chars[index] === 'ー') chunk += chars[index++];
    out.push(chunk);
  }
  return out;
}

/** Pair surface morae with spoken morae when they line up one to one. */
export function alignMorae(surface: string, spoken: string): { base: string; spoken: string }[] | null {
  const bases = morae(surface);
  const sounds = morae(spoken);
  if (bases.length === 0 || bases.length !== sounds.length) return null;
  return bases.map((base, index) => ({ base, spoken: sounds[index] }));
}
