import { loadState, saveState, deleteRecordsForOrigin, enqueueTask, hasUnrecognizedSchema } from "./storage";
import type { ActionResponse } from "../shared/messages";
// CRXJSの`?script`インポートは、実際にビルドされたファイル名（ハッシュ付き）
// を解決してくれる。動的登録・都度注入のいずれもmanifestのcontent_scripts
// から参照されないため、CRXJSが自動検出できず、手書きのパス指定では
// ビルド時に付与されるコンテンツハッシュに対応できない
// （実装中に発見し、Test Gate A完了前に自己修正した）。
import contentScriptPath from "../content/index.ts?script";

const CONTENT_SCRIPT_ID_PREFIX = "reading-position-";

function scriptIdFor(origin: string): string {
  // originを直接IDに使わず、安定したハッシュ相当の短い識別子にする。
  let hash = 0;
  for (let i = 0; i < origin.length; i++) {
    hash = (hash * 31 + origin.charCodeAt(i)) | 0;
  }
  return `${CONTENT_SCRIPT_ID_PREFIX}${Math.abs(hash)}`;
}

// Chrome拡張のマッチパターンはホスト部にポート番号を含められない
// （host文字列はそのまま比較され、ポート付きだと実際のページのホスト名と
// 一致しない）。そのためポートを除いたprotocol+hostnameでパターンを生成
// する（Stage5指摘で修正：非標準ポートのサイトで有効化が機能しない
// 不具合の原因だった）。
function matchPatternFor(origin: string): string {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

async function isPermissionGranted(origin: string): Promise<boolean> {
  return chrome.permissions.contains({ origins: [matchPatternFor(origin)] });
}

async function registerForOrigin(origin: string): Promise<void> {
  await chrome.scripting.registerContentScripts([
    {
      id: scriptIdFor(origin),
      matches: [matchPatternFor(origin)],
      js: [contentScriptPath],
      runAt: "document_idle",
      allFrames: false,
      persistAcrossSessions: true,
    },
  ]);
}

async function unregisterForOrigin(origin: string): Promise<void> {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [scriptIdFor(origin)] });
  } catch {
    // 未登録の場合のエラーは無視する
  }
}

async function broadcastStopTracking(origin: string): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ url: `${origin}/*` });
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "STOP_TRACKING", origin });
      } catch {
        // タブにcontent scriptが無い等の失敗は無視する
      }
    }
  } catch {
    // tabs.query自体の失敗は無視する
  }
}

// 有効化の操作順序：permission要求→content script登録→登録成功後にのみ
// storageへ書き込み。登録・書き込みのいずれかが失敗した場合は
// permissions.remove()でロールバックする（Stage2で確定、Stage5指摘で
// 「登録成功後のstorage書き込み失敗」もロールバック対象に含めるよう修正）。
export async function enableOrigin(origin: string, tabId: number): Promise<ActionResponse> {
  const pattern = matchPatternFor(origin);
  let granted: boolean;
  try {
    granted = await chrome.permissions.request({ origins: [pattern] });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (!granted) {
    return { ok: false, reason: "権限が許可されませんでした。" };
  }

  const rollback = async (): Promise<void> => {
    try {
      const removed = await chrome.permissions.remove({ origins: [pattern] });
      if (!removed) {
        // remove()がfalseを返した場合も、次回のensureReconciled()が
        // 孤児権限として検出・解消する（Stage5指摘：戻り値を無視しない）。
      }
    } catch {
      // ロールバック自体の失敗も次回の整合性チェックに委ねる
    }
    await unregisterForOrigin(origin);
  };

  try {
    await registerForOrigin(origin);
  } catch (error) {
    await rollback();
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }

  try {
    const state = await loadState();
    if (!state.enabledOrigins.includes(origin)) {
      state.enabledOrigins.push(origin);
    }
    await saveState(state);
  } catch (error) {
    await rollback();
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [contentScriptPath] });
  } catch {
    // 現在タブへの即時注入失敗は致命的ではない（次回ナビゲーションで動的登録が効く）
  }

  return { ok: true };
}

// 無効化時：既に実行中のcontent scriptを止めるための全タブブロードキャスト
// は、権限を取り消す「前」に行う（Stage5指摘で修正：permissions.remove()
// 後にtabs.query({url})を呼ぶと、その時点で対象オリジンのhost permission
// が既に失われておりURLによるタブ照会自体が機能しない可能性があるため）。
// 登録解除・権限解除・レコード削除はその後に行う（Stage2で確定）。
export async function disableOrigin(origin: string): Promise<ActionResponse> {
  await broadcastStopTracking(origin);
  await unregisterForOrigin(origin);
  try {
    await chrome.permissions.remove({ origins: [matchPatternFor(origin)] });
  } catch {
    // 無視する
  }

  // ここまでで権限・登録の解除（実効的な無効化）は完了している。
  // 以降のstorage書き込みが失敗しても「無効化に失敗した」と報告しない
  // （権限は既に失われているため）。enabledOriginsに古いエントリが
  // 残っても、次回のreconcileOrigins()が権限喪失を検出して自己修復する
  // （Stage5指摘：enableOrigin側は既にロールバックで対称に扱っていたが、
  // disableOrigin側は書き込み失敗時の扱いが未定義だった）。
  try {
    const state = await loadState();
    state.enabledOrigins = state.enabledOrigins.filter((o) => o !== origin);
    await saveState(state);
    await deleteRecordsForOrigin(origin);
  } catch {
    // 次回reconcileOrigins()に委ねる
  }

  return { ok: true };
}

// storage・実際のpermission・登録済みスクリプトの3者を照合する。
// (1) storage起点：権限のない登録は解除し、権限があるのに登録が欠けている
//     場合は再作成する。
// (2) 逆方向：storageに存在しないのに権限だけ残っている、または本拡張の
//     content script登録だけ残っている「孤児」も解消する（Stage5指摘で
//     追加：enableOrigin成功後にstorage書き込みだけが失敗した場合等に
//     生じ得る片方向の不整合を、旧実装は検出できなかった）。
export async function reconcileOrigins(): Promise<void> {
  // schemaVersionが未知の場合、loadState()は「空」を返すため、以降の
  // 孤児削除ロジック（expectedPatterns/expectedScriptIdsが空集合になる）
  // が実際には有効だったはずの権限・登録済みスクリプトを全て孤児と
  // 誤判定して削除してしまう。何が期待される状態か判断できないため、
  // 何もせず安全側に倒す（実データはstorageにそのまま残り、対応する
  // マイグレーション実装後の再チェックで正しく解決される）。
  if (await hasUnrecognizedSchema()) return;

  const state = await loadState();
  let changed = false;

  for (const origin of [...state.enabledOrigins]) {
    const granted = await isPermissionGranted(origin);
    if (!granted) {
      state.enabledOrigins = state.enabledOrigins.filter((o) => o !== origin);
      // deleteRecordsForOrigin()は使わない：それ自身が独立した
      // loadState→saveStateを行うため、この関数末尾の`saveState(state)`
      // （このループ開始時点で読み込んだ古いコピー）が後から上書きして
      // しまい、削除したはずのレコードが復活する（修正時に発覚した
      // ロストアップデート）。同一のstateオブジェクト上で直接削除する。
      for (const [key, record] of Object.entries(state.records)) {
        if (record.origin === origin) delete state.records[key];
      }
      await broadcastStopTracking(origin);
      await unregisterForOrigin(origin);
      changed = true;
      continue;
    }

    let registered: chrome.scripting.RegisteredContentScript[] = [];
    try {
      registered = await chrome.scripting.getRegisteredContentScripts({ ids: [scriptIdFor(origin)] });
    } catch {
      registered = [];
    }
    if (registered.length === 0) {
      try {
        await registerForOrigin(origin);
      } catch {
        // 再登録に失敗した場合は次回SW起動時の整合性チェックに委ねる
        // （ensureReconciled()はSW生存期間中1回のみの設計のため）
      }
    }
  }

  const expectedPatterns = new Set(state.enabledOrigins.map(matchPatternFor));
  const expectedScriptIds = new Set(state.enabledOrigins.map(scriptIdFor));

  try {
    const allGranted = await chrome.permissions.getAll();
    const orphanPatterns = (allGranted.origins ?? []).filter(
      (pattern) =>
        (pattern.startsWith("http://") || pattern.startsWith("https://")) && !expectedPatterns.has(pattern),
    );
    for (const pattern of orphanPatterns) {
      try {
        await chrome.permissions.remove({ origins: [pattern] });
      } catch {
        // 無視
      }
    }
  } catch {
    // permissions.getAll失敗時は次回チェックに委ねる
  }

  try {
    const allRegistered = await chrome.scripting.getRegisteredContentScripts();
    const orphanIds = allRegistered
      .map((script) => script.id)
      .filter((id) => id.startsWith(CONTENT_SCRIPT_ID_PREFIX) && !expectedScriptIds.has(id));
    if (orphanIds.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: orphanIds });
    }
  } catch {
    // 無視
  }

  if (changed) {
    await saveState(state);
  }
}

// ユーザーがChrome標準UIから権限を取り消した場合、対応するenabled origin
// 設定・動的登録・既存レコードを自動的に解除する（Stage2で追加、Stage5指摘
// で修正：他のstorage書き込みと同じenqueueTaskキューを経由させ、通常の
// 無効化と同じ後片付け（STOP_TRACKINGブロードキャスト・レコード削除）を
// 行うようにした。権限は既に失われているためpermissions.remove()は呼ばない）。
chrome.permissions.onRemoved.addListener((permissions) => {
  const origins = permissions.origins ?? [];
  void enqueueTask(async () => {
    const state = await loadState();
    const affectedOrigins = state.enabledOrigins.filter((origin) =>
      origins.some((pattern) => pattern === matchPatternFor(origin)),
    );
    if (affectedOrigins.length === 0) return;

    for (const origin of affectedOrigins) {
      await broadcastStopTracking(origin);
      await unregisterForOrigin(origin);
      await deleteRecordsForOrigin(origin);
    }

    state.enabledOrigins = state.enabledOrigins.filter((o) => !affectedOrigins.includes(o));
    await saveState(state);
  });
});
