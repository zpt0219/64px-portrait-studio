/**
 * 颜色转换 (Hex / sRGB / OKLab)、感知色差与色板最近邻量化
 */

export type Rgb = [number, number, number];
export type Lab = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    const r = parseInt(cleanHex[0] + cleanHex[0], 16);
    const g = parseInt(cleanHex[1] + cleanHex[1], 16);
    const b = parseInt(cleanHex[2] + cleanHex[2], 16);
    return [r, g, b];
  }
  const num = parseInt(cleanHex, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function srgbChannelToLinear(value: number): number {
  const c = value / 255.0;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function rgbToOklab(rgb: Rgb): Lab {
  const r = srgbChannelToLinear(rgb[0]);
  const g = srgbChannelToLinear(rgb[1]);
  const b = srgbChannelToLinear(rgb[2]);

  const light = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const medium = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const short = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * light + 0.793617785 * medium - 0.0040720468 * short,
    1.9779984951 * light - 2.428592205 * medium + 0.4505937099 * short,
    0.0259040371 * light + 0.7827717662 * medium - 0.808675766 * short,
  ];
}

export function oklabDistance(first: Lab, second: Lab): number {
  const d0 = first[0] - second[0];
  const d1 = first[1] - second[1];
  const d2 = first[2] - second[2];
  return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
}

function nearestIndex(lab: Lab, paletteLabs: Lab[]): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < paletteLabs.length; i++) {
    const d = oklabDistance(lab, paletteLabs[i]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** 色板中与 hex 感知距离最近的颜色 */
export function findNearestColor(hex: string, palette: string[]): string {
  const paletteLabs = palette.map((h) => rgbToOklab(hexToRgb(h)));
  return palette[nearestIndex(rgbToOklab(hexToRgb(hex)), paletteLabs)];
}

/** 逐像素 OKLab 最近邻量化 (不抖动)，返回色板索引 */
export function quantizeToPalette(pixels: Rgb[], palette: Rgb[]): Uint8Array {
  const paletteLabs = palette.map(rgbToOklab);
  const cache = new Map<string, number>();
  const output = new Uint8Array(pixels.length);

  pixels.forEach((rgb, offset) => {
    const key = rgb.join(',');
    let idx = cache.get(key);
    if (idx === undefined) {
      idx = nearestIndex(rgbToOklab(rgb), paletteLabs);
      cache.set(key, idx);
    }
    output[offset] = idx;
  });
  return output;
}
