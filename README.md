# 読み終わり位置ブックマーク

長文記事のスクロール位置を記憶し、「前回の位置へ戻る」ボタンを表示する
Chrome拡張機能（Manifest V3）。

[ai-council v2](https://github.com/momokuomomo-crypto/ai-council_v2)の
会合で検討・承認された
[稟議書](https://github.com/momokuomomo-crypto/ai-council-output/blob/master/chrome-extension-ideas/稟議書_Chrome拡張機能アイデア.md)
をもとに、
[ai-build-council](https://github.com/momokuomomo-crypto/ai-build-council)
のワークフローで設計・実装した。

## 主な機能

- ユーザーが明示的に有効化したサイトにだけ、動的content scriptを登録
  （`optional_host_permissions`によるオリジン単位のオプトイン。常駐
  content_script・広範なhost_permissionsは使わない）
- スクロール位置は「DOMアンカー（selector＋テキスト指紋）→スクロール
  比率→ピクセル位置」の3段フォールバックで保存・復元する
- 固定/スティッキーヘッダーをアンカー候補から除外し、判定不能な場合は
  比率フォールバックへ委ねる
- 500件／4MiB／90日TTLでLRU削除。復元成功時は`updatedAt`を更新し、
  読み返しただけのブックマークが先に消えないようにする
- ポップアップから有効化/無効化・個別削除/全削除を操作

## セットアップ

```bash
npm install
npm run build
```

`chrome://extensions` でデベロッパーモードを有効にし、
「パッケージ化されていない拡張機能を読み込む」で`dist/`を選択する。

## 開発

```bash
npm run dev         # 開発用ビルド（watch）
npm run typecheck
npm run lint
npm run test         # 単体・統合テスト（Vitest, sinon-chrome）
npm run build        # 本番ビルド
```

## ディレクトリ構成

```
src/
  background/
    index.ts             # Service Worker（メッセージ処理）
    origin-manager.ts     # オプトイン・有効化/無効化・3者照合
    storage.ts             # 位置レコードの永続化・LRU/TTL削除
  content/
    anchor.ts              # DOMアンカー候補の選定（固定/スティッキー除外）
    index.ts                 # スクロール監視・保存・復元のオーケストレーション
  popup/                     # ツールバーpopup UI
  shared/
    selector.ts               # 安定したCSSセレクタ生成
    similarity.ts              # テキスト指紋の類似度判定（Levenshtein）
    url.ts, types.ts, messages.ts
tests/
  unit/                        # 純粋関数の単体テスト（Vitest）
  integration/                 # background/popupの統合テスト（sinon-chrome）
```

## 収益化方法

無料版で提供。Pro版で複数地点・同期を提供する。

## 将来の拡張案

- 読了率
- ハイライト

出典：[稟議書_Chrome拡張機能アイデア.md（項目11）](https://github.com/momokuomomo-crypto/ai-council-output/blob/master/chrome-extension-ideas/稟議書_Chrome拡張機能アイデア.md)

## 開発の経緯

[ai-build-council](https://github.com/momokuomomo-crypto/ai-build-council)
のゲート付きワークフロー（独立設計→設計査読→実装→テスト→固定diffの
独立実装レビュー→修正→記録）で設計・実装した。C-11〜C-14は同じ
オリジン単位オプトインアーキテクチャを共有しており、以降のC-12・C-14へ
教訓を持ち越している。

実装レビュー（Codex CLI＋Claude Agent並列）で、無効化時の全タブ
ブロードキャストが権限取り消し後に実行され機能しない可能性、
`reconcileOrigins()`が真の3者照合になっていない（storageに無い孤児
権限・孤児登録スクリプトを検知できない）、保存とオリジン無効化の間の
TOCTOU競合（判定後・書き込み前に無効化されるとレコードが復活し得る）、
固定/スティッキー要素しか候補が無い場合に除外前の要素へフォールバック
してしまう不具合などを発見し、いずれも修正した。CRXJSの`?script`
インポートで動的content scriptのビルド後パスを解決する手法もこの
リポジトリで確立し、以降のC-12・C-14でも踏襲している。
