/**
 * 主画布上的叠加层绘制函数 (均以像素格为单位，zoom 为每格屏幕像素数)
 */

import { SemanticZone, RectSelection } from '../../types';
import { TRANSPARENT_INDEX, WHITE_PALETTE_INDEX } from '../../data/palette';
import { hexToRgb } from '../../core/colorUtils';
import { zoneRgbTable } from '../../core/pixelRender';
import { IMAGE_WIDTH as W, IMAGE_HEIGHT as H } from '../../core/pixelGrid';
import { Patch } from '../../core/editOps';

/** 遮罩覆盖层配色 (背景用深蓝灰，与深色界面区分) */
const ZONE_OVERLAY_RGB = zoneRgbTable([15, 23, 42]);

const FULL: RectSelection = { x: 0, y: 0, w: W, h: H };

/** 对 rect 内 (与画布相交部分) 的每一格调用 fn(块内索引, 画布 x, 画布 y) */
function forEachCell(rect: RectSelection, fn: (i: number, x: number, y: number) => void): void {
  for (let r = 0; r < rect.h; r++) {
    for (let c = 0; c < rect.w; c++) {
      const x = rect.x + c;
      const y = rect.y + r;
      if (x >= 0 && x < W && y >= 0 && y < H) fn(r * rect.w + c, x, y);
    }
  }
}

/** 半透明分区遮罩；mask 为 rect 大小的块 (默认整张画布) */
export function drawZoneOverlay(
  ctx: CanvasRenderingContext2D,
  mask: ArrayLike<number>,
  visibleZones: Set<SemanticZone>,
  opacity: number,
  zoom: number,
  rect: RectSelection = FULL
): void {
  ctx.save();
  forEachCell(rect, (i, x, y) => {
    const zone = mask[i] as SemanticZone;
    if (!visibleZones.has(zone)) return;
    const rgb = ZONE_OVERLAY_RGB[zone] || [0, 0, 0];
    ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${opacity})`;
    ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
  });
  ctx.restore();
}

/** 拖动中的浮动块像素 (透明像素不绘制) */
export function drawPatchPixels(
  ctx: CanvasRenderingContext2D,
  patch: Patch,
  x: number,
  y: number,
  palette: string[],
  zoom: number
): void {
  ctx.save();
  forEachCell({ x, y, w: patch.w, h: patch.h }, (i, px, py) => {
    const palIdx = patch.pixels[i];
    if (palIdx === TRANSPARENT_INDEX) return;
    const rgb = hexToRgb(palette[palIdx] || '#000000');
    ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    ctx.fillRect(px * zoom, py * zoom, zoom, zoom);
  });
  ctx.restore();
}

/** 框选预览：框内属于匹配色组的像素着色 */
export function drawMatchPreview(
  ctx: CanvasRenderingContext2D,
  pixels: Uint8Array,
  rect: RectSelection,
  matchColors: Set<number>,
  fillStyle: string,
  zoom: number
): void {
  ctx.save();
  ctx.fillStyle = fillStyle;
  forEachCell(rect, (_, x, y) => {
    if (matchColors.has(pixels[y * W + x])) ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
  });
  ctx.restore();
}

export function drawGrid(ctx: CanvasRenderingContext2D, zoom: number): void {
  const size = W * zoom;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= W; i++) {
    const pos = i * zoom;
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, size);
    ctx.moveTo(0, pos);
    ctx.lineTo(size, pos);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * 颜色探针：压暗所有非目标颜色像素，并给目标像素描边提亮
 */
export function drawColorHighlight(
  ctx: CanvasRenderingContext2D,
  pixels: Uint8Array,
  targetIdx: number,
  zoom: number
): void {
  const isTransparent = targetIdx === TRANSPARENT_INDEX;
  const isWhite = targetIdx === WHITE_PALETTE_INDEX;

  ctx.save();
  ctx.beginPath();
  forEachCell(FULL, (i, x, y) => {
    if (pixels[i] !== targetIdx) ctx.rect(x * zoom, y * zoom, zoom, zoom);
  });
  ctx.fillStyle = 'rgba(10, 12, 22, 0.72)';
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  let matchCount = 0;
  forEachCell(FULL, (i, x, y) => {
    if (pixels[i] === targetIdx) {
      matchCount++;
      ctx.rect(x * zoom + 0.5, y * zoom + 0.5, zoom - 1, zoom - 1);
    }
  });
  if (matchCount > 0) {
    // 白色与透明色用青色描边，其余用白色
    ctx.strokeStyle = isWhite || isTransparent ? '#38bdf8' : '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = isTransparent ? 'rgba(56, 189, 248, 0.22)' : 'rgba(255, 255, 255, 0.18)';
    ctx.fill();
  }
  ctx.restore();
}

/**
 * 黑白交替的走马灯虚线框；ghost 为复制拖动时原位置的淡色虚线
 */
export function drawMarchingAnts(
  ctx: CanvasRenderingContext2D,
  sel: RectSelection,
  zoom: number,
  dashOffset: number,
  ghost = false
): void {
  const x = Math.round(sel.x * zoom);
  const y = Math.round(sel.y * zoom);
  const w = Math.round(sel.w * zoom);
  const h = Math.round(sel.h * zoom);

  ctx.save();
  if (ghost) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  } else {
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = dashOffset;
    ctx.strokeStyle = '#FFFFFF';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    ctx.lineDashOffset = (dashOffset + 4) % 8;
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
  ctx.restore();
}
