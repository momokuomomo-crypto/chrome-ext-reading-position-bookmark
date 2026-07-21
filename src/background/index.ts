import { disableOrigin, enableOrigin, reconcileOrigins } from "./origin-manager";
import { deleteAllRecords, deleteRecord, enqueueTask, getRecord, loadState, upsertRecord } from "./storage";
import type { ActionResponse, GetRecordResponse, PopupRequest, Request, SavePositionRequest } from "../shared/messages";

// 通常整合（storage・permission・登録済みスクリプトの3者照合）は、SW生存
// 期間中に1回だけ、いずれのメッセージハンドラ経由でも初回アクセス時に
// 自動実行する（B-9で確立済みのensureReconciled()パターンを踏襲）。
let reconciledPromise: Promise<void> | undefined;
function ensureReconciled(): Promise<void> {
  if (!reconciledPromise) {
    const promise = enqueueTask(async () => {
      try {
        await reconcileOrigins();
      } catch (error) {
        if (reconciledPromise === promise) reconciledPromise = undefined;
        throw error;
      }
    });
    reconciledPromise = promise;
  }
  return reconciledPromise;
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureReconciled();
});

async function handlePopupRequest(request: PopupRequest): Promise<ActionResponse | { enabled: boolean }> {
  await ensureReconciled();
  switch (request.type) {
    case "GET_ORIGIN_STATUS": {
      const state = await loadState();
      return { enabled: state.enabledOrigins.includes(request.origin) };
    }
    case "ENABLE_ORIGIN":
      return enqueueTask(() => enableOrigin(request.origin, request.tabId));
    case "DISABLE_ORIGIN":
      return enqueueTask(() => disableOrigin(request.origin));
    case "DELETE_RECORD":
      await enqueueTask(() => deleteRecord(request.canonicalUrl));
      return { ok: true };
    case "DELETE_ALL":
      await enqueueTask(() => deleteAllRecords());
      return { ok: true };
  }
}

async function handleSavePosition(request: SavePositionRequest): Promise<void> {
  await ensureReconciled();
  // 防御的多重化：そのオリジンが現在enabledかをstorageと照合し、無効なら
  // 黙って破棄する（Stage2で追加）。判定と書き込みを同一のenqueueTask内で
  // 行うことで、DISABLE_ORIGINとの間のTOCTOU競合（判定後・書き込み前に
  // 無効化されてレコードが復活する）を防ぐ（Stage5指摘で修正）。
  await enqueueTask(async () => {
    const state = await loadState();
    if (!state.enabledOrigins.includes(request.origin)) return;
    await upsertRecord(request.record.canonicalUrl, request.record);
  });
}

chrome.runtime.onMessage.addListener((message: Request, _sender, sendResponse) => {
  if (message.type === "SAVE_POSITION") {
    void handleSavePosition(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, reason: String(error) }));
    return true;
  }
  if (message.type === "GET_RECORD") {
    void ensureReconciled()
      .then(() => getRecord(message.canonicalUrl))
      .then((record) => {
        const response: GetRecordResponse = { record: record ?? null };
        sendResponse(response);
      })
      .catch(() => sendResponse({ record: null }));
    return true;
  }
  void handlePopupRequest(message)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, reason: String(error) }));
  return true;
});
