import { describe, expect, it } from "vitest";
import chrome from "sinon-chrome";
import { getRecord, upsertRecord } from "../../src/background/storage";
import { TTL_MS, type PositionRecord } from "../../src/shared/types";

function fakeRecord(canonicalUrl: string, updatedAt: number): PositionRecord {
  return {
    schemaVersion: 1,
    canonicalUrl,
    origin: "https://example.com",
    scrollY: 100,
    scrollRatio: 0.1,
    documentHeight: 1000,
    viewportHeight: 800,
    updatedAt,
  };
}

describe("getRecord: 読み出し時のTTL適用", () => {
  it("90日を超えたレコードはnullを返し、storageからも削除する（Stage5指摘で追加）", async () => {
    // upsertRecord経由だと書き込み時点のevictIfNeededで即座に削除されて
    // しまうため、getRecord単体のTTLチェックを検証するには直接storageへ
    // 期限切れレコードを仕込む必要がある。
    const expired = fakeRecord("https://example.com/a", Date.now() - TTL_MS - 1000);
    await chrome.storage.local.set({
      readingPositionState: {
        schemaVersion: 1,
        enabledOrigins: [],
        records: { [expired.canonicalUrl]: expired },
      },
    });

    const result = await getRecord(expired.canonicalUrl);
    expect(result).toBeUndefined();

    const stored = (await chrome.storage.local.get("readingPositionState")) as {
      readingPositionState: { records: Record<string, PositionRecord> };
    };
    expect(stored.readingPositionState.records[expired.canonicalUrl]).toBeUndefined();
  });

  it("90日未満のレコードはそのまま返す", async () => {
    const fresh = fakeRecord("https://example.com/b", Date.now() - 1000);
    await upsertRecord(fresh.canonicalUrl, fresh);

    const result = await getRecord(fresh.canonicalUrl);
    expect(result?.canonicalUrl).toBe(fresh.canonicalUrl);
  });
});

describe("upsertRecord: quotaエラー時のフォールバック", () => {
  it("初回保存がquotaエラーになった場合、古い20件を削除して1回だけ再試行する", async () => {
    const now = Date.now();
    for (let i = 0; i < 25; i++) {
      await upsertRecord(
        `https://example.com/old-${i}`,
        fakeRecord(`https://example.com/old-${i}`, now - (25 - i) * 1000),
      );
    }

    // setのフェイクを一時的に差し替え、1回目の保存だけquotaエラーにする。
    let callCount = 0;
    chrome.storage.local.set.callsFake(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.reject(new Error("QUOTA_BYTES exceeded"));
      }
      return Promise.resolve();
    });

    await expect(
      upsertRecord("https://example.com/new", fakeRecord("https://example.com/new", now)),
    ).resolves.toBeUndefined();
    expect(callCount).toBe(2);
  });
});
