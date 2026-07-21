// 正規化Levenshtein距離による類似度判定（0〜1、1が完全一致）。
// テキスト指紋の「十分に近い」を具体的な閾値で判定するために使う
// （Stage2で具体化：閾値0.85以上を採用）。
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prevRow = new Array<number>(n + 1);
  let currRow = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prevRow[j] = j;

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        (prevRow[j] ?? 0) + 1,
        (currRow[j - 1] ?? 0) + 1,
        (prevRow[j - 1] ?? 0) + cost,
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }
  return prevRow[n] ?? 0;
}

export function similarityRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

export const SIMILARITY_THRESHOLD = 0.85;

export function isSimilarEnough(a: string, b: string): boolean {
  return similarityRatio(a, b) >= SIMILARITY_THRESHOLD;
}
