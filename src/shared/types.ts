export interface PositionRecord {
  schemaVersion: 1;
  canonicalUrl: string;
  origin: string;
  scrollY: number;
  scrollRatio: number;
  documentHeight: number;
  viewportHeight: number;
  anchor?: {
    selector: string;
    textFingerprint: string;
    offsetFromElementTop: number;
  };
  updatedAt: number;
}

export interface StoreState {
  schemaVersion: 1;
  records: Record<string, PositionRecord>;
  enabledOrigins: string[];
}

export function emptyState(): StoreState {
  return { schemaVersion: 1, records: {}, enabledOrigins: [] };
}

export const MAX_RECORDS = 500;
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
export const TTL_MS = 90 * 24 * 60 * 60 * 1000;
