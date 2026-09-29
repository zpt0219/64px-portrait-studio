/**
 * 入口：创建 App。URL 带 ?debug 时把 App 挂到 window.__studio，供自动化脚本直接调用 ViewModel
 * (对应 tile_map_editor_imgui 的 --headless 命令模式)。
 */

import { App } from './app/app';

declare global {
  interface Window {
    __studio?: App;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  if (new URLSearchParams(location.search).has('debug')) window.__studio = app;
});
