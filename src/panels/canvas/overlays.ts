/**
 * 主画布上的叠加层绘制函数 (均以像素格为单位，zoom 为每格屏幕像素数)
 */

import { SemanticZone, RectSelection } from '../../core/types';
import { TRANSPARENT_INDEX, WHITE_PALETTE_INDEX } from '../../core/constants';
import { hexToRgb } from '../../core/colorUtils';
import { zoneRgbTable } from '../../core/maskColors';
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

/** 框选预览：框内像素着色 (add加匹配色，subtract去杂色，remove去匹配色，clear去所有色) */
export function drawMatchPreview(
  ctx: CanvasRenderingContext2D,
  pixels: Uint8Array,
  mask: Uint8Array,
  activeZone: SemanticZone,
  rect: RectSelection,
  matchColors: Set<number>,
  fillStyle: string,
  zoom: number,
  mode: 'add' | 'remove' | 'subtract' | 'clear' = 'add'
): void {
  ctx.save();
  ctx.fillStyle = fillStyle;
  forEachCell(rect, (_, x, y) => {
    const offset = y * W + x;
    const isMatch = matchColors.has(pixels[offset]);
    if (mode === 'clear') {
      // 右键清空：框内所有属于 activeZone 的像素高亮
      if (mask[offset] === activeZone) {
        ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
      }
    } else if (mode === 'subtract') {
      // Shift 去杂色：框内属于 activeZone 且不是匹配色的像素高亮
      if (!isMatch && mask[offset] === activeZone) {
        ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
      }
    } else if (mode === 'remove') {
      // Alt 去匹配色：框内属于 activeZone 且是匹配色的像素高亮
      if (isMatch && mask[offset] === activeZone) {
        ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
      }
    } else {
      // 左键 加匹配色：关键防护：add 模式下透明像素不入遮罩，预览时亦不着色
      if (isMatch && pixels[offset] !== TRANSPARENT_INDEX) {
        ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
      }
    }
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
 * 颜色探针：压暗所有非目标颜色像素，并给目标像素描边提亮 (支持单色或多色集合，如全发色高亮)
 */
export function drawColorHighlight(
  ctx: CanvasRenderingContext2D,
  pixels: Uint8Array,
  targetIdx: number | number[] | Set<number>,
  zoom: number
): void {
  const isSet = targetIdx instanceof Set ? targetIdx : Array.isArray(targetIdx) ? new Set(targetIdx) : null;
  const isMatch = (color: number) => (isSet ? isSet.has(color) : color === targetIdx);
  const isTransparent = isSet ? isSet.has(TRANSPARENT_INDEX) : targetIdx === TRANSPARENT_INDEX;
  const isWhite = isSet ? isSet.has(WHITE_PALETTE_INDEX) : targetIdx === WHITE_PALETTE_INDEX;

  const darkPath = new Path2D();
  const matchPath = new Path2D();
  const matches: [number, number][] = [];

  forEachCell(FULL, (i, x, y) => {
    if (isMatch(pixels[i])) {
      matches.push([x, y]);
      matchPath.rect(x * zoom + 0.5, y * zoom + 0.5, zoom - 1, zoom - 1);
    } else {
      darkPath.rect(x * zoom, y * zoom, zoom, zoom);
    }
  });

  // 1. 压暗所有非目标颜色像素
  ctx.save();
  ctx.fillStyle = 'rgba(10, 12, 22, 0.72)';
  ctx.fill(darkPath);
  ctx.restore();

  if (matches.length > 0) {
    ctx.save();
    // 2. 像素边框描边与微高光 (白色与透明色用青色描边，其余用纯白)
    ctx.strokeStyle = isWhite || isTransparent ? '#38bdf8' : '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke(matchPath);
    ctx.fillStyle = isTransparent ? 'rgba(56, 189, 248, 0.22)' : 'rgba(255, 255, 255, 0.18)';
    ctx.fill(matchPath);

    // 3. 像素中心实心小圆点：一眼辨识精确命中的像素与相邻近似色
    const dotRadius = Math.max(1.2, Math.min(zoom * 0.22, 5));
    const dotPath = new Path2D();
    for (let k = 0; k < matches.length; k++) {
      const [x, y] = matches[k];
      const cx = (x + 0.5) * zoom;
      const cy = (y + 0.5) * zoom;
      dotPath.moveTo(cx + dotRadius, cy);
      dotPath.arc(cx, cy, dotRadius, 0, Math.PI * 2);
    }
    // 纯白像素下用青蓝实心点，透明像素用天蓝，其余颜色一律用纯白实心点，外加深色描边保证任何底色均清晰可见
    ctx.fillStyle = isWhite ? '#0284c7' : isTransparent ? '#38bdf8' : '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = Math.max(2, zoom * 0.25);
    ctx.fill(dotPath);
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.lineWidth = Math.max(0.6, Math.min(1.2, zoom * 0.08));
    ctx.stroke(dotPath);
    ctx.restore();
  }
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
