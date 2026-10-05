/**
 * 通用数值计算与统计工具 (纯函数，无 DOM 依赖)
 */

export function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const pos = fraction * (ordered.length - 1);
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return ordered[lower];
  const weight = pos - lower;
  return ordered[lower] * (1 - weight) + ordered[upper] * weight;
}

export function percentileInt(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.round((ordered.length - 1) * fraction)];
}

export function median(values: number[]): number {
  return percentile(values, 0.5);
}

export function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
