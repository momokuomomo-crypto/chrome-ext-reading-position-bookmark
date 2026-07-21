import { describe, expect, it } from "vitest";
import { evictIfNeeded } from "../../src/background/storage";
import { MAX_RECORDS, MAX_TOTAL_BYTES, TTL_MS, type PositionRecord, type StoreState } from "../../src/shared/types";

function fakeRecord(canonicalUrl: string, updatedAt: number, textFingerprint = ""): PositionRecord {
  return {
    schemaVersion: 1,
    canonicalUrl,
    origin: "https://example.com",
    scrollY: 100,
    scrollRatio: 0.1,
    documentHeight: 1000,
    viewportHeight: 800,
    updatedAt,
    anchor: textFingerprint
      ? { selector: "p", textFingerprint, offsetFromElementTop: 0 }
      : undefined,
  };
}

describe("evictIfNeeded", () => {
  it("90日以上経過したレコードを削除する", () => {
    const now = Date.now();
    const state: StoreState = {
      schemaVersion: 1,
      enabledOrigins: [],
      records: {
        old: fakeRecord("old", now - TTL_MS - 1),
        fresh: fakeRecord("fresh", now - 1000),
      },
    };

    evictIfNeeded(state, now);

    expect(state.records.old).toBeUndefined();
    expect(state.records.fresh).toBeDefined();
  });

  it("ちょうど90日経過したレコードも削除する（境界値、Stage5指摘で>=に修正）", () => {
    const now = Date.now();
    const state: StoreState = {
      schemaVersion: 1,
      enabledOrigins: [],
      records: { exact: fakeRecord("exact", now - TTL_MS) },
    };

    evictIfNeeded(state, now);

    expect(state.records.exact).toBeUndefined();
  });

  it("500件未満でも4MiBを超えていれば最古のレコードから削除する", () => {
    const now = Date.now();
    const state: StoreState = { schemaVersion: 1, enabledOrigins: [], records: {} };
    // 500件未満（MAX_RECORDSによる件数エビクションが発動しない件数）で
    // かつ合計サイズが4MiBを超えるよう、1件あたり大きめの指紋文字列を使う。
    const bigFingerprint = "a".repeat(15000);
    const recordCount = 400;
    for (let i = 0; i < recordCount; i++) {
      state.records[`url-${i}`] = fakeRecord(`url-${i}`, now - (recordCount - i) * 1000, bigFingerprint);
    }
    const beforeBytes = new TextEncoder().encode(JSON.stringify(state)).length;
    expect(beforeBytes).toBeGreaterThan(MAX_TOTAL_BYTES);
    expect(recordCount).toBeLessThan(MAX_RECORDS);

    evictIfNeeded(state, now);

    const afterBytes = new TextEncoder().encode(JSON.stringify(state)).length;
    expect(afterBytes).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
    expect(state.records["url-0"]).toBeUndefined();
    expect(state.records[`url-${recordCount - 1}`]).toBeDefined();
  });

  it("500件を超えた場合、最古のレコードから削除する", () => {
    const now = Date.now();
    const state: StoreState = { schemaVersion: 1, enabledOrigins: [], records: {} };
    for (let i = 0; i < MAX_RECORDS + 1; i++) {
      state.records[`url-${i}`] = fakeRecord(`url-${i}`, now - (MAX_RECORDS + 1 - i) * 1000);
    }

    evictIfNeeded(state, now);

    expect(Object.keys(state.records)).toHaveLength(MAX_RECORDS);
    expect(state.records["url-0"]).toBeUndefined();
    expect(state.records[`url-${MAX_RECORDS}`]).toBeDefined();
  });

  it("上限未満なら何も削除しない", () => {
    const now = Date.now();
    const state: StoreState = {
      schemaVersion: 1,
      enabledOrigins: [],
      records: { a: fakeRecord("a", now) },
    };

    evictIfNeeded(state, now);

    expect(Object.keys(state.records)).toHaveLength(1);
  });
});
