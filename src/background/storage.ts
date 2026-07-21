import { emptyState, MAX_RECORDS, MAX_TOTAL_BYTES, TTL_MS, type PositionRecord, type StoreState } from "../shared/types";

const STORAGE_KEY = "readingPositionState";

let writeQueue: Promise<unknown> = Promise.resolve();

export function enqueueTask<T>(task: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(task, task);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function loadState(): Promise<StoreState> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const raw = stored[STORAGE_KEY] as StoreState | undefined;
  if (raw === undefined) return emptyState();
  if (raw.schemaVersion !== 1) return emptyState();
  return raw;
}

// 保存済みデータが存在するにも関わらずschemaVersionが未知の場合を検出する。
// reconcileOrigins()はこれを見て破壊的な孤児削除処理をスキップする
// （loadState()は未知schemaを「空」として返すため、区別せずにreconcileすると
// 実際には有効だった権限・登録済みスクリプトを孤児と誤判定して全削除
// してしまう。将来schemaVersionを上げる際、対応するマイグレーションが
// 実装されるまでの安全装置）。
export async function hasUnrecognizedSchema(): Promise<boolean> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const raw = stored[STORAGE_KEY] as StoreState | undefined;
  return raw !== undefined && raw.schemaVersion !== 1;
}

export async function saveState(state: StoreState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function estimateBytes(state: StoreState): number {
  return new TextEncoder().encode(JSON.stringify(state)).length;
}

// 500件・4MiB上限・90日TTLでLRU削除する（凍結設計どおり）。
export function evictIfNeeded(state: StoreState, now: number): void {
  for (const [key, record] of Object.entries(state.records)) {
    if (now - record.updatedAt >= TTL_MS) {
      delete state.records[key];
    }
  }

  let entries = Object.entries(state.records).sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  while (entries.length > MAX_RECORDS) {
    const oldest = entries.shift();
    if (oldest) delete state.records[oldest[0]];
  }

  while (estimateBytes(state) > MAX_TOTAL_BYTES && entries.length > 0) {
    const oldest = entries.shift();
    if (oldest) delete state.records[oldest[0]];
  }
}

export async function upsertRecord(canonicalUrl: string, record: PositionRecord): Promise<void> {
  const state = await loadState();
  state.records[canonicalUrl] = record;
  // エビクション基準時刻はDate.now()を使う（Stage5指摘で修正：保存対象
  // レコード自身のupdatedAtを「現在時刻」として使うのは意味的に別概念を
  // 混同しており、将来的なバグの温床になり得るため）。
  evictIfNeeded(state, Date.now());
  try {
    await saveState(state);
  } catch {
    // quotaエラー時は古い20件を追加削除して1回だけ再試行する（凍結設計どおり）。
    const entries = Object.entries(state.records).sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (const [key] of entries.slice(0, 20)) {
      delete state.records[key];
    }
    await saveState(state);
  }
}

// TTLを書き込み時だけでなく読み出し時にも適用する（Stage5指摘で追加：
// 旧実装はupsert時のみエビクションしていたため、90日を超えたレコードが
// 次の書き込みが起きるまでGET_RECORDで返り続け得た）。
export async function getRecord(canonicalUrl: string): Promise<PositionRecord | undefined> {
  const state = await loadState();
  const record = state.records[canonicalUrl];
  if (!record) return undefined;
  if (Date.now() - record.updatedAt >= TTL_MS) {
    // 削除はenqueueTaskで直列化し、他の書き込みとの競合（ロストアップデート）
    // を防ぐ。
    await enqueueTask(async () => {
      const latest = await loadState();
      delete latest.records[canonicalUrl];
      await saveState(latest);
    });
    return undefined;
  }
  return record;
}

export async function deleteRecord(canonicalUrl: string): Promise<void> {
  const state = await loadState();
  delete state.records[canonicalUrl];
  await saveState(state);
}

export async function deleteAllRecords(): Promise<void> {
  const state = await loadState();
  state.records = {};
  await saveState(state);
}

// オリジン無効化時、当該オリジンの既存レコードをすべて削除する
// （Stage2で確定：「無効化＝このサイトの追跡をやめる」という
// ユーザーの合理的期待に合わせる）。
export async function deleteRecordsForOrigin(origin: string): Promise<void> {
  const state = await loadState();
  for (const [key, record] of Object.entries(state.records)) {
    if (record.origin === origin) delete state.records[key];
  }
  await saveState(state);
}
