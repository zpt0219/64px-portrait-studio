import { describe, it, expect } from 'vitest';
import {
  MaskBoxSelectCommand,
  AssignColorToZoneCommand,
} from '../src/command/maskCommands';
import {
  canAssignZone,
  floodFillMask,
  assignColorToMask,
  FULL_CANVAS,
} from '../src/core/editOps';
import { layersOf } from '../src/model/document';
import { CommandContext } from '../src/command/command';
import { SemanticZone } from '../src/types';
import { TRANSPARENT_INDEX } from '../src/data/palette';
import { IMAGE_WIDTH as W } from '../src/core/pixelGrid';
import {
  createValidDocument,
  assertDocumentInvariant,
} from './helpers/documentFixture';
import { createInitialSession } from '../src/model/session';

function createContext(doc = createValidDocument()) {
  const session = createInitialSession();
  const events = {
    onPixelsChanged: () => {},
    onMaskChanged: () => {},
    onPaletteChanged: () => {},
    onHairPresetChanged: () => {},
    onSessionChanged: () => {},
  };
  return { ctx: { doc, session, events } as CommandContext };
}

describe('Mask Command Lock and Penetration Defense (T03 - B2)', () => {
  describe('canAssignZone pure policy function', () => {
    it('rejects transparent pixel assigned to any non-background zone', () => {
      expect(canAssignZone(TRANSPARENT_INDEX, SemanticZone.Background, SemanticZone.Hair, [])).toBe(false);
      expect(canAssignZone(TRANSPARENT_INDEX, SemanticZone.Background, SemanticZone.Skin, [])).toBe(false);
      expect(canAssignZone(TRANSPARENT_INDEX, SemanticZone.Background, SemanticZone.Eyes, [])).toBe(false);
      expect(canAssignZone(TRANSPARENT_INDEX, SemanticZone.Background, SemanticZone.Clothes, [])).toBe(false);
    });

    it('rejects writing to a locked target zone (B2 defect)', () => {
      // Hair is locked, cannot add pixels into Hair
      expect(canAssignZone(5, SemanticZone.Background, SemanticZone.Hair, [SemanticZone.Hair])).toBe(false);
      expect(canAssignZone(5, SemanticZone.Skin, SemanticZone.Hair, [SemanticZone.Hair])).toBe(false);
      // But Background can always be targeted (clearing) even if non-background zones are locked
      expect(canAssignZone(5, SemanticZone.Skin, SemanticZone.Background, [SemanticZone.Hair])).toBe(true);
    });

    it('rejects modifying a pixel whose current zone is locked', () => {
      // Skin is locked, cannot reassign skin pixel to Clothes or Background
      expect(canAssignZone(5, SemanticZone.Skin, SemanticZone.Clothes, [SemanticZone.Skin])).toBe(false);
      expect(canAssignZone(5, SemanticZone.Skin, SemanticZone.Background, [SemanticZone.Skin])).toBe(false);
    });

    it('rejects assignment when currentZone equals targetZone', () => {
      expect(canAssignZone(5, SemanticZone.Skin, SemanticZone.Skin, [])).toBe(false);
    });

    it('accepts valid assignment when no locks interfere', () => {
      expect(canAssignZone(5, SemanticZone.Background, SemanticZone.Skin, [])).toBe(true);
      expect(canAssignZone(5, SemanticZone.Hair, SemanticZone.Skin, [])).toBe(true);
    });

    it('works with Set as well as Array for lockedZones', () => {
      const lockedSet = new Set([SemanticZone.Hair]);
      expect(canAssignZone(5, SemanticZone.Background, SemanticZone.Hair, lockedSet)).toBe(false);
      expect(canAssignZone(5, SemanticZone.Hair, SemanticZone.Skin, lockedSet)).toBe(false);
      expect(canAssignZone(5, SemanticZone.Skin, SemanticZone.Clothes, lockedSet)).toBe(true);
    });
  });

  describe('Target lock bypass defense (B2)', () => {
    it('MaskBoxSelectCommand add does not write to target zone when target zone is locked', () => {
      const doc = createValidDocument({
        pixels: (setPixel) => {
          setPixel(5, 5, 8, SemanticZone.Background);
          setPixel(6, 5, 8, SemanticZone.Background);
        },
      });
      const { ctx } = createContext(doc);

      // Attempt to box-select add pixels to Hair, but Hair is locked!
      const cmd = new MaskBoxSelectCommand(
        { x: 5, y: 5, w: 2, h: 1 },
        'add',
        new Set([8]),
        SemanticZone.Hair,
        [SemanticZone.Hair] // target zone Hair is locked
      );

      cmd.init(ctx);
      cmd.execute(ctx);

      expect(cmd.count).toBe(0);
      expect(doc.semanticMask[5 * W + 5]).toBe(SemanticZone.Background);
      expect(doc.semanticMask[5 * W + 6]).toBe(SemanticZone.Background);
      assertDocumentInvariant(doc);
    });

    it('AssignColorToZoneCommand does not write to target zone when target zone is locked', () => {
      const doc = createValidDocument({
        pixels: (setPixel) => {
          setPixel(10, 10, 15, SemanticZone.Background);
          setPixel(11, 10, 15, SemanticZone.Background);
        },
      });
      const { ctx } = createContext(doc);

      // Attempt to assign all color 15 to Skin, but Skin is locked!
      const cmd = new AssignColorToZoneCommand(15, SemanticZone.Skin, [SemanticZone.Skin]);
      cmd.init(ctx);
      cmd.execute(ctx);

      expect(cmd.count).toBe(0);
      expect(doc.semanticMask[10 * W + 10]).toBe(SemanticZone.Background);
      expect(doc.semanticMask[10 * W + 11]).toBe(SemanticZone.Background);
      assertDocumentInvariant(doc);
    });

    it('assignColorToMask does not write to target zone when target zone is locked', () => {
      const doc = createValidDocument({
        pixels: (setPixel) => {
          setPixel(15, 15, 20, SemanticZone.Background);
        },
      });
      const layers = layersOf(doc, [SemanticZone.Clothes]);

      const count = assignColorToMask(layers, 20, SemanticZone.Clothes, FULL_CANVAS);
      expect(count).toBe(0);
      expect(doc.semanticMask[15 * W + 15]).toBe(SemanticZone.Background);
      assertDocumentInvariant(doc);
    });

    it('floodFillMask does not write to target zone when target zone is locked', () => {
      const doc = createValidDocument({
        pixels: (setPixel) => {
          setPixel(20, 20, 22, SemanticZone.Background);
        },
      });
      const layers = layersOf(doc, [SemanticZone.Eyes]);

      const changed = floodFillMask(layers, 20, 20, SemanticZone.Eyes, false, FULL_CANVAS);
      expect(changed).toBe(false);
      expect(doc.semanticMask[20 * W + 20]).toBe(SemanticZone.Background);
      assertDocumentInvariant(doc);
    });
  });

  describe('Source lock protection', () => {
    it('MaskBoxSelectCommand add does not overwrite pixels in locked source zone', () => {
      const doc = createValidDocument({
        pixels: (setPixel) => {
          setPixel(5, 5, 8, SemanticZone.Hair);
        },
      });
      const { ctx } = createContext(doc);

      // Hair is locked, target is Skin
      const cmd = new MaskBoxSelectCommand(
        { x: 5, y: 5, w: 1, h: 1 },
        'add',
        new Set([8]),
        SemanticZone.Skin,
        [SemanticZone.Hair]
      );
      cmd.init(ctx);
      cmd.execute(ctx);

      expect(cmd.count).toBe(0);
      expect(doc.semanticMask[5 * W + 5]).toBe(SemanticZone.Hair);
      assertDocumentInvariant(doc);
    });

    it('MaskBoxSelectCommand subtract/remove does not clear pixels in locked source zone', () => {
      const doc = createValidDocument({
        pixels: (setPixel) => {
          setPixel(6, 6, 8, SemanticZone.Clothes);
        },
      });
      const { ctx } = createContext(doc);

      // Clothes is locked, attempt to clear Clothes
      const cmd = new MaskBoxSelectCommand(
        { x: 6, y: 6, w: 1, h: 1 },
        'clear',
        new Set([8]),
        SemanticZone.Clothes,
        [SemanticZone.Clothes]
      );
      cmd.init(ctx);
      cmd.execute(ctx);

      expect(cmd.count).toBe(0);
      expect(doc.semanticMask[6 * W + 6]).toBe(SemanticZone.Clothes);
      assertDocumentInvariant(doc);
    });
  });

  describe('Bucket fill penetration defense', () => {
    it('floodFillMask cannot penetrate or cross a locked zone barrier', () => {
      // Create a 5x5 region of the SAME pixel color (e.g. color 3)
      // Outside is Background
      // A ring around (2,2) at radius 1 is marked as Hair and LOCKED
      // Center (2,2) is marked as Background
      // We start flood filling at (0,0) with target zone Skin
      // It should NOT penetrate the locked Hair ring to reach center (2,2)
      const doc = createValidDocument({
        pixels: (setPixel) => {
          for (let y = 0; y < 5; y++) {
            for (let x = 0; x < 5; x++) {
              setPixel(x, y, 3, SemanticZone.Background);
            }
          }
          // Build locked ring of Hair around (2,2):
          // (1,1), (2,1), (3,1)
          // (1,2),        (3,2)
          // (1,3), (2,3), (3,3)
          const ring = [
            [1, 1], [2, 1], [3, 1],
            [1, 2],         [3, 2],
            [1, 3], [2, 3], [3, 3],
          ];
          for (const [rx, ry] of ring) {
            setPixel(rx, ry, 3, SemanticZone.Hair);
          }
        },
      });

      const lockedZones = [SemanticZone.Hair];
      const layers = layersOf(doc, lockedZones);

      // 4-way flood fill starting from (0,0) into Skin
      const changed = floodFillMask(layers, 0, 0, SemanticZone.Skin, false, { x: 0, y: 0, w: 5, h: 5 });
      expect(changed).toBe(true);

      // (0,0) was filled with Skin
      expect(doc.semanticMask[0]).toBe(SemanticZone.Skin);

      // Locked ring remains Hair
      expect(doc.semanticMask[1 * W + 1]).toBe(SemanticZone.Hair);
      expect(doc.semanticMask[1 * W + 2]).toBe(SemanticZone.Hair);
      expect(doc.semanticMask[2 * W + 1]).toBe(SemanticZone.Hair);
      expect(doc.semanticMask[3 * W + 3]).toBe(SemanticZone.Hair);

      // The center inside the ring must NOT have been penetrated!
      expect(doc.semanticMask[2 * W + 2]).toBe(SemanticZone.Background);

      assertDocumentInvariant(doc);
    });
  });
});
