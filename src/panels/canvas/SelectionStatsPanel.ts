/**
 * 选区颜色统计浮动面板：列出选区内各色板颜色的像素数与占比。
 * 左键行 → 设为前景色，右键 → 设为背景色，悬停 → 在画布上高亮该颜色。
 */

import { RectSelection } from '../../types';
import { PortraitDocument } from '../../model/document';
import { EditorSession } from '../../model/session';
import { TRANSPARENT_INDEX, WHITE_PALETTE_INDEX } from '../../data/palette';
import { IMAGE_WIDTH as W } from '../../core/pixelGrid';

interface SelectionStatsCallbacks {
  onColorPick: (paletteIndex: number, isBackground: boolean) => void;
  onHighlight: (paletteIndex: number | null) => void;
}

interface ColorStat {
  index: number;
  count: number;
  percentage: number;
}

/** 选区内各颜色的像素数，按色板顺序排列，透明色排最后 */
function selectionColorStats(pixels: Uint8Array, sel: RectSelection): ColorStat[] {
  const counts = new Map<number, number>();
  let total = 0;
  for (let y = sel.y; y < sel.y + sel.h; y++) {
    for (let x = sel.x; x < sel.x + sel.w; x++) {
      const colorIdx = pixels[y * W + x];
      counts.set(colorIdx, (counts.get(colorIdx) || 0) + 1);
      total++;
    }
  }
  return Array.from(counts.entries())
    .sort(([a], [b]) => a - b) // TRANSPARENT_INDEX = 255 自然排在最后
    .map(([index, count]) => ({ index, count, percentage: (count / total) * 100 }));
}

export class SelectionStatsPanel {
  constructor(private el: HTMLElement, callbacks: SelectionStatsCallbacks) {
    // 阻止事件穿透到下方画布，避免误绘制
    for (const type of ['pointerdown', 'mousedown', 'mouseup']) {
      el.addEventListener(type, (e) => e.stopPropagation());
    }
    el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

    const rowIndex = (e: Event): number | null => {
      const row = (e.target as HTMLElement).closest('.stats-color-row');
      const idx = row ? parseInt(row.getAttribute('data-index') ?? '', 10) : NaN;
      return isNaN(idx) ? null : idx;
    };

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = rowIndex(e);
      if (idx !== null) callbacks.onColorPick(idx, false);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = rowIndex(e);
      if (idx !== null) callbacks.onColorPick(idx, true);
    });
    el.addEventListener('mouseover', (e) => callbacks.onHighlight(rowIndex(e)));
    el.addEventListener('mouseleave', () => callbacks.onHighlight(null));
  }

  public update(doc: PortraitDocument, session: EditorSession, selection: RectSelection | null): void {
    const stats = selection ? selectionColorStats(doc.pixelIndices, selection) : [];
    if (stats.length === 0) {
      this.el.style.display = 'none';
      this.el.innerHTML = '';
      return;
    }

    const totalPixels = stats.reduce((sum, s) => sum + s.count, 0);
    const rowsHtml = stats
      .map((stat) => {
        const isTransparent = stat.index === TRANSPARENT_INDEX;
        const hex = isTransparent ? '' : doc.palette[stat.index] || '#000000';
        const idxLabel = isTransparent ? '#透' : `#${stat.index.toString().padStart(2, '0')}`;
        const pct = stat.percentage.toFixed(stat.percentage >= 1 ? 1 : 2);
        const tooltip = `${isTransparent ? '透明色' : `#${stat.index} (${hex})`}: ${stat.count} 点 (${pct}%)\n左键选取为前景色，右键选取为背景色`;
        const rowClass = [
          'stats-color-row',
          stat.index === session.activePaletteIndex ? 'is-active-fg' : '',
          stat.index === session.bgPaletteIndex ? 'is-active-bg' : '',
        ].join(' ');
        const chipClass = [
          'stats-color-chip',
          isTransparent ? 'chip-transparent' : '',
          stat.index === WHITE_PALETTE_INDEX ? 'chip-white' : '',
        ].join(' ');

        return `
        <div class="${rowClass}" data-index="${stat.index}" title="${tooltip}">
          <span class="${chipClass}" style="${isTransparent ? '' : `background-color: ${hex};`}"></span>
          <span class="stats-color-index">${idxLabel}</span>
          <span class="stats-color-count">${stat.count}</span>
          <span class="stats-color-pct">${pct}%</span>
        </div>`;
      })
      .join('');

    this.el.innerHTML = `
      <div class="stats-panel-header">
        <span class="stats-panel-title">选区颜色</span>
        <span class="stats-summary-badge">${stats.length}色 · ${totalPixels}px</span>
      </div>
      <div class="stats-color-list">
        ${rowsHtml}
      </div>
    `;
    this.el.style.display = 'flex';
  }
}
