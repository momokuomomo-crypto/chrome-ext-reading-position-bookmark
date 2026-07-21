import { describe, expect, it } from "vitest";
import { isSimilarEnough, levenshteinDistance, similarityRatio } from "../../src/shared/similarity";

describe("levenshteinDistance", () => {
  it("完全一致は0", () => {
    expect(levenshteinDistance("abc", "abc")).toBe(0);
  });

  it("空文字列は他方の長さ", () => {
    expect(levenshteinDistance("", "abc")).toBe(3);
    expect(levenshteinDistance("abc", "")).toBe(3);
  });

  it("1文字違いは距離1", () => {
    expect(levenshteinDistance("abc", "abd")).toBe(1);
  });
});

describe("similarityRatio・isSimilarEnough", () => {
  it("完全一致は類似度1", () => {
    expect(similarityRatio("hello world", "hello world")).toBe(1);
  });

  it("わずかな変化は閾値0.85以上とみなす", () => {
    const a = "本日の技術記事についての詳細な説明文がここに入ります";
    const b = "本日の技術記事についての詳細な説明文がここに入ります。"; // 末尾に句点追加
    expect(isSimilarEnough(a, b)).toBe(true);
  });

  it("大きく異なるテキストは閾値未満", () => {
    expect(isSimilarEnough("こんにちは", "全く関係の無い別のテキストです")).toBe(false);
  });
});
