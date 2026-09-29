import { hexToRgb } from './colorUtils';

/** 按相对亮度找出 ramp 中最接近 hex 的阶位 */
export function nearestTierForColor(hex: string, ramp: string[]): number {
  const rgb = hexToRgb(hex);
  const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  let best = 0;
  let bestDistance = Infinity;

  ramp.forEach((candidate, index) => {
    const c = hexToRgb(candidate);
    const d = Math.abs(lum - (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]));
    if (d < bestDistance) {
      bestDistance = d;
      best = index;
    }
  });

  return best;
}
