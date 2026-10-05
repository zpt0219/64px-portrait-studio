/**
 * Canvas Cursor & Tool Icon Utilities (Aseprite 规范对齐)
 * 对齐 Aseprite 经典工具形态：
 * 1. 画笔 (Pen)：45° 斜向铅笔，笔尖朝向左下角 (Hotspot)，笔身向右上延伸，符合人体工学与真实执笔视觉
 * 2. 油漆桶 (Bucket)：45° 倾倒姿态的油漆桶，桶口向下喷涌出流淌漆滴，以左下角水滴尖端为物理锚点
 * 3. 橡皮擦 (Eraser)：经典斜向粉白双色切角橡皮块，以左下接触角为锚点
 * 4. 吸管 (Eyedropper)：经典斜向玻璃吸管，以左下滴管尖端为锚点
 */

interface ToolCursorMap {
  pen: string;
  eraser: string;
  bucket: string;
  eyedropper: string;
}

/**
 * 工具栏按钮专用的 16×16 精致 SVG 图标 (对齐 Aseprite 经典图标形态)
 */
export const TOOL_ICONS = {
  pen: `<svg viewBox='0 0 16 16' width='14' height='14' fill='none' xmlns='http://www.w3.org/2000/svg'>
    <path d='M1 15 L2.5 10.5 L11.5 1.5 C12.5 0.5 14 0.5 15 1.5 C16 2.5 16 4 15 5 L6 14 L1.5 15.5 Z' fill='#111422'/>
    <path d='M2 14 L3 11 L11.5 2.5 L13.5 4.5 L5 13 L2 14 Z' fill='#FBBF24'/>
    <path d='M3.5 11 L12 2.5 L13.5 4 L5 12.5 Z' fill='#F59E0B'/>
    <path d='M11.5 2.5 L12.5 1.5 C13.2 0.8 14.2 0.8 14.8 1.5 C15.5 2.2 15.5 3.2 14.8 3.8 L13.8 4.8 Z' fill='#F43F5E'/>
    <path d='M10.8 3.2 L12 2 L14 4 L12.8 5.2 Z' fill='#94A3B8'/>
    <path d='M2 14 L3 11 L5 13 Z' fill='#FDE68A'/>
    <path d='M1 15 L2 13 L3 14 Z' fill='#0F172A'/>
  </svg>`,

  bucket: `<svg viewBox='0 0 16 16' width='14' height='14' fill='none' xmlns='http://www.w3.org/2000/svg'>
    <path d='M9 2 C12 0 15 3 15 6' stroke='#CBD5E1' stroke-width='1.5' stroke-linecap='round'/>
    <path d='M9 2 C12 0 15 3 15 6' stroke='#111422' stroke-width='0.5' stroke-linecap='round'/>
    <path d='M4 8 L10 2 L15.5 7.5 L9.5 13.5 Z' fill='#111422'/>
    <path d='M4.5 8.2 L10 2.8 L14.8 7.5 L9.5 12.8 Z' fill='#4338CA'/>
    <path d='M6 8 L10 4 L14 8 L10 12 Z' fill='#6366F1'/>
    <path d='M3 9 L8.5 14.5 L10 13 L4.5 7.5 Z' fill='#111422'/>
    <path d='M3.5 9.2 L8.5 14 L9.5 13 L4.5 8 Z' fill='#0284C7'/>
    <path d='M4 9.5 L8 13.5 L8.8 12.8 L4.8 8.8 Z' fill='#38BDF8'/>
    <path d='M3.5 9.5 Q2 12 1 15 Q3 14 5 12 Z' fill='#111422'/>
    <path d='M3.5 10 Q2.2 12.5 1.5 14.5 Q2.8 13.5 4.5 12 Z' fill='#38BDF8'/>
    <circle cx='2' cy='14' r='0.8' fill='#BAE6FD'/>
  </svg>`,

  eraser: `<svg viewBox='0 0 16 16' width='14' height='14' fill='none' xmlns='http://www.w3.org/2000/svg'>
    <path d='M2 14 L9 7 L15 13 L8 16 Z' fill='#111422'/>
    <path d='M2.5 13.5 L6 10 L10 14 L6.5 15.5 Z' fill='#F1F5F9'/>
    <path d='M6 10 L9.5 6.5 L14.5 11.5 L11 15 Z' fill='#FB7185'/>
    <path d='M7 9.5 L10 6.5 L14 10.5 L11 13.5 Z' fill='#F43F5E'/>
  </svg>`,

  eyedropper: `<svg viewBox='0 0 16 16' width='14' height='14' fill='none' xmlns='http://www.w3.org/2000/svg'>
    <path d='M1 15 L2 11 L10 3 L13 6 L5 14 Z' fill='#111422'/>
    <path d='M3 11 L9.5 4.5 L11.5 6.5 L5 13 Z' fill='#E2E8F0'/>
    <path d='M3.5 11 L7 7.5 L8.5 9 L5 12.5 Z' fill='#38BDF8'/>
    <path d='M9.5 4.5 L12 2 C13 1 14.5 1 15.5 2 C16.5 3 16.5 4.5 15.5 5.5 L13 8 L11.5 6.5 Z' fill='#111422'/>
    <path d='M10.2 4 L12.5 1.8 C13.2 1.2 14.2 1.2 14.8 1.8 C15.5 2.5 15.5 3.5 14.8 4.2 L12.5 6.5 Z' fill='#475569'/>
    <circle cx='1.8' cy='14.2' r='0.8' fill='#38BDF8'/>
  </svg>`,

  select: `<svg viewBox='0 0 16 16' width='14' height='14' fill='none' xmlns='http://www.w3.org/2000/svg'>
    <rect x='1.5' y='1.5' width='13' height='13' rx='1' stroke='#94A3B8' stroke-width='1.5' stroke-dasharray='3 2'/>
  </svg>`,
};

/**
 * 24×24 画布原生高精度光标 (带高反差双层反差勾边，支持黑白任意底色清晰可见)
 */
const PEN_CURSOR_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>
  <!-- 外层白色反差勾边：确保黑底上极度清晰 -->
  <path d='M2 22 L7.5 20 L21.5 6 C22.5 5 22.5 3.5 21.5 2.5 L19.5 0.5 C18.5 -0.5 17 -0.5 16 0.5 L2 14.5 L0.5 20.5 Z' 
        fill='#FFFFFF' stroke='#FFFFFF' stroke-width='2' stroke-linejoin='round'/>
  <!-- 深色实体勾边 -->
  <path d='M2 22 L7.5 20 L21.5 6 C22.2 5.2 22.2 3.8 21.5 3 L19 0.5 C18.2 -0.2 16.8 -0.2 16 0.5 L2 14.5 L0.8 20.8 Z' 
        fill='#111422' stroke='#111422' stroke-width='0.6' stroke-linejoin='round'/>
  <!-- 粉红橡皮擦头 -->
  <path d='M16 0.5 L19 0.5 C19.8 1.3 19.8 2.7 19 3.5 L17 5.5 L14 2.5 L16 0.5 Z' fill='#F43F5E'/>
  <!-- 银色金属箍 -->
  <path d='M14 2.5 L17 5.5 L15.5 7 L12.5 4 Z' fill='#94A3B8'/>
  <line x1='13.2' y1='3.2' x2='16.2' y2='6.2' stroke='#475569' stroke-width='0.6'/>
  <!-- 黄色经典多面棱柱笔身 (高光面、主色面、暗部面) -->
  <path d='M12.5 4 L15.5 7 L7 15.5 L5 13.5 Z' fill='#FEF08A'/>
  <path d='M11 5.5 L14 8.5 L6.5 16 L4.5 14.5 Z' fill='#F59E0B'/>
  <path d='M9.5 7 L12.5 10 L5.5 17 L4 15.5 Z' fill='#D97706'/>
  <!-- 削尖原木木质截面 -->
  <path d='M5.5 17 L4 15.5 L2 22 Z' fill='#FDE68A'/>
  <path d='M4.8 17.8 L3.8 16.5 L2 22 Z' fill='#F5D0A9'/>
  <!-- 黑色铅芯尖端 (精确锚点 Hotspot 位于 2, 22) -->
  <path d='M3.2 20.6 L2.6 19.8 L2 22 Z' fill='#0F172A'/>
</svg>`;

const BUCKET_CURSOR_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>
  <!-- 外层白色反差轮廓 -->
  <path d='M5 11 L13 3 L21 11 L13 19 Z' fill='none' stroke='#FFFFFF' stroke-width='3.5' stroke-linejoin='round'/>
  <path d='M4.5 13 Q2 17 2 22 Q4 20 7.5 17 Z' fill='#FFFFFF' stroke='#FFFFFF' stroke-width='2.5' stroke-linejoin='round'/>
  <!-- 提手 (向右上方拱起) -->
  <path d='M12 4 C15.5 0.5 19.5 3.5 20.5 7' fill='none' stroke='#FFFFFF' stroke-width='3' stroke-linecap='round'/>
  <path d='M12 4 C15.5 0.5 19.5 3.5 20.5 7' fill='none' stroke='#111422' stroke-width='2' stroke-linecap='round'/>
  <path d='M12 4 C15.5 0.5 19.5 3.5 20.5 7' fill='none' stroke='#CBD5E1' stroke-width='1' stroke-linecap='round'/>
  <!-- 倾斜 45° 油漆桶身 -->
  <path d='M6 10 L13 3 L20.5 10.5 L13.5 17.5 Z' fill='#111422' stroke='#111422' stroke-width='1' stroke-linejoin='round'/>
  <!-- 金属桶身质感 (靛蓝到亮蓝过渡) -->
  <path d='M6.5 10.5 L13 4 L19.8 10.8 L13.3 17.3 Z' fill='#4338CA'/>
  <path d='M8 12 L13 7 L18 12 L13 17 Z' fill='#6366F1'/>
  <path d='M10 13.5 L13 10.5 L16.5 14 L13.5 17 Z' fill='#818CF8'/>
  <!-- 倾斜敞开的桶口 Rim -->
  <path d='M4.5 11.5 L11.5 18.5 L13.5 16.5 L6.5 9.5 Z' fill='#1E1B4B' stroke='#111422' stroke-width='0.8' stroke-linejoin='round'/>
  <!-- 桶口内油漆液面 -->
  <path d='M5.2 11.8 L11.8 18.2 L12.8 17.2 L6.2 10.8 Z' fill='#38BDF8'/>
  <ellipse cx='9' cy='14.5' rx='3.5' ry='1.2' transform='rotate(45 9 14.5)' fill='#0284C7'/>
  <!-- 从桶口倾倒流淌而出的漆流与油漆滴 (尖端精确锚点 Hotspot 位于 2, 22) -->
  <path d='M4.5 12 C3 15 2 19 2 22 C3.5 20 5.5 18 7 16.5 Z' fill='#0284C7' stroke='#111422' stroke-width='1.2' stroke-linejoin='round'/>
  <path d='M4.5 12.8 C3.4 15.5 2.5 18.8 2.2 21.2 C3.2 19.8 4.8 18 6 16.8 Z' fill='#38BDF8'/>
  <!-- 漆滴高光点 -->
  <circle cx='2.8' cy='20.8' r='1' fill='#BAE6FD'/>
</svg>`;

const ERASER_CURSOR_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>
  <!-- 外层白色反差轮廓 -->
  <path d='M2 22 L11 13 L21 21 L12 28 Z' fill='none' stroke='#FFFFFF' stroke-width='2' stroke-linejoin='round'/>
  <!-- 经典斜向双色橡皮擦 (粉红+白切角，左下角 2, 22 为锚点) -->
  <path d='M2 22 L10 14 L20 22 L12 24 Z' fill='#111422' stroke='#111422' stroke-width='0.8' stroke-linejoin='round'/>
  <path d='M2.8 21.2 L9 15 L14 19 L7.5 22.5 Z' fill='#F1F5F9'/>
  <path d='M9 15 L15 9 L20 14 L14 19 Z' fill='#FB7185'/>
  <path d='M10.5 14 L15 9 L19.2 13.2 L14 17.5 Z' fill='#F43F5E'/>
</svg>`;

const EYEDROPPER_CURSOR_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>
  <!-- 外层白色反差轮廓 -->
  <path d='M2 22 L3.5 17 L14 6.5 L18 10.5 L7.5 19.5 Z' fill='#FFFFFF' stroke='#FFFFFF' stroke-width='2' stroke-linejoin='round'/>
  <!-- 滴管实体 (左下角滴管尖端 2, 22 为锚点) -->
  <path d='M2 22 L3.5 17 L14 6.5 L18 10.5 L7.5 19.5 Z' fill='#111422' stroke='#111422' stroke-width='0.8' stroke-linejoin='round'/>
  <!-- 玻璃管与内部液体 -->
  <path d='M4.5 17 L13.5 8 L16.5 11 L7.5 18.5 Z' fill='#E2E8F0'/>
  <path d='M5 17 L10 12 L12.5 14.5 L7.5 18 Z' fill='#38BDF8'/>
  <!-- 胶头气囊 -->
  <path d='M14 6.5 L17.5 3 C18.8 1.8 20.8 1.8 22 3 C23.2 4.2 23.2 6.2 22 7.5 L18 10.5 Z' fill='#111422'/>
  <path d='M15 6 L18 3.5 C18.8 2.8 20.2 2.8 21 3.5 C21.8 4.3 21.8 5.7 21 6.5 L17.5 9.5 Z' fill='#475569'/>
  <!-- 滴管口小液滴 -->
  <circle cx='2.8' cy='21.2' r='1.2' fill='#38BDF8'/>
</svg>`;

let cachedCursors: ToolCursorMap | null = null;

function createSvgCursor(svgString: string, hotspotX: number, hotspotY: number, fallback = 'crosshair'): string {
  const encoded = encodeURIComponent(svgString.trim());
  return `url("data:image/svg+xml,${encoded}") ${hotspotX} ${hotspotY}, ${fallback}`;
}

/**
 * 获取所有工具的自定义图标光标定义 (Aseprite 规范对齐)
 */
export function getToolCursors(): ToolCursorMap {
  if (cachedCursors) return cachedCursors;

  cachedCursors = {
    // ✏️ 画笔：尖端精确对齐左下角 (2, 22)，向右上 45° 倾斜，符合真实运笔视线
    pen: createSvgCursor(PEN_CURSOR_SVG, 2, 22, 'crosshair'),
    // 🧼 橡皮：斜向粉白切角橡皮块，左下触角 (2, 22) 为锚点
    eraser: createSvgCursor(ERASER_CURSOR_SVG, 2, 22, 'cell'),
    // 🪣 油漆桶：倾倒姿态倒漆桶，流淌漆滴尖端 (2, 22) 为锚点
    bucket: createSvgCursor(BUCKET_CURSOR_SVG, 2, 22, 'crosshair'),
    // 🧪 吸管：斜向玻璃滴管，滴管口 (2, 22) 为锚点
    eyedropper: createSvgCursor(EYEDROPPER_CURSOR_SVG, 2, 22, 'crosshair'),
  };

  return cachedCursors;
}
