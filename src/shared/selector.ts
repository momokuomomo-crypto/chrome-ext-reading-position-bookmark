// ハッシュらしき文字列パターン（英数字混在10文字以上で意味のある単語を
// 含まないもの）を除外する（Stage2で具体化：React/styled-components等が
// 生成するハッシュ化class名・自動採番idを「安定」と誤判定しないため）。
const HASH_LIKE_PATTERN = /^[a-zA-Z0-9_-]{10,}$/;
const HAS_VOWEL_WORD_PATTERN = /[aeiouAEIOU]{1}[a-zA-Z]*[aeiouAEIOU]/;

export function looksLikeStableAttributeValue(value: string): boolean {
  if (value.length === 0) return false;
  if (!HASH_LIKE_PATTERN.test(value)) return true; // 短い・記号混じり等はハッシュ判定対象外
  // 英数字混在10文字以上でも、意味のある単語らしき母音パターンを含むなら安定とみなす
  return HAS_VOWEL_WORD_PATTERN.test(value) && !/^[0-9a-f]{10,}$/i.test(value);
}

const STABLE_DATA_ATTRIBUTES = ["data-testid", "data-qa", "data-test", "data-cy"];

export interface SelectorCandidate {
  element: Element;
}

// selectorは以下の優先順位で生成する（凍結設計どおり）：
// 1. 一意なid　2. 安定して見えるdata-*属性　3. 親子のタグ名+nth-of-type
export function generateSelector(element: Element, root: ParentNode = document): string {
  if (element.id && looksLikeStableAttributeValue(element.id)) {
    const idSelector = `#${CSS.escape(element.id)}`;
    if (root.querySelectorAll(idSelector).length === 1) {
      return idSelector;
    }
  }

  for (const attr of STABLE_DATA_ATTRIBUTES) {
    const value = element.getAttribute(attr);
    if (value && looksLikeStableAttributeValue(value)) {
      const attrSelector = `[${attr}="${CSS.escape(value)}"]`;
      if (root.querySelectorAll(attrSelector).length === 1) {
        return attrSelector;
      }
    }
  }

  return generatePathSelector(element, root);
}

const MAX_SELECTOR_DEPTH = 8;

function generatePathSelector(element: Element, root: ParentNode): string {
  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;

  while (current && current !== root && depth < MAX_SELECTOR_DEPTH) {
    const tagName = current.tagName;
    const tag = tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const siblingElements: Element[] = Array.from(parent.children);
    const siblings = siblingElements.filter((el: Element) => el.tagName === tagName);
    const index = siblings.indexOf(current) + 1;
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
    current = parent;
    depth += 1;
  }

  return parts.join(" > ");
}
