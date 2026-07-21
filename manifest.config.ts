import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json";

export default defineManifest({
  manifest_version: 3,
  name: "読み終わり位置ブックマーク",
  description: "有効化したサイトでスクロール位置を記憶し、前回の位置へ戻れるようにします。",
  version: pkg.version,
  permissions: ["storage", "scripting", "activeTab"],
  optional_host_permissions: ["http://*/*", "https://*/*"],
  icons: { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" },
  action: {
    default_popup: "src/popup/index.html",
    default_icon: { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" },
  },
  background: { service_worker: "src/background/index.ts", type: "module" },
});
