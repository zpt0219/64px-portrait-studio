import { hexToRgb } from './colorUtils';
import { ToneStrategy } from '../types';

export function nearestTierForColor(hex: string, currentRamp: string[]): number {
  const rgb = hexToRgb(hex);
  const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  let best = 0;
  let bestDistance = Infinity;

  currentRamp.forEach((candidate, index) => {
    const c = hexToRgb(candidate);
    const d = Math.abs(lum - (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]));
    if (d < bestDistance) {
      bestDistance = d;
      best = index;
    }
  });

  return best;
}

export function mappedTierForIndex(
  idx: number,
  pixelTiers: Int8Array,
  _hairMask: Uint8Array,
  basePixels: string[],
  currentRamp: string[],
  toneStrategy: ToneStrategy
): number {
  let tier = pixelTiers[idx];
  if (tier < 0 || tier >= currentRamp.length) {
    tier = nearestTierForColor(basePixels[idx], currentRamp);
  }

  if (toneStrategy === "flat") {
    const ratio = tier / Math.max(1, currentRamp.length - 1);
    tier = ratio < 0.34 ? 0 : ratio > 0.72 ? currentRamp.length - 1 : Math.floor(currentRamp.length / 2);
  } else if (toneStrategy === "contrast") {
    const ratio = tier / Math.max(1, currentRamp.length - 1);
    tier = Math.round((ratio < 0.5 ? ratio * 0.75 : 0.25 + ratio * 0.75) * (currentRamp.length - 1));
  }

  return Math.max(0, Math.min(currentRamp.length - 1, tier));
}

export function mappedColorForIndex(
  idx: number,
  pixelTiers: Int8Array,
  hairMask: Uint8Array,
  basePixels: string[],
  currentRamp: string[],
  toneStrategy: ToneStrategy
): string {
  return hairMask[idx]
    ? currentRamp[mappedTierForIndex(idx, pixelTiers, hairMask, basePixels, currentRamp, toneStrategy)] || basePixels[idx]
    : basePixels[idx];
}

export function applyConnected(
  start: number,
  predicate: (idx: number) => boolean,
  operation: (idx: number) => void
): void {
  const queue = [start];
  const seen = new Uint8Array(4096);
  seen[start] = 1;

  while (queue.length > 0) {
    const idx = queue.shift()!;
    if (!predicate(idx)) continue;
    operation(idx);

    const x = idx % 64;
    const y = Math.floor(idx / 64);
    const neighbors: [number, number][] = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];

    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx > 63 || ny < 0 || ny > 63) continue;
      const ni = ny * 64 + nx;
      if (!seen[ni]) {
        seen[ni] = 1;
        queue.push(ni);
      }
    }
  }
}
