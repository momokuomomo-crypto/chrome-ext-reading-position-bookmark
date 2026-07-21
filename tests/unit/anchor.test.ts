import { afterEach, describe, expect, it, vi } from "vitest";
import { findAnchorElement, normalizeText, textFingerprintOf } from "../../src/content/anchor";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// jsdomはdocument.elementsFromPoint()を実装していないため、テストごとに
// スタブ化する。
function stubElementsFromPoint(elements: Element[]): void {
  (document as unknown as { elementsFromPoint: (x: number, y: number) => Element[] }).elementsFromPoint = () =>
    elements;
}

describe("normalizeText・textFingerprintOf", () => {
  it("連続空白を単一空白へまとめ前後を除去する", () => {
    expect(normalizeText("  hello   world  \n")).toBe("hello world");
  });

  it("先頭最大120文字を指紋とする", () => {
    document.body.innerHTML = `<p>${"あ".repeat(200)}</p>`;
    const p = document.querySelector("p") as Element;
    expect(textFingerprintOf(p)).toHaveLength(120);
  });
});

describe("findAnchorElement：固定/スティッキーヘッダーの除外", () => {
  it("固定ヘッダー要素を除外し、後続の文章ブロックを選ぶ", () => {
    document.body.innerHTML = `
      <header id="fixed-header" style="position: fixed;">サイトヘッダー</header>
      <p id="content">本文です</p>
    `;
    const header = document.getElementById("fixed-header") as Element;
    const content = document.getElementById("content") as Element;
    stubElementsFromPoint([header, content]);

    const result = findAnchorElement(100, 80);
    expect(result).toBe(content);
  });

  it("スティッキー要素の子孫も除外する", () => {
    document.body.innerHTML = `
      <div id="sticky-bar" style="position: sticky;">
        <span id="sticky-child">進捗</span>
      </div>
      <p id="content">本文です</p>
    `;
    const stickyChild = document.getElementById("sticky-child") as Element;
    const content = document.getElementById("content") as Element;
    stubElementsFromPoint([stickyChild, content]);

    const result = findAnchorElement(100, 80);
    expect(result).toBe(content);
  });

  it("全候補が固定/スティッキーの場合はnullを返し比率/ピクセルフォールバックに委ねる", () => {
    document.body.innerHTML = `<header id="fixed-header" style="position: fixed;">ヘッダー</header>`;
    const header = document.getElementById("fixed-header") as Element;
    stubElementsFromPoint([header]);

    const result = findAnchorElement(100, 80);
    expect(result).toBeNull();
  });

  it("固定/スティッキーでない要素はそのまま候補にする", () => {
    document.body.innerHTML = `<p id="content">本文です</p>`;
    const content = document.getElementById("content") as Element;
    stubElementsFromPoint([content]);

    const result = findAnchorElement(100, 80);
    expect(result).toBe(content);
  });

  it("候補が無ければnullを返す", () => {
    stubElementsFromPoint([]);
    expect(findAnchorElement(100, 80)).toBeNull();
  });
});
