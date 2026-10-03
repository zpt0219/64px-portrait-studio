/**
 * 画布底部悬停与交互状态条组件
 */

import { RectSelection } from '../../types';

export class HoverInfoBar {
  private coordTag: HTMLElement;
  private colorChip: HTMLElement;
  private hoverText: HTMLElement;
  private zoneChip: HTMLElement;
  private hintSpan: HTMLElement;
  private extraSpan: HTMLElement;

  constructor(private readonly container: HTMLElement) {
    this.container.innerHTML = `
      <span class="coord-tag" id="hib-coord-tag">X: -- Y: --</span>
      <span class="hover-color-chip" id="hib-color-chip" style="display:none; width:12px; height:12px; border-radius:3px;"></span>
      <span class="hover-text" id="hib-hover-text" style="display:none;"></span>
      <span class="hover-zone-chip" id="hib-zone-chip" style="display:none;"></span>
      <span class="hover-hint" id="hib-hint-span" style="display:none; opacity: 0.6; font-size: 11px;"></span>
      <span class="hover-extra" id="hib-extra-span" style="display:none;"></span>
    `;
    this.coordTag = this.container.querySelector('#hib-coord-tag')!;
    this.colorChip = this.container.querySelector('#hib-color-chip')!;
    this.hoverText = this.container.querySelector('#hib-hover-text')!;
    this.zoneChip = this.container.querySelector('#hib-zone-chip')!;
    this.hintSpan = this.container.querySelector('#hib-hint-span')!;
    this.extraSpan = this.container.querySelector('#hib-extra-span')!;
  }

  showMoving(offset: [number, number], isCopy: boolean): void {
    const [dx, dy] = offset;
    this.coordTag.className = 'coord-tag';
    this.coordTag.removeAttribute('style');
    this.coordTag.innerHTML = `偏移: <b>ΔX:${dx >= 0 ? '+' + dx : dx} ΔY:${dy >= 0 ? '+' + dy : dy}</b>`;

    this.colorChip.style.display = 'none';

    this.hoverText.style.display = '';
    this.hoverText.textContent = isCopy ? '📋 复制模式 (+Ctrl 原位保留)' : '✂️ 平移模式 (原位透明)';
    this.hoverText.style.color = isCopy ? '#10B981' : '#00E5FF';
    this.hoverText.style.fontWeight = '600';

    this.zoneChip.style.display = 'none';

    this.hintSpan.style.display = '';
    this.hintSpan.textContent = '[按住 Ctrl/Alt 切换复制]';
    this.hintSpan.removeAttribute('style');
    this.hintSpan.style.opacity = '0.6';
    this.hintSpan.style.fontSize = '11px';

    this.extraSpan.style.display = 'none';
    this.extraSpan.innerHTML = '';
  }

  showBoxSelect(
    r: RectSelection,
    maskAction: 'add' | 'remove' | 'subtract' | 'clear' | null,
    zoneColor: string = '#38bdf8'
  ): void {
    this.colorChip.style.display = 'none';
    this.zoneChip.style.display = 'none';
    this.extraSpan.style.display = 'none';
    this.extraSpan.innerHTML = '';

    if (maskAction === 'clear') {
      this.coordTag.className = 'coord-tag';
      this.coordTag.style.background = 'rgba(239, 68, 68, 0.25)';
      this.coordTag.style.color = '#f87171';
      this.coordTag.style.border = '1px solid rgba(239, 68, 68, 0.45)';
      this.coordTag.textContent = '🧹 清空遮罩 (右键)';

      this.hoverText.style.display = '';
      this.hoverText.style.color = '#f87171';
      this.hoverText.style.fontWeight = '600';
      this.hoverText.textContent = `框选: (${r.x}, ${r.y}) 尺寸: ${r.w}×${r.h}`;

      this.hintSpan.style.display = '';
      this.hintSpan.style.opacity = '0.85';
      this.hintSpan.style.fontSize = '11px';
      this.hintSpan.style.color = '#fca5a5';
      this.hintSpan.textContent = '[去所有颜色: 清除框内当前遮罩]';
      return;
    }
    if (maskAction === 'subtract') {
      this.coordTag.className = 'coord-tag';
      this.coordTag.style.background = 'rgba(239, 68, 68, 0.25)';
      this.coordTag.style.color = '#f87171';
      this.coordTag.style.border = '1px solid rgba(239, 68, 68, 0.45)';
      this.coordTag.textContent = '⚡ 去杂色模式 (Shift+左键)';

      this.hoverText.style.display = '';
      this.hoverText.style.color = '#f87171';
      this.hoverText.style.fontWeight = '600';
      this.hoverText.textContent = `框选: (${r.x}, ${r.y}) 尺寸: ${r.w}×${r.h}`;

      this.hintSpan.style.display = '';
      this.hintSpan.style.opacity = '0.85';
      this.hintSpan.style.fontSize = '11px';
      this.hintSpan.style.color = '#fca5a5';
      this.hintSpan.textContent = '[删除框内所有非匹配色遮罩]';
      return;
    }
    if (maskAction === 'remove') {
      this.coordTag.className = 'coord-tag';
      this.coordTag.style.background = 'rgba(239, 68, 68, 0.25)';
      this.coordTag.style.color = '#f87171';
      this.coordTag.style.border = '1px solid rgba(239, 68, 68, 0.45)';
      this.coordTag.textContent = '✂️ 去匹配色 (Alt+左键)';

      this.hoverText.style.display = '';
      this.hoverText.style.color = '#f87171';
      this.hoverText.style.fontWeight = '600';
      this.hoverText.textContent = `框选: (${r.x}, ${r.y}) 尺寸: ${r.w}×${r.h}`;

      this.hintSpan.style.display = '';
      this.hintSpan.style.opacity = '0.85';
      this.hintSpan.style.fontSize = '11px';
      this.hintSpan.style.color = '#fca5a5';
      this.hintSpan.textContent = '[删除框内当前匹配色遮罩]';
      return;
    }
    if (maskAction === 'add') {
      this.coordTag.className = 'coord-tag';
      this.coordTag.style.background = 'rgba(56, 189, 248, 0.2)';
      this.coordTag.style.color = zoneColor;
      this.coordTag.style.border = '';
      this.coordTag.textContent = '🔲 匹配色划入 (左键)';

      this.hoverText.style.display = '';
      this.hoverText.style.color = zoneColor;
      this.hoverText.style.fontWeight = '600';
      this.hoverText.textContent = `框选: (${r.x}, ${r.y}) 尺寸: ${r.w}×${r.h}`;

      this.hintSpan.style.display = '';
      this.hintSpan.style.opacity = '0.85';
      this.hintSpan.style.fontSize = '11px';
      this.hintSpan.style.color = '#94a3b8';
      this.hintSpan.textContent = '[Shift去杂色 / Alt去匹配色 / 右键去所有色]';
      return;
    }
    this.coordTag.className = 'coord-tag';
    this.coordTag.removeAttribute('style');
    this.coordTag.innerHTML = `框选: <b>(${r.x}, ${r.y})</b>`;

    this.hoverText.style.display = '';
    this.hoverText.style.color = '#C084FC';
    this.hoverText.style.fontWeight = '600';
    this.hoverText.textContent = `尺寸: ${r.w}×${r.h}`;

    this.hintSpan.style.display = 'none';
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
    this.coordTag.className = 'coord-tag';
    this.coordTag.removeAttribute('style');
    this.coordTag.innerHTML = `X: <b>${x.toString().padStart(2, '0')}</b> Y: <b>${y.toString().padStart(2, '0')}</b>`;

    this.colorChip.style.display = 'inline-block';
    this.colorChip.className = isTrans ? 'hover-color-chip slot-transparent' : 'hover-color-chip';
    this.colorChip.style.backgroundColor = isTrans ? '' : colorHex;
    this.colorChip.title = isTrans ? '透明/已删除像素' : colorHex;

    this.hoverText.style.display = '';
    this.hoverText.style.color = isTrans ? '#38bdf8' : '';
    this.hoverText.style.fontWeight = isTrans ? '600' : '';
    this.hoverText.textContent = isTrans ? '[透明/已删除]' : `${colorHex} [#${colorIdx}]`;

    this.zoneChip.style.display = 'inline-block';
    this.zoneChip.style.borderLeft = `4px solid ${zoneMeta.color}`;
    this.zoneChip.textContent = zoneMeta.name;

    this.hintSpan.style.display = 'none';

    if (selectionExtra) {
      this.extraSpan.style.display = '';
      this.extraSpan.innerHTML = selectionExtra;
    } else {
      this.extraSpan.style.display = 'none';
      this.extraSpan.innerHTML = '';
    }
  }

  clear(): void {
    this.coordTag.className = 'coord-tag';
    this.coordTag.removeAttribute('style');
    this.coordTag.innerHTML = 'X: -- Y: --';
    this.colorChip.style.display = 'none';
    this.hoverText.style.display = 'none';
    this.zoneChip.style.display = 'none';
    this.hintSpan.style.display = 'none';
    this.extraSpan.style.display = 'none';
    this.extraSpan.innerHTML = '';
  }
}
