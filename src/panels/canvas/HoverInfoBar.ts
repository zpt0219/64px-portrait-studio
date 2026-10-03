/**
 * 画布底部悬停与交互状态条组件
 */

import { RectSelection } from '../../types';

export class HoverInfoBar {
  constructor(private readonly container: HTMLElement) {
    this.clear();
  }

  showMoving(offset: [number, number], isCopy: boolean): void {
    const [dx, dy] = offset;
    const modeText = isCopy ? '📋 复制模式 (+Ctrl 原位保留)' : '✂️ 平移模式 (原位透明)';
    this.container.innerHTML = `
      <span class="coord-tag">偏移: <b>ΔX:${dx >= 0 ? '+' + dx : dx} ΔY:${dy >= 0 ? '+' + dy : dy}</b></span>
      <span class="hover-text" style="color: ${isCopy ? '#10B981' : '#00E5FF'}; font-weight: 600;">${modeText}</span>
      <span style="opacity: 0.6; font-size: 11px;">[按住 Ctrl/Alt 切换复制]</span>
    `;
  }

  showBoxSelect(
    r: RectSelection,
    maskAction: 'add' | 'remove' | 'subtract' | 'clear' | null,
    zoneColor: string = '#38bdf8'
  ): void {
    if (maskAction === 'clear') {
      this.container.innerHTML = `
        <span class="coord-tag" style="background: rgba(239, 68, 68, 0.25); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.45);">🧹 清空遮罩 (右键)</span>
        <span class="hover-text" style="color: #f87171; font-weight: 600;">框选: (${r.x}, ${r.y}) 尺寸: ${r.w}×${r.h}</span>
        <span style="opacity: 0.85; font-size: 11px; color: #fca5a5;">[去所有颜色: 清除框内当前遮罩]</span>
      `;
      return;
    }
    if (maskAction === 'subtract') {
      this.container.innerHTML = `
        <span class="coord-tag" style="background: rgba(239, 68, 68, 0.25); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.45);">⚡ 去杂色模式 (Shift+左键)</span>
        <span class="hover-text" style="color: #f87171; font-weight: 600;">框选: (${r.x}, ${r.y}) 尺寸: ${r.w}×${r.h}</span>
        <span style="opacity: 0.85; font-size: 11px; color: #fca5a5;">[删除框内所有非匹配色遮罩]</span>
      `;
      return;
    }
    if (maskAction === 'remove') {
      this.container.innerHTML = `
        <span class="coord-tag" style="background: rgba(239, 68, 68, 0.25); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.45);">✂️ 去匹配色 (Alt+左键)</span>
        <span class="hover-text" style="color: #f87171; font-weight: 600;">框选: (${r.x}, ${r.y}) 尺寸: ${r.w}×${r.h}</span>
        <span style="opacity: 0.85; font-size: 11px; color: #fca5a5;">[删除框内当前匹配色遮罩]</span>
      `;
      return;
    }
    if (maskAction === 'add') {
      this.container.innerHTML = `
        <span class="coord-tag" style="background: rgba(56, 189, 248, 0.2); color: ${zoneColor};">🔲 匹配色划入 (左键)</span>
        <span class="hover-text" style="color: ${zoneColor}; font-weight: 600;">框选: (${r.x}, ${r.y}) 尺寸: ${r.w}×${r.h}</span>
        <span style="opacity: 0.85; font-size: 11px; color: #94a3b8;">[Shift去杂色 / Alt去匹配色 / 右键去所有色]</span>
      `;
      return;
    }
    this.container.innerHTML = `
      <span class="coord-tag">框选: <b>(${r.x}, ${r.y})</b></span>
      <span class="hover-text" style="color: #C084FC; font-weight: 600;">尺寸: ${r.w}×${r.h}</span>
    `;
  }

  showPixel(
    x: number,
    y: number,
    colorIdx: number,
    colorHex: string,
    isTrans: boolean,
    zoneMeta: { color: string; name: string },
    selectionExtra: string = ''
  ): void {
    const colorChipHtml = isTrans
      ? `<span class="hover-color-chip slot-transparent" style="width:12px; height:12px; border-radius:3px; display:inline-block;" title="透明/已删除像素"></span>`
      : `<span class="hover-color-chip" style="background-color: ${colorHex};" title="${colorHex}"></span>`;
    const colorTextHtml = isTrans
      ? `<span class="hover-text" style="color: #38bdf8; font-weight: 600;">[透明/已删除]</span>`
      : `<span class="hover-text">${colorHex} [#${colorIdx}]</span>`;

    this.container.innerHTML = `
      <span class="coord-tag">X: <b>${x.toString().padStart(2, '0')}</b> Y: <b>${y.toString().padStart(2, '0')}</b></span>
      ${colorChipHtml}
      ${colorTextHtml}
      <span class="hover-zone-chip" style="border-left: 4px solid ${zoneMeta.color};">${zoneMeta.name}</span>
      ${selectionExtra}
    `;
  }

  clear(): void {
    this.container.innerHTML = `<span>X: -- Y: --</span>`;
  }
}
