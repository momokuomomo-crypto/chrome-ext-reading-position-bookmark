# ai-build-council 実行記録：読み終わり位置ブックマーク

- run-id: `20260721-1735-reading-position-bookmark`
- 対象リポジトリ: `chrome-ext-reading-position-bookmark`
- ワークフロー: Stage0〜Stage7（design→review→implementation→Test Gate A→
  独立実装レビュー×2（Codex CLI＋Claude Agent、並列）→指摘処理・
  Test Gate B→commit/push）

## 概要

長文記事のスクロール位置を、ユーザーが明示的に有効化したオリジンにのみ
記憶し、「前回の位置へ戻る」ボタンを表示するChrome拡張機能（Manifest V3）。
`optional_host_permissions`によるオリジン単位のオプトイン、DOMアンカー
（selector＋テキスト指紋）→スクロール比率→ピクセル位置のフォールバック
チェーンによる位置復元、500件/4MiB/90日TTLでのLRU削除を実装した。

## テスト結果

- Test Gate A（Stage4）：全テスト成功、tsc・eslint・vite build成功
- Test Gate B（Stage6後）：56/56件成功、tsc・eslint・vite build成功
  （ログ: `.ai-build-council/runs/20260721-1735-reading-position-bookmark/tests/gate-b/unit.log`）
- ビルド後`dist/manifest.json`の`web_accessible_resources`が、CRXJSの
  `?script`インポートにより実際のハッシュ付きファイル名で正しく
  自動生成されることを確認済み。

## Stage5 独立実装レビューと対応

固定diff（`review/implementation-review/input.patch`）に対し、Codex CLI
（新規セッション）とClaude Agent（isolated context）の2系統で並列レビュー
を実施した。両者とも「要修正」判定。指摘の詳細な検証・裁定は
[decisions/stage5-implementation-review-decisions.md](../../.ai-build-council/runs/20260721-1735-reading-position-bookmark/decisions/stage5-implementation-review-decisions.md)
に記録した。

主な修正内容：

- 無効化時、`tabs.query({url})`を`permissions.remove()`より**先に**実行
  するよう順序を修正（権限解除後はURL照会が機能しない可能性への対処）
- `reconcileOrigins()`を、storageに存在しない孤児権限・孤児登録スクリプト
  も検知・解消する真の双方向3者照合に変更
- `SAVE_POSITION`ハンドラに`ensureReconciled()`呼び出しを追加
- 保存と無効化のTOCTOU競合を、enabled判定と書き込みを同一`enqueueTask`
  内に統合して解消
- `chrome.permissions.onRemoved`リスナーを`enqueueTask`で直列化し、通常の
  無効化と同じ後片付け（`STOP_TRACKING`ブロードキャスト・レコード削除）
  を行うよう変更
- 有効化ロールバックを、登録成功後のstorage書き込み失敗時にも機能する
  よう強化
- TTL（90日）を書き込み時だけでなく読み出し時にも適用するよう修正
- 固定/スティッキー要素しか候補が無い場合のアンカーフォールバックを、
  除外前候補への復帰から「アンカー無し（比率/ピクセルへ委ねる）」に変更
- SPA高速連続遷移時の状態取り違えを、`checkExistingRecord`の対象URL
  明示的固定・再検証で解消
- ポート付きオリジン（`https://example.com:8443`等）でのマッチパターン
  生成を、Chrome拡張のマッチパターン仕様（ポート非対応）に合わせて修正

WontFix（設計どおり、または低リスクと判断）とした指摘、既知の限界として
許容した項目も同ファイルに理由付きで記録済み。

## 未解決事項・既知の限界

- 同一ホストの異なるポートを個別に有効化した場合、content scriptが
  重複登録される既知の限界がある（利用頻度は稀と想定、詳細は
  decisions参照）。
- `src/content/index.ts`本体オーケストレーションの直接統合テストは
  未整備（低優先度として次回以降に持ち越し）。
- E2E（実Chromeでの手動スモークテスト）は本runでは未実施。ストア公開前に
  固定ヘッダー付き長文ページ・マルチタブでの無効化・Chrome再起動を含む
  手動確認を推奨する。
