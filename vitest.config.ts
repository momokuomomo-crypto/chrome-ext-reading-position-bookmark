import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// crx({ manifest }) を使うvite.config.tsとは別に、テスト専用のvite設定を持つ。
// @crxjs/vite-pluginはマニフェスト/複数エントリポイントのビルド処理を行うため、
// テスト実行時には不要かつ干渉しうる。
//
// 本番コードは動的登録用content scriptのパス解決に`?script`インポート
// （CRXJSが提供）を使うが、CRXJSプラグイン自体はここに無いため、素の
// Viteはこのサフィックスを無視して実物のcontent/index.tsを本当に評価
// してしまう（=content scriptのinit()が実行され、テスト用のchrome.storage
// モックへ意図しない副作用が漏れる。chrome-ext-site-readability-presets
// の実装中に、backgroundテストがjsdomの既定URL"http://localhost:3000"宛の
// 意図しないstorage呼び出しで汚染される形で発覚した）。`?script`終わりの
// インポートを仮想モジュール（ただの文字列export）に差し替えて防ぐ。
const stubCrxjsScriptImports: Plugin = {
  name: "stub-crxjs-script-imports",
  // enforce: "pre"が必須（既定の順序だとvite-node内部のTS解決が先に
  // 走ってしまい、このプラグインのresolveIdへ到達する前にクエリ文字列
  // 抜きの実ファイルパスとして解決されてしまうため）。
  enforce: "pre",
  resolveId(id) {
    if (id.includes("?script")) {
      return `\0virtual:stub-script:${id}`;
    }
    return null;
  },
  load(id) {
    if (id.startsWith("\0virtual:stub-script:")) {
      return "export default '__stub_content_script.js';";
    }
    return null;
  },
};

export default defineConfig({
  plugins: [stubCrxjsScriptImports],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
  },
});
