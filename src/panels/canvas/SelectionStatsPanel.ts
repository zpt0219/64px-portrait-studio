/**
 * 选区颜色统计浮动面板：列出选区内各色板颜色的像素数与占比。
 * 左键行 → 设为前景色，右键 → 设为背景色，悬停 → 在画布上高亮该颜色。
 */

import { RectSelection } from '../../types';
import { PortraitDocument } from '../../model/document';
import { EditorSession } from '../../model/session';
import { TRANSPARENT_INDEX, WHITE_PALETTE_INDEX } from '../../data/palette';
import { IMAGE_WIDTH as W, IMAGE_HEIGHT as H } from '../../core/pixelGrid';

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
  const y0 = Math.max(0, sel.y);
  const y1 = Math.min(H, sel.y + sel.h);
  const x0 = Math.max(0, sel.x);
  const x1 = Math.min(W, sel.x + sel.w);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const colorIdx = pixels[y * W + x];
      counts.set(colorIdx, (counts.get(colorIdx) || 0) + 1);
      total++;
    }
  }
  if (total === 0) return [];
  return Array.from(counts.entries())
    .sort(([a], [b]) => a - b) // TRANSPARENT_INDEX = 255 自然排在最后
    .map(([index, count]) => ({ index, count, percentage: (count / total) * 100 }));
}

export class SelectionStatsPanel {
  private cachedSel: RectSelection | null = null;
  private cachedSelectedPixels: Uint8Array | null = null;
  private cachedPalette: string[] | null = null;
  private cachedActiveFg: number | null = null;
  private cachedActiveBg: number | null = null;

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

  private clearCache(): void {
    this.cachedSel = null;
    this.cachedSelectedPixels = null;
    this.cachedPalette = null;
    this.cachedActiveFg = null;
    this.cachedActiveBg = null;
  }

  public update(doc: PortraitDocument, session: EditorSession, selection: RectSelection | null): void {
    if (!selection) {
      if (this.el.style.display !== 'none') {
        this.el.style.display = 'none';
        this.el.innerHTML = '';
      }
      this.clearCache();
      return;
    }

    // 检查选区坐标或尺寸是否改变
    const selChanged =
      !this.cachedSel ||
      this.cachedSel.x !== selection.x ||
      this.cachedSel.y !== selection.y ||
      this.cachedSel.w !== selection.w ||
      this.cachedSel.h !== selection.h;

    // 检查色板是否改变
    const paletteChanged =
      !this.cachedPalette ||
      this.cachedPalette.length !== doc.palette.length ||
      this.cachedPalette.some((c, i) => c !== doc.palette[i]);

    // 检查选区内像素内容是否改变 (对比快照，禁止保留可变 pixelIndices 引用以防脏缓存)
    let pixelsChanged = selChanged || !this.cachedSelectedPixels;
    if (!pixelsChanged && this.cachedSelectedPixels) {
      const y0 = Math.max(0, selection.y);
      const y1 = Math.min(H, selection.y + selection.h);
      const x0 = Math.max(0, selection.x);
      const x1 = Math.min(W, selection.x + selection.w);
      let pIdx = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (doc.pixelIndices[y * W + x] !== this.cachedSelectedPixels[pIdx++]) {
            pixelsChanged = true;
            break;
          }
        }
        if (pixelsChanged) break;
      }
    }

    // 若数据无实质变化，仅在前/背景色板索引发生变化时就地更新 class，避免全量重建 DOM
    if (!selChanged && !paletteChanged && !pixelsChanged) {
      if (
        this.cachedActiveFg !== session.activePaletteIndex ||
        this.cachedActiveBg !== session.bgPaletteIndex
      ) {
        this.cachedActiveFg = session.activePaletteIndex;
        this.cachedActiveBg = session.bgPaletteIndex;
        const rows = this.el.querySelectorAll<HTMLElement>('.stats-color-row');
        rows.forEach((row) => {
          const idx = parseInt(row.getAttribute('data-index') ?? '', 10);
          row.classList.toggle('is-active-fg', idx === session.activePaletteIndex);
          row.classList.toggle('is-active-bg', idx === session.bgPaletteIndex);
        });
      }
      return;
    }

    const stats = selectionColorStats(doc.pixelIndices, selection);
    if (stats.length === 0) {
      this.el.style.display = 'none';
      this.el.innerHTML = '';
      this.clearCache();
      return;
    }

    // 缓存当前选区像素快照 (独立拷贝 Uint8Array)
    const y0 = Math.max(0, selection.y);
    const y1 = Math.min(H, selection.y + selection.h);
    const x0 = Math.max(0, selection.x);
    const x1 = Math.min(W, selection.x + selection.w);
    const pixelCount = Math.max(0, y1 - y0) * Math.max(0, x1 - x0);
    const pixelSnapshot = new Uint8Array(pixelCount);
    let pIdx = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        pixelSnapshot[pIdx++] = doc.pixelIndices[y * W + x];
      }
    }
    this.cachedSelectedPixels = pixelSnapshot;
    this.cachedSel = { ...selection };
    this.cachedPalette = [...doc.palette];
    this.cachedActiveFg = session.activePaletteIndex;
    this.cachedActiveBg = session.bgPaletteIndex;

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
