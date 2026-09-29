/**
 * 用 emoji 渲染的工具光标 (画笔 / 橡皮 / 油漆桶 / 吸管)
 */

interface ToolCursorMap {
  pen: string;
  eraser: string;
  bucket: string;
  eyedropper: string;
}

let cachedCursors: ToolCursorMap | null = null;

/**
 * 把 emoji 渲染成 PNG 光标，热点取可见像素包围盒的左下角 (与 Aseprite 一致)
 */
function renderEmojiToCursor(emoji: string, fontSize = 15, size = 32): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 'crosshair';

  ctx.clearRect(0, 0, size, size);

  ctx.font = `${fontSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 四周均匀的深色描边，保证在任意背景上可见
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 1.5;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  ctx.fillText(emoji, size / 2, size / 2);

  // 计算该图标的精确可见方形包围盒 (Bounding Box: minX, maxX, minY, maxY)
  const imgData = ctx.getImageData(0, 0, size, size).data;
  let minX = size;
  let maxX = 0;
  let minY = size;
  let maxY = 0;
  let hasPixels = false;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const alpha = imgData[(y * size + x) * 4 + 3];
      // 过滤四周极微弱的模糊边缘，定位图标有效实体的方形包围盒
      if (alpha > 60) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        hasPixels = true;
      }
    }
  }

  // Aseprite 规范：方形包围盒的左下角 (minX, maxY) 作为光标物理锚点 (Hotspot)
  // 确保光标所有像素全部位于锚点的上方与右侧，零遮挡、尖端/底角直接对齐当前聚焦像素
  const hotspotX = hasPixels ? minX : 0;
  const hotspotY = hasPixels ? maxY : size - 1;

  const dataUrl = canvas.toDataURL('image/png');
  return `url("${dataUrl}") ${hotspotX} ${hotspotY}, crosshair`;
}

/**
 * 获取所有工具的自定义图标光标定义
 */
export function getToolCursors(): ToolCursorMap {
  if (cachedCursors) return cachedCursors;

  try {
    cachedCursors = {
      // ✏️ 画笔：15px 精巧尺寸，方形包围盒左下角笔尖为锚点
      pen: renderEmojiToCursor('✏️', 15, 32),
      // 🧼 橡皮：方形包围盒左下角为锚点
      eraser: renderEmojiToCursor('🧼', 15, 32),
      // 🪣 油漆桶：方形包围盒左下角为锚点
      bucket: renderEmojiToCursor('🪣', 15, 32),
      // 🧪 吸管：方形包围盒左下角试管口为锚点
      eyedropper: renderEmojiToCursor('🧪', 15, 32),
    };
  } catch (err) {
    console.warn('Failed to generate custom emoji cursors, falling back to CSS default', err);
    cachedCursors = {
      pen: 'crosshair',
      eraser: 'cell',
      bucket: 'crosshair',
      eyedropper: 'crosshair',
    };
  }

  return cachedCursors;
}
