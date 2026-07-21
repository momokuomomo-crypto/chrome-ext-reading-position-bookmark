import { describe, expect, it, vi } from "vitest";
import chrome from "sinon-chrome";

// Chrome拡張のマッチパターンはポート番号を表現できないため、
// registerContentScriptsは同一ホスト名の別ポートにも注入され得る
// （監査で発見）。content scriptがGET_ORIGIN_STATUSで自己チェックし、
// 実際には有効化されていないオリジンでは監視を開始しないことを検証する。

async function loadContentFresh(): Promise<void> {
  vi.resetModules();
  await import("../../src/content/index");
  // init()内の`await chrome.runtime.sendMessage(...)`が解決するまで待つ。
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("content: オリジン自己チェック（監査で発見：ポート違いへの誤注入対策）", () => {
  it("GET_ORIGIN_STATUSがenabled:falseを返す場合、監視を一切開始しない", async () => {
    chrome.runtime.sendMessage.resolves({ enabled: false });

    await loadContentFresh();

    expect(chrome.runtime.onMessage.addListener.called).toBe(false);
  });

  it("GET_ORIGIN_STATUSが失敗した場合も、監視を開始しない（安全側に倒す）", async () => {
    chrome.runtime.sendMessage.rejects(new Error("no receiver"));

    await loadContentFresh();

    expect(chrome.runtime.onMessage.addListener.called).toBe(false);
  });

  it("GET_ORIGIN_STATUSがenabled:trueを返す場合、監視を開始する", async () => {
    chrome.runtime.sendMessage.resolves({ enabled: true });

    await loadContentFresh();

    expect(chrome.runtime.onMessage.addListener.called).toBe(true);
    expect(
      chrome.runtime.sendMessage.calledWith({
        type: "GET_ORIGIN_STATUS",
        origin: "http://localhost:3000",
      }),
    ).toBe(true);
  });
});
