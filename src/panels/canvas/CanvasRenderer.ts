/**
 * 主画布渲染 (对应 tile_map_editor_imgui 的 TileRenderer)：把文档与交互叠加层画到展示 canvas。
 * 64×64 整张重绘很便宜，所以不做脏矩形；只负责画，不处理输入。
 */

import { ZONE_CONFIG, RectSelection } from '../../types';
import { Patch } from '../../core/editOps';
import { drawIndexedPixels } from '../../core/pixelRender';
import { brushRect } from '../../command/pixelCommands';
import { ViewModel } from '../../app/viewModel';
import {
  drawZoneOverlay,
  drawPatchPixels,
  drawMatchPreview,
  drawGrid,
  drawColorHighlight,
  drawMarchingAnts,
} from './overlays';

/** 画布面板传入的交互状态 */
export interface CanvasOverlay {
  /** 正在拖动的选区内容 */
  floating: { origX: number; origY: number; patch: Patch; dx: number; dy: number; copy: boolean } | null;
  /** 正在拖拽的框选矩形；maskAction 非空表示遮罩模式的智能框选 */
  boxSelect: { rect: RectSelection; maskAction: 'add' | 'remove' | 'subtract' | 'clear' | null } | null;
  /** 鼠标悬停的像素 (未按下鼠标时)；alt 为按住 Alt 的吸管状态；shift 为 Shift 探针状态 */
  hover: { x: number; y: number; alt: boolean; shift?: boolean } | null;
  highlightedPaletteIndex: number | number[] | null;
  antsOffset: number;
}

export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly offscreen: HTMLCanvasElement;
  private readonly offscreenCtx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.offscreen = document.createElement('canvas');
    this.offscreen.width = 64;
    this.offscreen.height = 64;
    this.offscreenCtx = this.offscreen.getContext('2d')!;
  }

  draw(vm: ViewModel, overlay: CanvasOverlay): void {
    const { doc, session } = vm;
    const ctx = this.ctx;
    const zoom = session.zoomLevel;
    const size = 64 * zoom;

    if (this.canvas.width !== size || this.canvas.height !== size) {
      this.canvas.width = size;
      this.canvas.height = size;
      this.canvas.style.width = `${size}px`;
      this.canvas.style.height = `${size}px`;
    }
    ctx.imageSmoothingEnabled = false;

    // 1. 像素画 (发色预览时为预览像素) 放大绘制
    drawIndexedPixels(this.offscreenCtx, vm.displayPixels(), doc.palette);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.offscreen, 0, 0, 64, 64, 0, 0, size, size);

    // 2. 半透明分区遮罩
    const showMask = session.showMaskOverlay && session.maskOpacity > 0.01;
    const visibleZones = new Set(session.visibleMaskZones);
    if (showMask && visibleZones.size > 0) {
      drawZoneOverlay(ctx, doc.semanticMask, visibleZones, session.maskOpacity, zoom);
    }

    // 3. 颜色探针高亮 (悬停在色板或选区统计行时，以及遮罩油漆桶按 Shift 悬停时)
    const isProbeVisible =
      session.activeMode === 'pixel' || (session.activeMode === 'mask' && session.activeMaskTool === 'bucket');
    if (overlay.highlightedPaletteIndex !== null && isProbeVisible) {
      drawColorHighlight(ctx, doc.pixelIndices, overlay.highlightedPaletteIndex, zoom);
    }

    // 4. 像素网格 (放大倍数 >= 8 时)
    if (session.showGrid && zoom >= 8) drawGrid(ctx, zoom);

    // 5. 选区：拖动中的浮动块 / 正在框选 / 已有选区的走马灯
    const { floating, boxSelect } = overlay;
    if (floating) {
      const { origX, origY, patch } = floating;
      const destX = origX + floating.dx;
      const destY = origY + floating.dy;
      const origRect = { x: origX, y: origY, w: patch.w, h: patch.h };
      if (!floating.copy) ctx.clearRect(origX * zoom, origY * zoom, patch.w * zoom, patch.h * zoom); // 剪切移动时原位置显示为透明
      drawPatchPixels(ctx, patch, destX, destY, doc.palette, zoom);
      if (showMask) {
        drawZoneOverlay(ctx, patch.mask, visibleZones, session.maskOpacity, zoom, { ...origRect, x: destX, y: destY });
      }
      if (floating.copy) drawMarchingAnts(ctx, origRect, zoom, overlay.antsOffset, true);
    } else if (boxSelect) {
      if (boxSelect.maskAction) {
        const fill =
          boxSelect.maskAction === 'clear'
            ? 'rgba(239, 68, 68, 0.7)'
            : boxSelect.maskAction === 'subtract'
            ? 'rgba(239, 68, 68, 0.65)'
            : boxSelect.maskAction === 'remove'
            ? 'rgba(239, 68, 68, 0.65)'
            : `${ZONE_CONFIG[session.activeZone].color}88`;
        drawMatchPreview(
          ctx,
          doc.pixelIndices,
          doc.semanticMask,
          session.activeZone,
          boxSelect.rect,
          new Set(session.maskMatchColors),
          fill,
          zoom,
          boxSelect.maskAction
        );
      }
      drawMarchingAnts(ctx, boxSelect.rect, zoom, overlay.antsOffset);
    } else if (session.activeMode === 'pixel' && session.selection) {
      drawMarchingAnts(ctx, session.selection, zoom, overlay.antsOffset);
    }

    // 6. 悬停像素 / 笔刷线框
    if (overlay.hover) this.drawHoverOutline(vm, overlay.hover);
  }

  private drawHoverOutline(vm: ViewModel, hover: { x: number; y: number; alt: boolean; shift?: boolean }): void {
    const s = vm.session;
    if (s.activeMode === 'pixel' && s.activeTool === 'select') return;
    if (s.activeMode === 'mask' && s.activeMaskTool === 'box_select') return;
    const ctx = this.ctx;
    const zoom = s.zoomLevel;
    let rect: RectSelection = { x: hover.x, y: hover.y, w: 1, h: 1 };
    let lineWidth = 1.5;
    ctx.save();

    if (s.activeMode === 'pixel' && hover.shift) {
      ctx.strokeStyle = '#38bdf8';
      lineWidth = 2;
    } else if (s.activeMode === 'mask') {
      if (s.activeMaskTool === 'bucket') {
        ctx.strokeStyle = '#c084fc';
      } else {
        rect = brushRect(hover.x, hover.y, s.maskBrushSize);
        ctx.strokeStyle = s.activeMaskTool === 'eraser' ? '#f472b6' : ZONE_CONFIG[s.activeZone]?.color || '#00E5FF';
      }
    } else if (s.activeTool === 'bucket') {
      ctx.strokeStyle = '#c084fc';
    } else if (s.activeTool === 'eraser') {
      ctx.strokeStyle = '#f472b6';
    } else if (hover.alt || s.activeTool === 'eyedropper') {
      ctx.strokeStyle = '#38bdf8';
    } else {
      ctx.strokeStyle = '#FFFFFF';
      lineWidth = 1;
    }

    ctx.lineWidth = lineWidth;
    ctx.strokeRect(rect.x * zoom + 0.5, rect.y * zoom + 0.5, rect.w * zoom - 1, rect.h * zoom - 1);
    ctx.restore();
  }
}
