import { beforeEach, describe, expect, it, vi } from "vitest";
import chrome from "sinon-chrome";

function mountPopupDom(): void {
  document.body.innerHTML = `
    <p id="error" hidden></p>
    <p id="origin-display"></p>
    <p id="other-tabs-note" hidden></p>
    <button id="toggle-button">読み込み中...</button>
    <button id="delete-current-button">現在のURLの記録を削除</button>
    <button id="delete-all-button">保存データをすべて削除</button>
    <p id="message" hidden></p>
  `;
}

async function loadPopupFresh(): Promise<void> {
  vi.resetModules();
  mountPopupDom();
  await import("../../src/popup/popup");
  await flushMicrotasks();
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  chrome.runtime.sendMessage.resolves({ ok: true });
});

describe("popup: 初期表示", () => {
  it("http/httpsページではオリジンを表示しトグルボタンを有効にする", async () => {
    chrome.tabs.query.resolves([{ id: 1, url: "https://example.com/article" }]);
    chrome.runtime.sendMessage
      .withArgs({ type: "GET_ORIGIN_STATUS", origin: "https://example.com" })
      .resolves({ enabled: false });
    await loadPopupFresh();

    expect(document.getElementById("origin-display")?.textContent).toBe("https://example.com");
    expect((document.getElementById("toggle-button") as HTMLButtonElement).textContent).toBe(
      "このサイトを有効にする",
    );
  });

  it("有効化済みの場合はボタン文言が変わる", async () => {
    chrome.tabs.query.resolves([{ id: 1, url: "https://example.com/article" }]);
    chrome.runtime.sendMessage
      .withArgs({ type: "GET_ORIGIN_STATUS", origin: "https://example.com" })
      .resolves({ enabled: true });
    await loadPopupFresh();

    expect((document.getElementById("toggle-button") as HTMLButtonElement).textContent).toBe(
      "このサイトを無効にする",
    );
  });

  it("chrome://等のページではエラーを表示しボタンを無効化する", async () => {
    chrome.tabs.query.resolves([{ id: 1, url: "chrome://extensions" }]);
    await loadPopupFresh();

    const errorEl = document.getElementById("error") as HTMLElement;
    expect(errorEl.hidden).toBe(false);
    expect((document.getElementById("toggle-button") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("popup: 有効化・無効化", () => {
  it("トグルボタンはENABLE_ORIGINを送信しタブIDを含める", async () => {
    chrome.tabs.query.resolves([{ id: 5, url: "https://example.com/article" }]);
    chrome.runtime.sendMessage
      .withArgs({ type: "GET_ORIGIN_STATUS", origin: "https://example.com" })
      .resolves({ enabled: false });
    chrome.runtime.sendMessage
      .withArgs({ type: "ENABLE_ORIGIN", origin: "https://example.com", tabId: 5 })
      .resolves({ ok: true });
    await loadPopupFresh();

    (document.getElementById("toggle-button") as HTMLButtonElement).click();
    await flushMicrotasks();

    expect(
      chrome.runtime.sendMessage.calledWithMatch({
        type: "ENABLE_ORIGIN",
        origin: "https://example.com",
        tabId: 5,
      }),
    ).toBe(true);
    expect((document.getElementById("other-tabs-note") as HTMLElement).hidden).toBe(false);
  });

  it("失敗時はメッセージを表示する", async () => {
    chrome.tabs.query.resolves([{ id: 5, url: "https://example.com/article" }]);
    chrome.runtime.sendMessage
      .withArgs({ type: "GET_ORIGIN_STATUS", origin: "https://example.com" })
      .resolves({ enabled: false });
    chrome.runtime.sendMessage
      .withArgs({ type: "ENABLE_ORIGIN", origin: "https://example.com", tabId: 5 })
      .resolves({ ok: false, reason: "権限が許可されませんでした。" });
    await loadPopupFresh();

    (document.getElementById("toggle-button") as HTMLButtonElement).click();
    await flushMicrotasks();

    const messageEl = document.getElementById("message") as HTMLElement;
    expect(messageEl.hidden).toBe(false);
    expect(messageEl.textContent).toBe("権限が許可されませんでした。");
  });
});

describe("popup: 削除操作", () => {
  it("現在URLの削除ボタンはDELETE_RECORDを送信する", async () => {
    chrome.tabs.query.resolves([{ id: 1, url: "https://example.com/article?x=1" }]);
    chrome.runtime.sendMessage
      .withArgs({ type: "GET_ORIGIN_STATUS", origin: "https://example.com" })
      .resolves({ enabled: true });
    await loadPopupFresh();

    (document.getElementById("delete-current-button") as HTMLButtonElement).click();
    await flushMicrotasks();

    expect(
      chrome.runtime.sendMessage.calledWithMatch({
        type: "DELETE_RECORD",
        canonicalUrl: "https://example.com/article?x=1",
      }),
    ).toBe(true);
  });

  it("すべて削除ボタンはDELETE_ALLを送信する", async () => {
    chrome.tabs.query.resolves([{ id: 1, url: "https://example.com/article" }]);
    chrome.runtime.sendMessage
      .withArgs({ type: "GET_ORIGIN_STATUS", origin: "https://example.com" })
      .resolves({ enabled: true });
    await loadPopupFresh();

    (document.getElementById("delete-all-button") as HTMLButtonElement).click();
    await flushMicrotasks();

    expect(chrome.runtime.sendMessage.calledWithMatch({ type: "DELETE_ALL" })).toBe(true);
  });
});
