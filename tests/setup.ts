import chrome from "sinon-chrome";
import sinon from "sinon";
import { afterEach, beforeEach } from "vitest";

// sinon-chromeが提供するグローバルchrome APIフェイクを、テスト実行環境へ注入する。
(globalThis as unknown as { chrome: typeof chrome }).chrome = chrome;

// jsdomはCSS.escape()を実装していない（実際のChromeでは標準対応済み）。
// テスト環境向けに最小限のポリフィルを追加する。
if (typeof (globalThis as unknown as { CSS?: unknown }).CSS === "undefined") {
  (globalThis as unknown as { CSS: { escape: (value: string) => string } }).CSS = {
    escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`),
  };
}

// chrome.storage.localの簡易フェイク（structuredCloneで値のコピーを模倣）。
let localStore: Record<string, unknown> = {};

function fakeGet(keys?: string | string[] | Record<string, unknown>): Promise<Record<string, unknown>> {
  if (keys === undefined) return Promise.resolve(structuredClone(localStore));
  const keyList = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
  const result: Record<string, unknown> = {};
  for (const key of keyList) {
    if (key in localStore) result[key] = structuredClone(localStore[key]);
  }
  return Promise.resolve(result);
}

function fakeSet(items: Record<string, unknown>): Promise<void> {
  for (const [key, value] of Object.entries(items)) {
    localStore[key] = structuredClone(value);
  }
  return Promise.resolve();
}

// sinon-chrome(v3.0.1)はManifest V3で追加されたchrome.scriptingを持たない。
// 動的content script登録に必要な分だけ手書きスタブを追加する。
export interface ScriptingExtras {
  scripting: {
    executeScript: sinon.SinonStub;
    registerContentScripts: sinon.SinonStub;
    unregisterContentScripts: sinon.SinonStub;
    getRegisteredContentScripts: sinon.SinonStub;
  };
}

export const chromeExtra = chrome as unknown as ScriptingExtras;
chromeExtra.scripting = {
  executeScript: sinon.stub(),
  registerContentScripts: sinon.stub(),
  unregisterContentScripts: sinon.stub(),
  getRegisteredContentScripts: sinon.stub(),
};

beforeEach(() => {
  chrome.flush();
  localStore = {};
  chrome.storage.local.get.callsFake(fakeGet);
  chrome.storage.local.set.callsFake(fakeSet);

  chromeExtra.scripting.executeScript.reset();
  chromeExtra.scripting.executeScript.resolves([{ result: undefined }]);
  chromeExtra.scripting.registerContentScripts.reset();
  chromeExtra.scripting.registerContentScripts.resolves(undefined);
  chromeExtra.scripting.unregisterContentScripts.reset();
  chromeExtra.scripting.unregisterContentScripts.resolves(undefined);
  chromeExtra.scripting.getRegisteredContentScripts.reset();
  chromeExtra.scripting.getRegisteredContentScripts.resolves([]);

  chrome.permissions.contains.resolves(true);
  chrome.permissions.request.resolves(true);
  chrome.permissions.remove.resolves(true);
  chrome.permissions.getAll.resolves({ origins: [], permissions: [] });
});

afterEach(() => {
  chrome.flush();
});
