import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  CURRENT_PROJECT_VERSION,
  upgradeProjectData,
  V1_HAIR_RAMPS,
} from '../src/core/projectMigration';
import { upgradeProjectZip } from '../src/app/browser/projectImportExport';
import { validateProjectData, assertProjectValid, uint8ArrayToBase64 } from '../src/core/projectData';
import { PALETTE_36, TRANSPARENT_INDEX, RAMPS_INFO } from '../src/core/constants';
import { SemanticZone } from '../src/core/types';
import { PIXEL_COUNT } from '../src/core/pixelGrid';

describe('Project Migration Pipeline (Progressive Version Upgrader)', () => {
  const v1Palette = [...PALETTE_36];
  v1Palette[17] = '#C68C31';

  function createV1BlondeProject(): Record<string, unknown> {
    const pixels = new Uint8Array(PIXEL_COUNT).fill(TRANSPARENT_INDEX);
    const mask = new Uint8Array(PIXEL_COUNT).fill(SemanticZone.None);

    // Legacy 5 tiers:
    // 0: #6B0818 (暗)
    // 1: #7B4239 (深)
    // 2: #C68C31 (影 - old 5th color)
    // 3: #FFDE6B (主)
    // 4: #FFFFFF (光)
    const v1Blonde = V1_HAIR_RAMPS['03_blonde_金'];
    for (let i = 0; i < 5; i++) {
      const pIdx = v1Palette.findIndex((c) => c.toUpperCase() === v1Blonde[i].toUpperCase());
      pixels[i] = pIdx;
      mask[i] = SemanticZone.Hair;
    }

    return {
      v: 1,
      palette: v1Palette,
      pixels: uint8ArrayToBase64(pixels),
      mask: uint8ArrayToBase64(mask),
      hairPreset: '03_blonde_金',
      ts: 1700000000,
    };
  }

  it('progressively migrates v1 to v2 and merges legacy 5th tier (#C68C31) into Tier 1 shadow', () => {
    const rawV1 = createV1BlondeProject();
    const result = upgradeProjectData(rawV1, 2);

    expect(result.upgraded).toBe(true);
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(2);
    expect(result.stepsApplied).toEqual(['v1 -> v2']);
    expect(result.data.v).toBe(2);

    // Validate using validateProjectData
    const validation = validateProjectData(result.data);
    expect(validation.valid).toBe(true);
    assertProjectValid(validation);
    expect(validation.data.v).toBe(2);

    // Decode pixels to verify tier convergence
    const validationBinary = atob(validation.data.pixels);
    const pixels = new Uint8Array(validationBinary.length);
    for (let i = 0; i < validationBinary.length; i++) {
      pixels[i] = validationBinary.charCodeAt(i);
    }

    const targetBlonde4 = RAMPS_INFO['03_blonde_金'].hexes;
    // 0 -> #6B0818 (暗)
    expect(v1Palette[pixels[0]].toUpperCase()).toBe(targetBlonde4[0].toUpperCase());
    // 1 (#7B4239) and 2 (#C68C31) BOTH merged into #7B4239 (Tier 1 影色)!
    expect(v1Palette[pixels[1]].toUpperCase()).toBe(targetBlonde4[1].toUpperCase());
    expect(v1Palette[pixels[2]].toUpperCase()).toBe(targetBlonde4[1].toUpperCase());
    // 3 -> #FFDE6B (主)
    expect(v1Palette[pixels[3]].toUpperCase()).toBe(targetBlonde4[2].toUpperCase());
    // 4 -> #FFFFFF (光)
    expect(v1Palette[pixels[4]].toUpperCase()).toBe(targetBlonde4[3].toUpperCase());
  });

  it('validateProjectData automatically runs upgradeProjectData on legacy v1 archives', () => {
    const rawV1 = createV1BlondeProject();
    const res = validateProjectData(rawV1);

    expect(res.valid).toBe(true);
    assertProjectValid(res);
    expect(res.upgraded).toBe(true);
    expect(res.fromVersion).toBe(1);
    expect(res.data.v).toBe(CURRENT_PROJECT_VERSION);
  });

  it('leaves already up-to-date v2 archives untouched', () => {
    const rawV1 = createV1BlondeProject();
    const upgraded = upgradeProjectData(rawV1, 2).data;

    const res2 = upgradeProjectData(upgraded, 2);
    expect(res2.upgraded).toBe(false);
    expect(res2.fromVersion).toBe(2);
    expect(res2.toVersion).toBe(2);
    expect(res2.stepsApplied).toHaveLength(0);
  });

  it('rejects unsupported future schema versions (e.g. v999)', () => {
    const raw = createV1BlondeProject();
    raw.v = 999;
    expect(() => upgradeProjectData(raw, 2)).toThrow(/不支持的未来版本/);
  });

  it('upgrades a real ZIP archive binary from v1 to v2 seamlessly', async () => {
    const rawV1 = createV1BlondeProject();
    const zip = new JSZip();
    zip.file('imagegem_project.json', JSON.stringify(rawV1));
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    const { zipBytes: upgradedBytes, upgraded, fromVersion, toVersion } = await upgradeProjectZip(zipBytes, 2);
    expect(upgraded).toBe(true);
    expect(fromVersion).toBe(1);
    expect(toVersion).toBe(2);

    // Verify upgraded ZIP content
    const reloadedZip = await JSZip.loadAsync(upgradedBytes);
    const reloadedJson = JSON.parse(await reloadedZip.file('imagegem_project.json')!.async('string'));
    expect(reloadedJson.v).toBe(2);
  });

  it('verifies real backup 5-tier zip file if present in Downloads', async () => {
    // @ts-expect-error Node fs module is imported dynamically in vitest environment without global @types/node
    const fs = await import('fs');
    const path = 'C:/Users/grand/Downloads/portrait_studio_project_1791009874949_backup_5tier.zip';
    if (!fs.existsSync(path)) {
      return;
    }

    const { importProjectZip } = await import('../src/app/browser/projectImportExport');
    const { projectDataToDocument } = await import('../src/core/projectData');
    const { recolorHair } = await import('../src/core/recolorEngine');

    const fileBuf = fs.readFileSync(path);
    const arrayBuf = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength);
    const projectData = await importProjectZip(arrayBuf);
    const { document: doc } = projectDataToDocument(projectData);

    // Verify all hair pixels in the imported doc belong ONLY to the 4-tier blonde palette
    const blonde4Hexes = new Set(RAMPS_INFO['03_blonde_金'].hexes.map((h) => h.toUpperCase()));
    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (doc.semanticMask[i] === SemanticZone.Hair) {
        const hex = doc.palette[doc.pixelIndices[i]].toUpperCase();
        expect(blonde4Hexes.has(hex)).toBe(true);
      }
    }

    // Now recolor to black
    const blackPixels = recolorHair(doc.pixelIndices, doc.semanticMask, doc.palette, doc.currentHairPreset, '01_black_黑');
    const black4Hexes = new Set(RAMPS_INFO['01_black_黑'].hexes.map((h) => h.toUpperCase()));
    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (doc.semanticMask[i] === SemanticZone.Hair) {
        const hex = doc.palette[blackPixels[i]].toUpperCase();
        // Zero unexpected colors or highlight artifacts! Every hair pixel must be in the 4-tier black ramp.
        expect(black4Hexes.has(hex)).toBe(true);
      }
    }
  });
});
