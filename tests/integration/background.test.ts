import { beforeEach, describe, expect, it, vi } from "vitest";
import chrome from "sinon-chrome";
import { chromeExtra } from "../setup";
import type { ActionResponse, GetRecordResponse, Request } from "../../src/shared/messages";
import type { PositionRecord, StoreState } from "../../src/shared/types";

async function loadBackgroundFresh(): Promise<void> {
  vi.resetModules();
  await import("../../src/background/index");
}

function dispatchMessage<T>(message: Request): Promise<T> {
  const listener = chrome.runtime.onMessage.addListener.lastCall.args[0] as (
    message: Request,
    sender: unknown,
    sendResponse: (response: T) => void,
  ) => boolean;
  return new Promise((resolve) => {
    listener(message, {}, (response) => resolve(response));
  });
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function seedState(state: StoreState): Promise<void> {
  await chrome.storage.local.set({ readingPositionState: state });
}

function fakeRecord(overrides: Partial<PositionRecord> & Pick<PositionRecord, "canonicalUrl" | "origin">): PositionRecord {
  return {
    schemaVersion: 1,
    scrollY: 1000,
    scrollRatio: 0.5,
    documentHeight: 4000,
    viewportHeight: 800,
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("background: GET_ORIGIN_STATUS", () => {
  it("有効化済みオリジンはtrueを返す", async () => {
    await seedState({ schemaVersion: 1, enabledOrigins: ["https://example.com"], records: {} });
    await loadBackgroundFresh();

    const response = await dispatchMessage<{ enabled: boolean }>({
      type: "GET_ORIGIN_STATUS",
      origin: "https://example.com",
    });

    expect(response.enabled).toBe(true);
  });

  it("未有効化オリジンはfalseを返す", async () => {
    await loadBackgroundFresh();

    const response = await dispatchMessage<{ enabled: boolean }>({
      type: "GET_ORIGIN_STATUS",
      origin: "https://example.com",
    });

    expect(response.enabled).toBe(false);
  });
});

describe("background: ENABLE_ORIGIN", () => {
  it("権限許可・登録成功で有効化する", async () => {
    await loadBackgroundFresh();

    const response = await dispatchMessage<ActionResponse>({
      type: "ENABLE_ORIGIN",
      origin: "https://example.com",
      tabId: 1,
    });

    expect(response.ok).toBe(true);
    expect(chrome.permissions.request.calledWith({ origins: ["https://example.com/*"] })).toBe(true);
    expect(chromeExtra.scripting.registerContentScripts.called).toBe(true);
    const stored = (await chrome.storage.local.get("readingPositionState")) as {
      readingPositionState: StoreState;
    };
    expect(stored.readingPositionState.enabledOrigins).toContain("https://example.com");
  });

  it("権限が拒否された場合は登録せず失敗を返す", async () => {
    chrome.permissions.request.resolves(false);
    await loadBackgroundFresh();

    const response = await dispatchMessage<ActionResponse>({
      type: "ENABLE_ORIGIN",
      origin: "https://example.com",
      tabId: 1,
    });

    expect(response.ok).toBe(false);
    expect(chromeExtra.scripting.registerContentScripts.called).toBe(false);
  });

  it("登録失敗時は権限をロールバックする", async () => {
    chromeExtra.scripting.registerContentScripts.rejects(new Error("register failed"));
    await loadBackgroundFresh();

    const response = await dispatchMessage<ActionResponse>({
      type: "ENABLE_ORIGIN",
      origin: "https://example.com",
      tabId: 1,
    });

    expect(response.ok).toBe(false);
    expect(chrome.permissions.remove.calledWith({ origins: ["https://example.com/*"] })).toBe(true);
    const stored = (await chrome.storage.local.get("readingPositionState")) as {
      readingPositionState: StoreState;
    };
    expect(stored.readingPositionState?.enabledOrigins ?? []).not.toContain("https://example.com");
  });
});

describe("background: DISABLE_ORIGIN", () => {
  beforeEach(() => {
    chrome.tabs.query.resolves([{ id: 1 }, { id: 2 }]);
    chrome.tabs.sendMessage.resolves(undefined);
  });

  it("登録解除・権限解除・全タブへのブロードキャスト・レコード削除を行う", async () => {
    await seedState({
      schemaVersion: 1,
      enabledOrigins: ["https://example.com"],
      records: {
        "https://example.com/a": fakeRecord({ canonicalUrl: "https://example.com/a", origin: "https://example.com" }),
        "https://other.com/b": fakeRecord({ canonicalUrl: "https://other.com/b", origin: "https://other.com" }),
      },
    });
    await loadBackgroundFresh();

    const response = await dispatchMessage<ActionResponse>({
      type: "DISABLE_ORIGIN",
      origin: "https://example.com",
    });

    expect(response.ok).toBe(true);
    expect(chromeExtra.scripting.unregisterContentScripts.called).toBe(true);
    expect(chrome.permissions.remove.called).toBe(true);
    expect(chrome.tabs.sendMessage.calledWith(1, { type: "STOP_TRACKING", origin: "https://example.com" })).toBe(
      true,
    );
    expect(chrome.tabs.sendMessage.calledWith(2, { type: "STOP_TRACKING", origin: "https://example.com" })).toBe(
      true,
    );

    const stored = (await chrome.storage.local.get("readingPositionState")) as {
      readingPositionState: StoreState;
    };
    expect(stored.readingPositionState.enabledOrigins).not.toContain("https://example.com");
    expect(stored.readingPositionState.records["https://example.com/a"]).toBeUndefined();
    expect(stored.readingPositionState.records["https://other.com/b"]).toBeDefined();
  });

  it("権限解除より先に対象タブへSTOP_TRACKINGを送る（Stage5指摘：解除後はtabs.query({url})が機能しない可能性があるため）", async () => {
    await seedState({ schemaVersion: 1, enabledOrigins: ["https://example.com"], records: {} });
    await loadBackgroundFresh();

    const callOrder: string[] = [];
    chrome.tabs.query.callsFake(() => {
      callOrder.push("tabs.query");
      return Promise.resolve([{ id: 1 }]);
    });
    chrome.permissions.remove.callsFake(() => {
      callOrder.push("permissions.remove");
      return Promise.resolve(true);
    });

    await dispatchMessage<ActionResponse>({ type: "DISABLE_ORIGIN", origin: "https://example.com" });

    expect(callOrder).toContain("tabs.query");
    expect(callOrder).toContain("permissions.remove");
    expect(callOrder.indexOf("tabs.query")).toBeLessThan(callOrder.indexOf("permissions.remove"));
  });
});

describe("background: 整合性チェック（reconcileOrigins）", () => {
  it("権限が失われているenabled originはstorageから除去する", async () => {
    await seedState({
      schemaVersion: 1,
      enabledOrigins: ["https://example.com"],
      records: {},
    });
    chrome.permissions.contains.resolves(false);
    await loadBackgroundFresh();

    await dispatchMessage<GetRecordResponse>({
      type: "GET_RECORD",
      origin: "https://example.com",
      canonicalUrl: "https://example.com/a",
    });

    const stored = (await chrome.storage.local.get("readingPositionState")) as {
      readingPositionState: StoreState;
    };
    expect(stored.readingPositionState.enabledOrigins).not.toContain("https://example.com");
  });

  it("権限はあるが登録が欠けているoriginは再登録する", async () => {
    await seedState({
      schemaVersion: 1,
      enabledOrigins: ["https://example.com"],
      records: {},
    });
    chrome.permissions.contains.resolves(true);
    chromeExtra.scripting.getRegisteredContentScripts.resolves([]);
    await loadBackgroundFresh();

    await dispatchMessage<GetRecordResponse>({
      type: "GET_RECORD",
      origin: "https://example.com",
      canonicalUrl: "https://example.com/a",
    });

    expect(chromeExtra.scripting.registerContentScripts.called).toBe(true);
  });

  it("chrome.permissions.onRemovedで対応するenabled originを解除する", async () => {
    await seedState({
      schemaVersion: 1,
      enabledOrigins: ["https://example.com"],
      records: {},
    });
    await loadBackgroundFresh();

    const listener = chrome.permissions.onRemoved.addListener.lastCall.args[0] as (permissions: {
      origins?: string[];
    }) => void;
    listener({ origins: ["https://example.com/*"] });
    await flushAsync();

    const stored = (await chrome.storage.local.get("readingPositionState")) as {
      readingPositionState: StoreState;
    };
    expect(stored.readingPositionState.enabledOrigins).not.toContain("https://example.com");
  });

  it("storageに無い孤児権限・孤児登録スクリプトを解消する（真の3者照合、Stage5指摘で追加）", async () => {
    await seedState({ schemaVersion: 1, enabledOrigins: [], records: {} });
    chrome.permissions.getAll.resolves({ origins: ["https://orphan.com/*"], permissions: [] });
    chromeExtra.scripting.getRegisteredContentScripts.resolves([
      { id: "reading-position-999999", matches: ["https://orphan.com/*"] },
    ]);
    await loadBackgroundFresh();

    await dispatchMessage<GetRecordResponse>({
      type: "GET_RECORD",
      origin: "https://example.com",
      canonicalUrl: "https://example.com/a",
    });

    expect(chrome.permissions.remove.calledWith({ origins: ["https://orphan.com/*"] })).toBe(true);
    expect(
      chromeExtra.scripting.unregisterContentScripts.calledWith({ ids: ["reading-position-999999"] }),
    ).toBe(true);
  });
});

describe("background: SAVE_POSITION・GET_RECORD", () => {
  it("有効化されていないオリジンの保存要求は黙って破棄する（防御的多重化）", async () => {
    await seedState({ schemaVersion: 1, enabledOrigins: [], records: {} });
    await loadBackgroundFresh();

    await dispatchMessage<ActionResponse>({
      type: "SAVE_POSITION",
      origin: "https://example.com",
      record: fakeRecord({ canonicalUrl: "https://example.com/a", origin: "https://example.com" }),
    });

    const stored = (await chrome.storage.local.get("readingPositionState")) as {
      readingPositionState: StoreState;
    };
    expect(Object.keys(stored.readingPositionState.records)).toHaveLength(0);
  });

  it("有効化されたオリジンの保存要求は保存され、GET_RECORDで取得できる", async () => {
    await seedState({ schemaVersion: 1, enabledOrigins: ["https://example.com"], records: {} });
    await loadBackgroundFresh();

    await dispatchMessage<ActionResponse>({
      type: "SAVE_POSITION",
      origin: "https://example.com",
      record: fakeRecord({ canonicalUrl: "https://example.com/a", origin: "https://example.com" }),
    });

    const response = await dispatchMessage<GetRecordResponse>({
      type: "GET_RECORD",
      origin: "https://example.com",
      canonicalUrl: "https://example.com/a",
    });

    expect(response.record?.canonicalUrl).toBe("https://example.com/a");
  });

  it("DISABLE_ORIGIN後に届いたSAVE_POSITIONは保存されない（TOCTOU競合対策、Stage5指摘で修正）", async () => {
    await seedState({ schemaVersion: 1, enabledOrigins: ["https://example.com"], records: {} });
    chrome.tabs.query.resolves([]);
    await loadBackgroundFresh();

    const disablePromise = dispatchMessage<ActionResponse>({
      type: "DISABLE_ORIGIN",
      origin: "https://example.com",
    });
    const savePromise = dispatchMessage<ActionResponse>({
      type: "SAVE_POSITION",
      origin: "https://example.com",
      record: fakeRecord({ canonicalUrl: "https://example.com/a", origin: "https://example.com" }),
    });

    await Promise.all([disablePromise, savePromise]);

    const stored = (await chrome.storage.local.get("readingPositionState")) as {
      readingPositionState: StoreState;
    };
    expect(stored.readingPositionState.records["https://example.com/a"]).toBeUndefined();
  });
});

describe("background: schemaVersion不整合時の安全装置（監査で発見）", () => {
  it("未知のschemaVersionの場合、reconcileOrigins()は既存の権限・登録済みスクリプトを孤児とみなして削除しない", async () => {
    await chrome.storage.local.set({
      readingPositionState: { schemaVersion: 2, enabledOrigins: [], records: {} },
    });
    chrome.permissions.getAll.resolves({ origins: ["https://example.com/*"], permissions: [] });
    chromeExtra.scripting.getRegisteredContentScripts.resolves([
      { id: "reading-position-123", matches: ["https://example.com/*"] },
    ]);
    await loadBackgroundFresh();

    await dispatchMessage<GetRecordResponse>({
      type: "GET_RECORD",
      origin: "https://example.com",
      canonicalUrl: "https://example.com/a",
    });

    expect(chrome.permissions.remove.called).toBe(false);
    expect(chromeExtra.scripting.unregisterContentScripts.called).toBe(false);
  });
});

describe("background: reconcileOriginsの権限喪失検知（監査で発見：disableOriginと後始末が不整合だった）", () => {
  it("権限が失われているenabled originはSTOP_TRACKING送信・レコード削除も行う", async () => {
    await seedState({
      schemaVersion: 1,
      enabledOrigins: ["https://example.com"],
      records: {
        "https://example.com/a": fakeRecord({ canonicalUrl: "https://example.com/a", origin: "https://example.com" }),
      },
    });
    chrome.permissions.contains.resolves(false);
    chrome.tabs.query.resolves([{ id: 1 }]);
    chrome.tabs.sendMessage.resolves(undefined);
    await loadBackgroundFresh();

    await dispatchMessage<GetRecordResponse>({
      type: "GET_RECORD",
      origin: "https://example.com",
      canonicalUrl: "https://example.com/a",
    });

    expect(chrome.tabs.sendMessage.calledWith(1, { type: "STOP_TRACKING", origin: "https://example.com" })).toBe(
      true,
    );
    const stored = (await chrome.storage.local.get("readingPositionState")) as {
      readingPositionState: StoreState;
    };
    expect(stored.readingPositionState.records["https://example.com/a"]).toBeUndefined();
  });
});

describe("background: disableOriginのstorage書き込み失敗耐性（監査で発見）", () => {
  it("storage書き込みが失敗しても、権限・登録は既に解除済みのため無効化成功として返す", async () => {
    await seedState({ schemaVersion: 1, enabledOrigins: ["https://example.com"], records: {} });
    chrome.tabs.query.resolves([]);
    await loadBackgroundFresh();
    chrome.storage.local.set.rejects(new Error("quota exceeded"));

    const response = await dispatchMessage<ActionResponse>({
      type: "DISABLE_ORIGIN",
      origin: "https://example.com",
    });

    expect(response.ok).toBe(true);
    expect(chrome.permissions.remove.called).toBe(true);
  });
});

describe("background: onStartup（監査で発見：onInstalledのみでは再起動後の整合性チェックが受動的だった）", () => {
  it("ブラウザ再起動時にも整合性チェックを実行する", async () => {
    await seedState({ schemaVersion: 1, enabledOrigins: ["https://example.com"], records: {} });
    chrome.permissions.contains.resolves(true);
    chromeExtra.scripting.getRegisteredContentScripts.resolves([]);
    await loadBackgroundFresh();

    const listener = chrome.runtime.onStartup.addListener.lastCall.args[0] as () => void;
    listener();
    await flushAsync();

    expect(chromeExtra.scripting.registerContentScripts.called).toBe(true);
  });
});

describe("background: DELETE_RECORD・DELETE_ALL", () => {
  it("DELETE_RECORDは指定したURLの記録のみ削除する", async () => {
    await seedState({
      schemaVersion: 1,
      enabledOrigins: ["https://example.com"],
      records: {
        "https://example.com/a": fakeRecord({ canonicalUrl: "https://example.com/a", origin: "https://example.com" }),
        "https://example.com/b": fakeRecord({ canonicalUrl: "https://example.com/b", origin: "https://example.com" }),
      },
    });
    await loadBackgroundFresh();

    await dispatchMessage<ActionResponse>({ type: "DELETE_RECORD", canonicalUrl: "https://example.com/a" });

    const stored = (await chrome.storage.local.get("readingPositionState")) as {
      readingPositionState: StoreState;
    };
    expect(stored.readingPositionState.records["https://example.com/a"]).toBeUndefined();
    expect(stored.readingPositionState.records["https://example.com/b"]).toBeDefined();
  });

  it("DELETE_ALLは全記録を削除する", async () => {
    await seedState({
      schemaVersion: 1,
      enabledOrigins: ["https://example.com"],
      records: {
        "https://example.com/a": fakeRecord({ canonicalUrl: "https://example.com/a", origin: "https://example.com" }),
      },
    });
    await loadBackgroundFresh();

    await dispatchMessage<ActionResponse>({ type: "DELETE_ALL" });

    const stored = (await chrome.storage.local.get("readingPositionState")) as {
      readingPositionState: StoreState;
    };
    expect(Object.keys(stored.readingPositionState.records)).toHaveLength(0);
  });
});
