import { describe, it, expect } from 'vitest';
import { recolorHair, nearestTierForColor } from '../src/core/recolorEngine';
import { RAMPS_INFO, PALETTE_36, TRANSPARENT_INDEX } from '../src/data/palette';
import { SemanticZone, HairPresetKey } from '../src/types';
import { PIXEL_COUNT } from '../src/core/pixelGrid';

describe('recolorEngine (4-tier hair system)', () => {
  const palette = [...PALETTE_36];

  function createHairTestBuffer(presetKey: HairPresetKey): { pixels: Uint8Array; mask: Uint8Array } {
    const pixels = new Uint8Array(PIXEL_COUNT).fill(TRANSPARENT_INDEX);
    const mask = new Uint8Array(PIXEL_COUNT).fill(SemanticZone.Background);
    const ramp = RAMPS_INFO[presetKey].hexes;

    // Put 4 pixels for the 4 tiers at indices 0..3
    for (let tier = 0; tier < 4; tier++) {
      const hex = ramp[tier];
      const pIdx = palette.findIndex((c) => c.toUpperCase() === hex.toUpperCase());
      pixels[tier] = pIdx;
      mask[tier] = SemanticZone.Hair;
    }
    return { pixels, mask };
  }

  it('correctly maps 4 tiers from Brown to Red by tier index', () => {
    const { pixels, mask } = createHairTestBuffer('02_brown_棕');
    const recolored = recolorHair(pixels, mask, palette, '02_brown_棕', '09_red_红');

    const redRamp = RAMPS_INFO['09_red_红'].hexes;
    expect(redRamp.length).toBe(4);
    for (let tier = 0; tier < 4; tier++) {
      const expectedHex = redRamp[tier];
      const actualHex = palette[recolored[tier]];
      expect(actualHex.toUpperCase()).toBe(expectedHex.toUpperCase());
    }
  });

  it('multi-hop recolor cycle across all 9 presets maintains 100% deterministic fidelity without drift', () => {
    const initial = createHairTestBuffer('02_brown_棕');
    const sequence: HairPresetKey[] = [
      '09_red_红',
      '03_blonde_金',
      '04_pink_粉',
      '05_blue_蓝',
      '06_silver_银白',
      '07_green_绿',
      '08_purple_紫',
      '01_black_黑',
      '02_brown_棕',
    ];

    let currentPixels = initial.pixels;
    let currentPreset: HairPresetKey | null = '02_brown_棕';

    for (const targetPreset of sequence) {
      currentPixels = recolorHair(currentPixels, initial.mask, palette, currentPreset, targetPreset);
      currentPreset = targetPreset;
    }

    // After full round-trip back to brown, pixels 0..3 must exactly match initial brown tiers
    for (let tier = 0; tier < 4; tier++) {
      expect(currentPixels[tier]).toBe(initial.pixels[tier]);
    }
  });

  it('auto-detects sourcePreset if sourcePreset is null when pixels match a ramp', () => {
    const { pixels, mask } = createHairTestBuffer('02_brown_棕');
    // When sourcePreset is null, it detects Brown and maps all 4 tiers 1:1 to Red
    const recolored = recolorHair(pixels, mask, palette, null, '09_red_红');
    const redRamp = RAMPS_INFO['09_red_红'].hexes;

    for (let tier = 0; tier < 4; tier++) {
      const actualHex = palette[recolored[tier]];
      expect(actualHex.toUpperCase()).toBe(redRamp[tier].toUpperCase());
    }
  });

  it('falls back to default algorithm for non-ramp color in hair mask without affecting ramp colors', () => {
    const { pixels, mask } = createHairTestBuffer('02_brown_棕');
    // Put a blue accessory pixel at index 10
    const blueIdx = palette.findIndex((c) => c.toUpperCase() === '#0063CE');
    pixels[10] = blueIdx;
    mask[10] = SemanticZone.Hair;

    const recolored = recolorHair(pixels, mask, palette, '02_brown_棕', '09_red_红');
    const redRamp = RAMPS_INFO['09_red_红'].hexes;

    // Ramp colors 0..3 must strictly map to Red tiers 0..3
    for (let tier = 0; tier < 4; tier++) {
      expect(palette[recolored[tier]].toUpperCase()).toBe(redRamp[tier].toUpperCase());
    }

    // Non-ramp color at index 10 was mapped via nearestTierForColor against targetRamp
    const expectedTier = nearestTierForColor('#0063CE', redRamp);
    expect(palette[recolored[10]].toUpperCase()).toBe(redRamp[expectedTier].toUpperCase());
  });

  it('simulates user changing hair, confirming, and changing again multiple times', () => {
    const { pixels, mask } = createHairTestBuffer('01_black_黑');
    let docPixels: Uint8Array = new Uint8Array(pixels);
    let docPreset: HairPresetKey | null = '01_black_黑';

    // Step 1: Change to Brown and commit
    docPixels = recolorHair(docPixels, mask, palette, docPreset, '02_brown_棕');
    docPreset = '02_brown_棕';
    const brownRamp = RAMPS_INFO['02_brown_棕'].hexes;
    for (let tier = 0; tier < 4; tier++) {
      expect(palette[docPixels[tier]].toUpperCase()).toBe(brownRamp[tier].toUpperCase());
    }

    // Step 2: Change to Red and commit
    docPixels = recolorHair(docPixels, mask, palette, docPreset, '09_red_红');
    docPreset = '09_red_红';
    const redRamp = RAMPS_INFO['09_red_红'].hexes;
    for (let tier = 0; tier < 4; tier++) {
      expect(palette[docPixels[tier]].toUpperCase()).toBe(redRamp[tier].toUpperCase());
    }

    // Step 3: Change to Blonde and commit
    docPixels = recolorHair(docPixels, mask, palette, docPreset, '03_blonde_金');
    docPreset = '03_blonde_金';
    const blondeRamp = RAMPS_INFO['03_blonde_金'].hexes;
    for (let tier = 0; tier < 4; tier++) {
      expect(palette[docPixels[tier]].toUpperCase()).toBe(blondeRamp[tier].toUpperCase());
    }

    // Step 4: Change back to Black and commit
    docPixels = recolorHair(docPixels, mask, palette, docPreset, '01_black_黑');
    docPreset = '01_black_黑';
    const blackRamp = RAMPS_INFO['01_black_黑'].hexes;
    for (let tier = 0; tier < 4; tier++) {
      expect(palette[docPixels[tier]].toUpperCase()).toBe(blackRamp[tier].toUpperCase());
    }
  });

  it('all 9 presets strictly define exactly 4 color tiers', () => {
    for (const [key, info] of Object.entries(RAMPS_INFO)) {
      expect(info.hexes.length, `${key} must have exactly 4 tiers`).toBe(4);
    }
  });

  it('correctly maps legacy 5-tier Blonde (containing #C68C31) into 4-tier Black without highlight artifacts', () => {
    const pixels = new Uint8Array(PIXEL_COUNT).fill(TRANSPARENT_INDEX);
    const mask = new Uint8Array(PIXEL_COUNT).fill(SemanticZone.Background);
    // Legacy 5 tiers: 0: 6B0818, 1: 7B4239, 2: C68C31 (shadow), 3: FFDE6B, 4: FFFFFF
    const legacyBlonde = ['#6B0818', '#7B4239', '#C68C31', '#FFDE6B', '#FFFFFF'];
    for (let i = 0; i < 5; i++) {
      const pIdx = palette.findIndex((c) => c.toUpperCase() === legacyBlonde[i].toUpperCase());
      pixels[i] = pIdx;
      mask[i] = SemanticZone.Hair;
    }

    const recolored = recolorHair(pixels, mask, palette, '03_blonde_金', '01_black_黑');
    const blackRamp = RAMPS_INFO['01_black_黑'].hexes;

    // Tier 0 -> Black 0 (#080821)
    expect(palette[recolored[0]].toUpperCase()).toBe(blackRamp[0].toUpperCase());
    // Tier 1 (7B4239) and Tier 2 (C68C31) both merge into Black 1 (#081039 shadow)
    expect(palette[recolored[1]].toUpperCase()).toBe(blackRamp[1].toUpperCase());
    expect(palette[recolored[2]].toUpperCase()).toBe(blackRamp[1].toUpperCase());
    // Tier 3 (FFDE6B) -> Black 2 (#212142 main body)
    expect(palette[recolored[3]].toUpperCase()).toBe(blackRamp[2].toUpperCase());
    // Tier 4 (FFFFFF) -> Black 3 (#8473A5 highlight)
    expect(palette[recolored[4]].toUpperCase()).toBe(blackRamp[3].toUpperCase());
  });
});
