import { afterEach, describe, expect, it } from "vitest";
import { generateSelector, looksLikeStableAttributeValue } from "../../src/shared/selector";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("looksLikeStableAttributeValue", () => {
  it("短い・意味のある値は安定とみなす", () => {
    expect(looksLikeStableAttributeValue("main-title")).toBe(true);
    expect(looksLikeStableAttributeValue("article")).toBe(true);
  });

  it("ハッシュらしき10文字以上の16進文字列は不安定とみなす", () => {
    expect(looksLikeStableAttributeValue("a1b2c3d4e5f6")).toBe(false);
  });

  it("空文字は不安定とみなす", () => {
    expect(looksLikeStableAttributeValue("")).toBe(false);
  });
});

describe("generateSelector", () => {
  it("一意なidがあればid selectorを返す", () => {
    document.body.innerHTML = `<p id="intro">text</p>`;
    const el = document.getElementById("intro") as Element;
    expect(generateSelector(el)).toBe("#intro");
  });

  it("ハッシュらしきidは使わずdata-testidを優先する", () => {
    document.body.innerHTML = `<p id="a1b2c3d4e5" data-testid="article-body">text</p>`;
    const el = document.querySelector("p") as Element;
    expect(generateSelector(el)).toBe('[data-testid="article-body"]');
  });

  it("安定した属性が無ければタグ名+nth-of-typeで生成する", () => {
    document.body.innerHTML = `<div><p>a</p><p>b</p></div>`;
    const el = document.querySelectorAll("p")[1] as Element;
    const selector = generateSelector(el);
    expect(document.querySelector(selector)).toBe(el);
  });
});
