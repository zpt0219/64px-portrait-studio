export function hexToRgb(hex: string): [number, number, number] {
  const cleanHex = hex.replace("#", "");
  if (cleanHex.length === 3) {
    const r = parseInt(cleanHex[0] + cleanHex[0], 16);
    const g = parseInt(cleanHex[1] + cleanHex[1], 16);
    const b = parseInt(cleanHex[2] + cleanHex[2], 16);
    return [r, g, b];
  }
  const num = parseInt(cleanHex, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969567 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

  return [L, a, B];
}

export function oklabDistance(hex1: string, hex2: string): number {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  const [L1, a1, b1_] = rgbToOklab(r1, g1, b1);
  const [L2, a2, b2_] = rgbToOklab(r2, g2, b2);

  const dL = L1 - L2;
  const da = a1 - a2;
  const db = b1_ - b2_;
  return Math.sqrt(dL * dL + da * da + db * db);
}

export function findNearestColor(hex: string, palette: string[]): string {
  let minDistance = Infinity;
  let nearest = palette[0];

  for (const palHex of palette) {
    const dist = oklabDistance(hex, palHex);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = palHex;
    }
  }

  return nearest;
}
