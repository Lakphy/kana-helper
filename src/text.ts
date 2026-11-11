const JAPANESE =
  /[\u3040-\u30ff\uff66-\uff9d\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3005\u3006\u303b]/;

export function hasJapanese(text: string): boolean {
  return JAPANESE.test(text);
}
