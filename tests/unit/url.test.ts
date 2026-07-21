import { describe, expect, it } from "vitest";
import { canonicalUrlOf, originOf } from "../../src/shared/url";

describe("canonicalUrlOf", () => {
  it("hashを除去しqueryを維持する", () => {
    expect(canonicalUrlOf("https://example.com/page?x=1#section")).toBe(
      "https://example.com/page?x=1",
    );
  });

  it("userinfoを除去する", () => {
    expect(canonicalUrlOf("https://user:pass@example.com/")).toBe("https://example.com/");
  });

  it("http/https以外はnullを返す", () => {
    expect(canonicalUrlOf("chrome://extensions")).toBeNull();
    expect(canonicalUrlOf("not a url")).toBeNull();
  });

  it("pathnameまたはqueryが変われば別URLになる", () => {
    expect(canonicalUrlOf("https://example.com/a")).not.toBe(canonicalUrlOf("https://example.com/b"));
    expect(canonicalUrlOf("https://example.com/?a=1")).not.toBe(canonicalUrlOf("https://example.com/?a=2"));
  });
});

describe("originOf", () => {
  it("スキーム＋ホスト＋ポートを返す", () => {
    expect(originOf("https://example.com:8443/page")).toBe("https://example.com:8443");
  });

  it("http/https以外はnullを返す", () => {
    expect(originOf("chrome://extensions")).toBeNull();
  });
});
