import { canonicalUrlOf, originOf } from "../shared/url";
import type { ActionResponse, Request } from "../shared/messages";

const errorEl = document.getElementById("error") as HTMLElement;
const originDisplayEl = document.getElementById("origin-display") as HTMLElement;
const otherTabsNoteEl = document.getElementById("other-tabs-note") as HTMLElement;
const toggleButton = document.getElementById("toggle-button") as HTMLButtonElement;
const deleteCurrentButton = document.getElementById("delete-current-button") as HTMLButtonElement;
const deleteAllButton = document.getElementById("delete-all-button") as HTMLButtonElement;
const messageEl = document.getElementById("message") as HTMLElement;

let currentTabId: number | undefined;
let currentOrigin: string | undefined;
let currentCanonicalUrl: string | undefined;
let currentlyEnabled = false;

function showError(text: string): void {
  errorEl.textContent = text;
  errorEl.hidden = false;
  toggleButton.disabled = true;
  deleteCurrentButton.disabled = true;
}

function showMessage(text: string): void {
  messageEl.textContent = text;
  messageEl.hidden = false;
}

async function sendRequest<T>(request: Request): Promise<T> {
  return chrome.runtime.sendMessage(request) as Promise<T>;
}

function renderToggleButton(): void {
  toggleButton.textContent = currentlyEnabled ? "このサイトを無効にする" : "このサイトを有効にする";
}

async function init(): Promise<void> {
  let tab: chrome.tabs.Tab | undefined;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = activeTab;
  } catch {
    showError("現在のタブを取得できませんでした。");
    return;
  }

  if (!tab || tab.id === undefined || tab.url === undefined) {
    showError("現在のページの情報を取得できませんでした。");
    return;
  }

  const origin = originOf(tab.url);
  const canonicalUrl = canonicalUrlOf(tab.url);
  if (!origin || !canonicalUrl) {
    showError("このページは対象外です（http/https以外のページ等）。");
    return;
  }

  currentTabId = tab.id;
  currentOrigin = origin;
  currentCanonicalUrl = canonicalUrl;
  originDisplayEl.textContent = origin;
  otherTabsNoteEl.hidden = true;

  try {
    const response = await sendRequest<{ enabled: boolean }>({ type: "GET_ORIGIN_STATUS", origin });
    currentlyEnabled = response.enabled;
  } catch {
    showError("状態の取得に失敗しました。");
    return;
  }

  renderToggleButton();
}

toggleButton.addEventListener("click", () => {
  void (async () => {
    if (!currentOrigin || currentTabId === undefined) return;
    toggleButton.disabled = true;
    try {
      const response = currentlyEnabled
        ? await sendRequest<ActionResponse>({ type: "DISABLE_ORIGIN", origin: currentOrigin })
        : await sendRequest<ActionResponse>({ type: "ENABLE_ORIGIN", origin: currentOrigin, tabId: currentTabId });
      if (response.ok) {
        currentlyEnabled = !currentlyEnabled;
        renderToggleButton();
        otherTabsNoteEl.hidden = false;
      } else {
        showMessage(response.reason);
      }
    } catch {
      showMessage("操作に失敗しました。");
    } finally {
      toggleButton.disabled = false;
    }
  })();
});

deleteCurrentButton.addEventListener("click", () => {
  void (async () => {
    if (!currentCanonicalUrl) return;
    try {
      await sendRequest<ActionResponse>({ type: "DELETE_RECORD", canonicalUrl: currentCanonicalUrl });
      showMessage("現在のURLの記録を削除しました。");
    } catch {
      showMessage("削除に失敗しました。");
    }
  })();
});

deleteAllButton.addEventListener("click", () => {
  void (async () => {
    try {
      await sendRequest<ActionResponse>({ type: "DELETE_ALL" });
      showMessage("保存データをすべて削除しました。");
    } catch {
      showMessage("削除に失敗しました。");
    }
  })();
});

void init();
