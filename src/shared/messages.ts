import type { PositionRecord } from "./types";

export interface SavePositionRequest {
  type: "SAVE_POSITION";
  origin: string;
  record: PositionRecord;
}

export interface GetRecordRequest {
  type: "GET_RECORD";
  origin: string;
  canonicalUrl: string;
}

export interface GetRecordResponse {
  record: PositionRecord | null;
}

// background -> content。無効化時に該当オリジンの全タブへブロードキャストする
// （Stage2で追加：unregisterContentScriptsは将来のナビゲーションにしか
// 効かないため、既に実行中のcontent scriptを即座に止めるには必須）。
export interface StopTrackingMessage {
  type: "STOP_TRACKING";
}

export interface GetOriginStatusRequest {
  type: "GET_ORIGIN_STATUS";
  origin: string;
}

export interface GetOriginStatusResponse {
  enabled: boolean;
}

export interface EnableOriginRequest {
  type: "ENABLE_ORIGIN";
  origin: string;
  tabId: number;
}

export interface DisableOriginRequest {
  type: "DISABLE_ORIGIN";
  origin: string;
}

export interface DeleteRecordRequest {
  type: "DELETE_RECORD";
  canonicalUrl: string;
}

export interface DeleteAllRequest {
  type: "DELETE_ALL";
}

export type PopupRequest =
  | GetOriginStatusRequest
  | EnableOriginRequest
  | DisableOriginRequest
  | DeleteRecordRequest
  | DeleteAllRequest;

export type ActionResponse = { ok: true } | { ok: false; reason: string };

export type ContentRequest = SavePositionRequest | GetRecordRequest;

export type Request = PopupRequest | ContentRequest;
