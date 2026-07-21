import { canonicalUrlOf, originOf } from "../shared/url";
import { findAnchorElement, textFingerprintOf } from "./anchor";
import { generateSelector } from "../shared/selector";
import { isSimilarEnough } from "../shared/similarity";
import type { PositionRecord } from "../shared/types";
import type { GetOriginStatusResponse, GetRecordResponse, StopTrackingMessage } from "../shared/messages";

const SAVE_DEBOUNCE_MS = 750;
const PERIODIC_SAVE_MS = 15000;
const SAVE_THRESHOLD_PX = 100;
const NEAR_THRESHOLD_PX = 300;
const DISMISS_THRESHOLD_PX = 200;
const RESCAN_MAX_WAIT_MS = 10000;
const SETTLE_WAIT_MS = 1000;
const CONTENT_BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, figcaption";

let disposed = false;
// 単一のsavingSuspendedフラグ。初回表示時の保留、復元中のMutationObserver
// 再探索中の両方を含む。全ての保存経路（debounce・15秒周期・
// visibilitychange・pagehide）が例外なくこのフラグを参照する
// （Stage2で確定した最重要修正）。
let savingSuspended = false;
let lastSavedScrollY = -1;
let scrollDebounceTimer: ReturnType<typeof setTimeout> | undefined;
let periodicTimer: ReturnType<typeof setInterval> | undefined;
let urlPollTimer: ReturnType<typeof setInterval> | undefined;
let currentCanonicalUrl: string | null = null;
let currentOrigin: string | null = null;
let restoreButtonHost: HTMLElement | undefined;

function computeCurrentRecord(): PositionRecord | null {
  if (currentCanonicalUrl === null || currentOrigin === null) return null;
  const scrollY = window.scrollY;
  const documentHeight = document.documentElement.scrollHeight;
  const viewportHeight = window.innerHeight;
  const maxScroll = Math.max(documentHeight - viewportHeight, 1);
  const scrollRatio = Math.min(Math.max(scrollY / maxScroll, 0), 1);

  const anchorEl = findAnchorElement(window.innerWidth / 2, 80);
  let anchor: PositionRecord["anchor"];
  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    const elementDocTop = rect.top + scrollY;
    anchor = {
      selector: generateSelector(anchorEl),
      textFingerprint: textFingerprintOf(anchorEl),
      offsetFromElementTop: scrollY - elementDocTop,
    };
  }

  return {
    schemaVersion: 1,
    canonicalUrl: currentCanonicalUrl,
    origin: currentOrigin,
    scrollY,
    scrollRatio,
    documentHeight,
    viewportHeight,
    anchor,
    updatedAt: Date.now(),
  };
}

async function saveNow(options: { force?: boolean } = {}): Promise<void> {
  if (savingSuspended || disposed) return;
  const record = computeCurrentRecord();
  if (!record) return;
  if (!options.force && lastSavedScrollY !== -1 && Math.abs(record.scrollY - lastSavedScrollY) < SAVE_THRESHOLD_PX) {
    return;
  }
  lastSavedScrollY = record.scrollY;
  try {
    await chrome.runtime.sendMessage({ type: "SAVE_POSITION", origin: record.origin, record });
  } catch {
    // background不在・拡張再読み込み直後等は無視する
  }
}

function scheduleScrollSave(): void {
  if (scrollDebounceTimer !== undefined) clearTimeout(scrollDebounceTimer);
  scrollDebounceTimer = setTimeout(() => {
    void saveNow();
  }, SAVE_DEBOUNCE_MS);
}

function onScroll(): void {
  scheduleScrollSave();
}

function onVisibilityChange(): void {
  if (document.visibilityState === "hidden") {
    void saveNow({ force: true });
  }
}

function onPageHide(): void {
  void saveNow({ force: true });
}

function clampScroll(y: number): number {
  const max = Math.max(document.documentElement.scrollHeight - window.innerHeight, 0);
  return Math.min(Math.max(y, 0), max);
}

function scanForFingerprint(fingerprint: string, limit: number): Element | null {
  const candidates = document.querySelectorAll(CONTENT_BLOCK_SELECTOR);
  let checked = 0;
  for (const el of candidates) {
    if (checked >= limit) break;
    checked += 1;
    if (isSimilarEnough(textFingerprintOf(el), fingerprint)) return el;
  }
  return null;
}

function waitAndRescan(fingerprint: string, maxWaitMs: number): Promise<Element | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (el: Element | null): void => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(el);
    };
    const timer = setTimeout(() => finish(null), maxWaitMs);
    const observer = new MutationObserver(() => {
      const found = scanForFingerprint(fingerprint, 2000);
      if (found) finish(found);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function waitForDomSettled(maxWaitMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      observer.disconnect();
      clearTimeout(maxTimer);
      if (settleTimer !== undefined) clearTimeout(settleTimer);
    };
    const maxTimer = setTimeout(() => {
      cleanup();
      resolve();
    }, maxWaitMs);
    const observer = new MutationObserver(() => {
      if (settleTimer !== undefined) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        cleanup();
        resolve();
      }, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    settleTimer = setTimeout(() => {
      cleanup();
      resolve();
    }, 300);
  });
}

type RestoreTarget = { kind: "anchor"; element: Element } | { kind: "fallback" };

async function findRestoreTarget(record: PositionRecord): Promise<RestoreTarget> {
  if (!record.anchor) return { kind: "fallback" };

  try {
    const el = document.querySelector(record.anchor.selector);
    if (el && isSimilarEnough(textFingerprintOf(el), record.anchor.textFingerprint)) {
      return { kind: "anchor", element: el };
    }
  } catch {
    // 不正なselectorは無視する
  }

  const scanned = scanForFingerprint(record.anchor.textFingerprint, 2000);
  if (scanned) return { kind: "anchor", element: scanned };

  const rescanned = await waitAndRescan(record.anchor.textFingerprint, RESCAN_MAX_WAIT_MS);
  if (rescanned) return { kind: "anchor", element: rescanned };

  return { kind: "fallback" };
}

function showToast(message: string): void {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.bottom = "16px";
  host.style.right = "16px";
  host.style.zIndex = "2147483647";
  const shadow = host.attachShadow({ mode: "closed" });
  const box = document.createElement("div");
  box.textContent = message;
  box.setAttribute("role", "status");
  box.style.background = "#111827";
  box.style.color = "#ffffff";
  box.style.padding = "8px 12px";
  box.style.borderRadius = "6px";
  box.style.fontFamily = "sans-serif";
  box.style.fontSize = "13px";
  box.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";
  shadow.appendChild(box);
  document.documentElement.appendChild(host);
  setTimeout(() => host.remove(), 2000);
}

async function restorePosition(record: PositionRecord): Promise<void> {
  const target = await findRestoreTarget(record);

  if (target.kind === "anchor") {
    const rect = target.element.getBoundingClientRect();
    const y = rect.top + window.scrollY + (record.anchor?.offsetFromElementTop ?? 0);
    window.scrollTo({ top: clampScroll(y), behavior: "auto" });
    showToast("前回の位置に戻りました");
  } else if (document.documentElement.scrollHeight > 0) {
    const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 0);
    window.scrollTo({ top: clampScroll(maxScroll * record.scrollRatio), behavior: "auto" });
    showToast("前回の位置に近い場所へ戻りました");
  } else {
    window.scrollTo({ top: clampScroll(record.scrollY), behavior: "auto" });
    showToast("前回の位置に近い場所へ戻りました");
  }

  // 復元成功時にもupdatedAtを更新する（Stage2で追加：読み返しただけの
  // ブックマークがLRUで先に消えるのを防ぐ）。
  void chrome.runtime
    .sendMessage({
      type: "SAVE_POSITION",
      origin: currentOrigin,
      record: { ...record, updatedAt: Date.now() },
    })
    .catch(() => undefined);

  lastSavedScrollY = window.scrollY;
  savingSuspended = false;
}

function showRestoreButton(record: PositionRecord): void {
  if (restoreButtonHost) return;

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.bottom = "16px";
  host.style.right = "16px";
  host.style.zIndex = "2147483647";
  const shadow = host.attachShadow({ mode: "closed" });

  const button = document.createElement("button");
  button.textContent = "前回の位置へ戻る";
  button.setAttribute("aria-label", "前回読んでいた位置へ戻る");
  button.style.padding = "10px 16px";
  button.style.borderRadius = "8px";
  button.style.border = "none";
  button.style.background = "#1d4ed8";
  button.style.color = "#ffffff";
  button.style.fontSize = "14px";
  button.style.cursor = "pointer";
  button.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";

  function dismiss(): void {
    window.removeEventListener("scroll", dismissOnScroll);
    window.removeEventListener("wheel", dismissOnScroll);
    window.removeEventListener("touchmove", dismissOnScroll);
    host.remove();
    restoreButtonHost = undefined;
  }

  function dismissOnScroll(): void {
    const delta = Math.abs(window.scrollY - record.scrollY);
    if (delta > DISMISS_THRESHOLD_PX) {
      savingSuspended = false;
      dismiss();
    }
  }

  button.addEventListener("click", () => {
    void (async () => {
      await restorePosition(record);
      dismiss();
    })();
  });

  shadow.appendChild(button);
  document.documentElement.appendChild(host);
  restoreButtonHost = host;

  window.addEventListener("scroll", dismissOnScroll, { passive: true });
  window.addEventListener("wheel", dismissOnScroll, { passive: true });
  window.addEventListener("touchmove", dismissOnScroll, { passive: true });
}

// targetCanonicalUrlは呼び出し開始時点のURLを固定するため引数として
// 明示的に受け取る。SPAでの高速な連続遷移時、await復帰後にURLが既に
// 変わっていれば黙って中断し、新しい遷移側が設定した状態
// （savingSuspended・restoreButtonHost等）を上書きしない（Stage5指摘で追加）。
async function checkExistingRecord(targetCanonicalUrl: string): Promise<void> {
  if (currentOrigin === null) return;

  let response: GetRecordResponse | undefined;
  try {
    response = (await chrome.runtime.sendMessage({
      type: "GET_RECORD",
      origin: currentOrigin,
      canonicalUrl: targetCanonicalUrl,
    })) as GetRecordResponse;
  } catch {
    return;
  }
  if (disposed || currentCanonicalUrl !== targetCanonicalUrl) return;
  const record = response?.record;
  if (!record) return;

  // 初回表示時の近い/遠い判定も、復元時と同じくMutationObserverベースの
  // 安定化待ちを経てから行う（Stage2で追加：レイアウト未確定のDOMに対して
  // 判定する非対称性を解消）。復元時のフォールバック再探索
  // （waitAndRescan）とは目的が異なる（こちらは最大1秒の静穏化待ちのみ）
  // ため、あえて別関数のままとしている。
  savingSuspended = true;
  await waitForDomSettled(SETTLE_WAIT_MS);
  if (disposed || currentCanonicalUrl !== targetCanonicalUrl) return;

  const distance = Math.abs(window.scrollY - record.scrollY);
  if (distance < NEAR_THRESHOLD_PX) {
    savingSuspended = false;
    return;
  }

  showRestoreButton(record);
}

function onUrlChanged(): void {
  const newCanonical = canonicalUrlOf(location.href);
  if (newCanonical === currentCanonicalUrl) return;
  currentCanonicalUrl = newCanonical;
  lastSavedScrollY = -1;
  if (restoreButtonHost) {
    restoreButtonHost.remove();
    restoreButtonHost = undefined;
  }
  savingSuspended = false;
  if (currentCanonicalUrl !== null) {
    void checkExistingRecord(currentCanonicalUrl);
  }
}

function onRuntimeMessage(message: StopTrackingMessage): void {
  if (message.type === "STOP_TRACKING") {
    dispose();
  }
}

function dispose(): void {
  disposed = true;
  window.removeEventListener("scroll", onScroll);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("pagehide", onPageHide);
  window.removeEventListener("popstate", onUrlChanged);
  window.removeEventListener("hashchange", onUrlChanged);
  chrome.runtime.onMessage.removeListener(onRuntimeMessage);
  if (periodicTimer !== undefined) clearInterval(periodicTimer);
  if (scrollDebounceTimer !== undefined) clearTimeout(scrollDebounceTimer);
  if (urlPollTimer !== undefined) clearInterval(urlPollTimer);
  if (restoreButtonHost) {
    restoreButtonHost.remove();
    restoreButtonHost = undefined;
  }
}

async function init(): Promise<void> {
  currentCanonicalUrl = canonicalUrlOf(location.href);
  currentOrigin = originOf(location.href);
  if (currentCanonicalUrl === null || currentOrigin === null) return;

  // Chrome拡張のマッチパターンはポート番号を表現できないため、
  // registerContentScripts自体は同一ホスト名の別ポートにも注入され得る
  // （監査で発見：例えばexample.com:8443を有効化すると、ユーザーが
  // 明示的に許可していないexample.com:9000にもスクリプトが注入される）。
  // SAVE_POSITION側は既にorigin完全一致（ポート込み）でチェックしている
  // ためデータの取り違えは起きないが、監視自体（scrollリスナー・
  // MutationObserver等）をユーザーが有効化していないポートで動かさない
  // よう、実行前に現在のオリジンが本当に有効かをここで自己チェックする。
  let status: GetOriginStatusResponse | undefined;
  try {
    status = (await chrome.runtime.sendMessage({
      type: "GET_ORIGIN_STATUS",
      origin: currentOrigin,
    })) as GetOriginStatusResponse;
  } catch {
    return;
  }
  if (!status?.enabled) return;

  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("popstate", onUrlChanged);
  window.addEventListener("hashchange", onUrlChanged);
  periodicTimer = setInterval(() => {
    void saveNow();
  }, PERIODIC_SAVE_MS);
  urlPollTimer = setInterval(onUrlChanged, 1000);
  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  void checkExistingRecord(currentCanonicalUrl);
}

void init();
