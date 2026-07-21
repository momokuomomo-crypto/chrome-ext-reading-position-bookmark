const CONTENT_BLOCK_TAGS = new Set([
  "P",
  "LI",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "PRE",
  "BLOCKQUOTE",
  "FIGCAPTION",
]);

function isFixedOrSticky(el: Element): boolean {
  const position = getComputedStyle(el).position;
  return position === "fixed" || position === "sticky";
}

function hasFixedOrStickyAncestor(el: Element): boolean {
  let current: Element | null = el;
  while (current) {
    if (isFixedOrSticky(current)) return true;
    current = current.parentElement;
  }
  return false;
}

function findNearestContentBlock(el: Element): Element | null {
  let current: Element | null = el;
  while (current) {
    if (CONTENT_BLOCK_TAGS.has(current.tagName)) return current;
    current = current.parentElement;
  }
  return null;
}

// viewport上端から約80pxの地点でelementsFromPoint()を呼び、文章ブロックに
// 最も近い要素を選ぶ。固定/スティッキーヘッダー（またはその子孫）はすべて
// 除外する（Stage2で追加：固定/スティッキー要素が常にこの地点をヒットし
// 続け、アンカー方式そのものを機能不全にする問題への対処）。全候補が
// 除外対象だった場合はnullを返し、呼び出し側の比率/ピクセルフォールバック
// に委ねる（Stage5指摘で修正：除外前候補への復帰は固定/スティッキー要素を
// アンカーとして保存してしまい、除外ロジックの目的を損なうため廃止した）。
export function findAnchorElement(x: number, y: number, doc: Document = document): Element | null {
  const stack = doc.elementsFromPoint(x, y);
  if (stack.length === 0) return null;

  const candidates = stack.filter((el) => !hasFixedOrStickyAncestor(el));
  if (candidates.length === 0) return null;

  for (const el of candidates) {
    const block = findNearestContentBlock(el);
    if (block) return block;
  }
  return candidates[0] ?? null;
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function textFingerprintOf(el: Element): string {
  return normalizeText(el.textContent ?? "").slice(0, 120);
}
