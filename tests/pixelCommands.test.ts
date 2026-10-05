import { describe, it, expect } from 'vitest';
import {
  StrokeCommand,
  StrokeParams,
  MovePatchCommand,
  ClearRectCommand,
  ReplaceColorCommand,
} from '../src/command/pixelCommands';
import { extractPatch, FULL_CANVAS } from '../src/core/editOps';
import { layersOf } from '../src/core/document';
import { CommandContext } from '../src/command/command';
import { SemanticZone } from '../src/core/types';
import { TRANSPARENT_INDEX } from '../src/core/constants';
import { IMAGE_WIDTH as W } from '../src/core/pixelGrid';
import {
  createValidDocument,
  assertDocumentInvariant,
} from './helpers/documentFixture';
import { createInitialSession } from '../src/core/session';

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

describe('Pixel Commands Unified Transparent Rules (T02 - B1)', () => {
  it('eraser clears locked zone pixel to transparent and resets mask to Background', () => {
    // Setup document with pixel at (5, 5) as color 10, zone Hair
    const doc = createValidDocument({
      pixels: (setPixel) => {
        setPixel(5, 5, 10, SemanticZone.Hair);
        setPixel(6, 5, 10, SemanticZone.Skin);
      },
    });
    const { ctx } = createContext(doc);

    // Hair and Skin are locked!
    const strokeParams: StrokeParams = {
      mode: 'pixel',
      pixelTool: 'eraser',
      maskTool: 'pen',
      button: 0,
      replaceAll: false,
      fg: 0,
      bg: TRANSPARENT_INDEX,
      zone: SemanticZone.Background,
      lockedZones: [SemanticZone.Hair, SemanticZone.Skin],
      brushSize: 1,
      selection: null,
      diagonal: true,
    };

    const cmd = new StrokeCommand(strokeParams);
    cmd.init(ctx);
    cmd.dab(ctx, 5, 5);
    cmd.end(ctx);

    const offset5 = 5 * W + 5;
    expect(doc.pixelIndices[offset5]).toBe(TRANSPARENT_INDEX);
    // Highest priority invariant: transparent pixel mask must be Background even if Hair is locked
    expect(doc.semanticMask[offset5]).toBe(SemanticZone.Background);
    assertDocumentInvariant(doc);
  });

  it('right-click with transparent bg clears locked zone pixel and resets mask to Background', () => {
    const doc = createValidDocument({
      pixels: (setPixel) => {
        setPixel(10, 10, 8, SemanticZone.Clothes);
      },
    });
    const { ctx } = createContext(doc);

    const strokeParams: StrokeParams = {
      mode: 'pixel',
      pixelTool: 'pen',
      maskTool: 'pen',
      button: 2, // Right click -> draws bg
      replaceAll: false,
      fg: 0,
      bg: TRANSPARENT_INDEX,
      zone: SemanticZone.Background,
      lockedZones: [SemanticZone.Clothes],
      brushSize: 1,
      selection: null,
      diagonal: true,
    };

    const cmd = new StrokeCommand(strokeParams);
    cmd.init(ctx);
    cmd.dab(ctx, 10, 10);
    cmd.end(ctx);

    const offset = 10 * W + 10;
    expect(doc.pixelIndices[offset]).toBe(TRANSPARENT_INDEX);
    expect(doc.semanticMask[offset]).toBe(SemanticZone.Background);
    assertDocumentInvariant(doc);
  });

  it('pen tool with transparent fg clears locked zone pixel and resets mask to Background', () => {
    const doc = createValidDocument({
      pixels: (setPixel) => {
        setPixel(12, 12, 15, SemanticZone.Eyes);
      },
    });
    const { ctx } = createContext(doc);

    const strokeParams: StrokeParams = {
      mode: 'pixel',
      pixelTool: 'pen',
      maskTool: 'pen',
      button: 0,
      replaceAll: false,
      fg: TRANSPARENT_INDEX, // Pen drawing transparent
      bg: 0,
      zone: SemanticZone.Background,
      lockedZones: [SemanticZone.Eyes],
      brushSize: 1,
      selection: null,
      diagonal: true,
    };

    const cmd = new StrokeCommand(strokeParams);
    cmd.init(ctx);
    cmd.dab(ctx, 12, 12);
    cmd.end(ctx);

    const offset = 12 * W + 12;
    expect(doc.pixelIndices[offset]).toBe(TRANSPARENT_INDEX);
    expect(doc.semanticMask[offset]).toBe(SemanticZone.Background);
    assertDocumentInvariant(doc);
  });

  it('bucket fill with transparent color resets all filled pixels and their masks to Background', () => {
    const doc = createValidDocument({
      pixels: (setPixel) => {
        // Connected 3x3 square of color 7 with Skin mask
        for (let dy = 0; dy < 3; dy++) {
          for (let dx = 0; dx < 3; dx++) {
            setPixel(20 + dx, 20 + dy, 7, SemanticZone.Skin);
          }
        }
      },
    });
    const { ctx } = createContext(doc);

    const strokeParams: StrokeParams = {
      mode: 'pixel',
      pixelTool: 'bucket',
      maskTool: 'pen',
      button: 0,
      replaceAll: false,
      fg: TRANSPARENT_INDEX,
      bg: 0,
      zone: SemanticZone.Background,
      lockedZones: [SemanticZone.Skin],
      brushSize: 1,
      selection: null,
      diagonal: false,
    };

    const cmd = new StrokeCommand(strokeParams);
    cmd.init(ctx);
    cmd.dab(ctx, 21, 21); // fill in the middle of 3x3
    cmd.end(ctx);

    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const offset = (20 + dy) * W + (20 + dx);
        expect(doc.pixelIndices[offset]).toBe(TRANSPARENT_INDEX);
        expect(doc.semanticMask[offset]).toBe(SemanticZone.Background);
      }
    }
    assertDocumentInvariant(doc);
  });

  it('movePatch (cut/move) clears original position to transparent and resets mask to Background even if locked', () => {
    const doc = createValidDocument({
      pixels: (setPixel) => {
        setPixel(2, 2, 5, SemanticZone.Hair);
        setPixel(3, 2, 6, SemanticZone.Skin);
      },
    });
    const { ctx } = createContext(doc);

    const lockedZones = [SemanticZone.Hair, SemanticZone.Skin];
    const fromRect = { x: 2, y: 2, w: 2, h: 1 };
    const patch = extractPatch(layersOf(doc, lockedZones), fromRect);

    const cmd = new MovePatchCommand(patch, fromRect, 10, 10, false /* copy = false -> cut */, lockedZones);
    cmd.init(ctx);
    cmd.execute(ctx);

    // Old location: (2,2) and (3,2) must be transparent and Background
    expect(doc.pixelIndices[2 * W + 2]).toBe(TRANSPARENT_INDEX);
    expect(doc.semanticMask[2 * W + 2]).toBe(SemanticZone.Background);
    expect(doc.pixelIndices[2 * W + 3]).toBe(TRANSPARENT_INDEX);
    expect(doc.semanticMask[2 * W + 3]).toBe(SemanticZone.Background);

    // New location: (10,10) and (11,10)
    expect(doc.pixelIndices[10 * W + 10]).toBe(5);
    expect(doc.semanticMask[10 * W + 10]).toBe(SemanticZone.Hair);
    expect(doc.pixelIndices[10 * W + 11]).toBe(6);
    expect(doc.semanticMask[10 * W + 11]).toBe(SemanticZone.Skin);

    assertDocumentInvariant(doc);
  });

  it('ClearRectCommand resets masks of all cleared pixels to Background regardless of zone lock', () => {
    const doc = createValidDocument({
      pixels: (setPixel) => {
        setPixel(30, 30, 1, SemanticZone.Clothes);
        setPixel(31, 30, 2, SemanticZone.Clothes);
      },
    });
    const { ctx } = createContext(doc);

    const cmd = new ClearRectCommand({ x: 30, y: 30, w: 2, h: 1 }, [SemanticZone.Clothes]);
    cmd.init(ctx);
    cmd.execute(ctx);

    expect(doc.pixelIndices[30 * W + 30]).toBe(TRANSPARENT_INDEX);
    expect(doc.semanticMask[30 * W + 30]).toBe(SemanticZone.Background);
    expect(doc.pixelIndices[30 * W + 31]).toBe(TRANSPARENT_INDEX);
    expect(doc.semanticMask[30 * W + 31]).toBe(SemanticZone.Background);

    assertDocumentInvariant(doc);
  });

  it('ReplaceColorCommand replacing color with transparent resets mask to Background even if locked', () => {
    const doc = createValidDocument({
      pixels: (setPixel) => {
        setPixel(40, 40, 12, SemanticZone.Eyes);
        setPixel(41, 40, 12, SemanticZone.Eyes);
      },
    });
    const { ctx } = createContext(doc);

    const cmd = new ReplaceColorCommand(12, TRANSPARENT_INDEX, FULL_CANVAS, [SemanticZone.Eyes]);
    cmd.init(ctx);
    cmd.execute(ctx);

    expect(doc.pixelIndices[40 * W + 40]).toBe(TRANSPARENT_INDEX);
    expect(doc.semanticMask[40 * W + 40]).toBe(SemanticZone.Background);
    expect(doc.pixelIndices[40 * W + 41]).toBe(TRANSPARENT_INDEX);
    expect(doc.semanticMask[40 * W + 41]).toBe(SemanticZone.Background);

    assertDocumentInvariant(doc);
  });
});
