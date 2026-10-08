import { describe, it, expect } from 'vitest';
import { CommandHandler, UNDO_LIMIT } from '../src/command/commandHandler';
import { Command, CommandContext } from '../src/command/command';
import { SetPaletteColorCommand, CommitHairRecolorCommand, ResetPaletteCommand } from '../src/command/paletteCommands';
import { SetMaskCommand } from '../src/command/maskCommands';
import { createEmptyDocument } from '../src/core/document';
import { createInitialSession } from '../src/core/session';
import { PALETTE_36, TRANSPARENT_INDEX } from '../src/core/constants';
import { SemanticZone } from '../src/core/types';
import { documentToProjectData, validateProjectData } from '../src/core/projectData';

class MockCommand extends Command {
  readonly name: string;
  private changeValue: number;
  private previousValue = 0;
  executed = 0;
  undone = 0;

  constructor(name: string, changeValue: number) {
    super();
    this.name = name;
    this.changeValue = changeValue;
  }

  execute(ctx: CommandContext): boolean {
    this.previousValue = ctx.doc.pixelIndices[0];
    ctx.doc.pixelIndices[0] = this.changeValue;
    this.executed++;
    return true;
  }

  undo(ctx: CommandContext): void {
    ctx.doc.pixelIndices[0] = this.previousValue;
    this.undone++;
  }

  mergeWith(next: Command, ctx: CommandContext): boolean {
    if (next instanceof MockCommand && next.name === this.name) {
      this.changeValue = next.changeValue;
      ctx.doc.pixelIndices[0] = this.changeValue;
      return true;
    }
    return false;
  }
}

class NoopCommand extends Command {
  readonly name = 'Noop';
  execute(): boolean {
    return false; // Return false to indicate no changes
  }
  undo(): void {}
}

function createTestContext(): CommandContext {
  return {
    doc: createEmptyDocument(),
    session: createInitialSession(),
    events: {},
  };
}

describe('CommandHandler', () => {
  it('executes command, pushes to history, and supports undo/redo', () => {
    const ctx = createTestContext();
    const handler = new CommandHandler(ctx);

    expect(handler.canUndo()).toBe(false);
    expect(handler.canRedo()).toBe(false);

    const cmd1 = new MockCommand('cmd1', 10);
    handler.execute(cmd1);
    expect(ctx.doc.pixelIndices[0]).toBe(10);
    expect(handler.canUndo()).toBe(true);
    expect(handler.canRedo()).toBe(false);

    handler.undo();
    expect(ctx.doc.pixelIndices[0]).toBe(255); // Reset to transparent
    expect(handler.canUndo()).toBe(false);
    expect(handler.canRedo()).toBe(true);

    handler.redo();
    expect(ctx.doc.pixelIndices[0]).toBe(10);
    expect(handler.canUndo()).toBe(true);
    expect(handler.canRedo()).toBe(false);
  });

  it('drops redo branch when a new command is executed after undo', () => {
    const ctx = createTestContext();
    const handler = new CommandHandler(ctx);

    handler.execute(new MockCommand('cmd1', 1));
    handler.execute(new MockCommand('cmd2', 2));
    handler.undo(); // undo cmd2

    expect(handler.canRedo()).toBe(true);
    // Execute cmd3
    handler.execute(new MockCommand('cmd3', 3));
    expect(handler.canRedo()).toBe(false); // Redo branch dropped
    expect(ctx.doc.pixelIndices[0]).toBe(3);
  });

  it('does not push commands that return false in execute (no-op)', () => {
    const ctx = createTestContext();
    const handler = new CommandHandler(ctx);

    const success = handler.execute(new NoopCommand());
    expect(success).toBe(false);
    expect(handler.canUndo()).toBe(false);
  });

  it('merges consecutive mergeable commands', () => {
    const ctx = createTestContext();
    const handler = new CommandHandler(ctx);

    handler.execute(new MockCommand('mergeable', 1));
    handler.execute(new MockCommand('mergeable', 2));
    handler.execute(new MockCommand('mergeable', 3));

    expect(ctx.doc.pixelIndices[0]).toBe(3);
    // Because they merged into one, undoing once should undo the whole sequence
    handler.undo();
    expect(ctx.doc.pixelIndices[0]).toBe(255);
    expect(handler.canUndo()).toBe(false);
  });

  it('respects UNDO_LIMIT (40) by dropping oldest commands', () => {
    const ctx = createTestContext();
    const handler = new CommandHandler(ctx);

    for (let i = 0; i < 50; i++) {
      handler.execute(new MockCommand(`cmd_${i}`, i));
    }

    let undoCount = 0;
    while (handler.canUndo()) {
      handler.undo();
      undoCount++;
    }
    expect(undoCount).toBe(UNDO_LIMIT);
  });

  it('rejects invalid inputs via init() without modifying document or pushing to history', () => {
    const ctx = createTestContext();
    const handler = new CommandHandler(ctx);

    // 1. SetPaletteColor with invalid hex or out-of-range index
    expect(handler.execute(new SetPaletteColorCommand(99, '#FF0000'))).toBe(false);
    expect(handler.execute(new SetPaletteColorCommand(0, 'invalid-hex'))).toBe(false);
    expect(handler.canUndo()).toBe(false);

    // 2. SetMaskCommand with invalid length or out-of-bounds zone
    const shortMask = new Uint8Array(10);
    expect(handler.execute(new SetMaskCommand(shortMask))).toBe(false);
    const invalidValMask = new Uint8Array(4096).fill(99);
    expect(handler.execute(new SetMaskCommand(invalidValMask))).toBe(false);
    expect(handler.canUndo()).toBe(false);

    // 3. CommitHairRecolorCommand with invalid length or unknown presetKey
    const shortPixels = new Uint8Array(20);
    expect(handler.execute(new CommitHairRecolorCommand(shortPixels, '01_black_黑'))).toBe(false);
    expect(
      handler.execute(new CommitHairRecolorCommand(new Uint8Array(4096), 'invalid_preset' as any))
    ).toBe(false);
    expect(handler.canUndo()).toBe(false);
  });

  it('rejects invalid colors during a merged gesture without changing events or undo/redo snapshots', () => {
    const ctx = createTestContext();
    const handler = new CommandHandler(ctx);
    const originalPalette = [...ctx.doc.palette];
    let paletteEvents = 0;
    let historyEvents = 0;
    ctx.events.onPaletteChanged = () => { paletteEvents++; };
    ctx.events.onHistoryChanged = () => { historyEvents++; };

    expect(handler.execute(new SetPaletteColorCommand(0, '#112233', 42))).toBe(true);
    expect(handler.execute(new SetPaletteColorCommand(0, 'invalid-hex', 42))).toBe(false);
    expect(ctx.doc.palette[0]).toBe('#112233');
    expect(paletteEvents).toBe(1);
    expect(historyEvents).toBe(1);
    expect(validateProjectData(documentToProjectData(ctx.doc)).valid).toBe(true);

    expect(handler.undo()).toBe(true);
    expect(ctx.doc.palette).toEqual(originalPalette);
    expect(handler.canUndo()).toBe(false);
    // A rejected command must also preserve the existing redo branch.
    expect(handler.execute(new SetPaletteColorCommand(0, 'invalid-hex', 42))).toBe(false);
    expect(handler.canRedo()).toBe(true);
    expect(handler.redo()).toBe(true);
    expect(ctx.doc.palette[0]).toBe('#112233');
  });

  it.each([NaN, Infinity, 0.5, -1, PALETTE_36.length])('rejects invalid palette index %s for color changes and resets', (index) => {
    const ctx = createTestContext();
    const handler = new CommandHandler(ctx);
    const originalPalette = [...ctx.doc.palette];

    expect(handler.execute(new SetPaletteColorCommand(index, '#112233'))).toBe(false);
    expect(handler.execute(new ResetPaletteCommand(index))).toBe(false);
    expect(ctx.doc.palette).toEqual(originalPalette);
    expect(Object.keys(ctx.doc.palette)).toHaveLength(PALETTE_36.length);
    expect(handler.canUndo()).toBe(false);
  });

  it.each([36, 200, 254])('rejects hair pixel index %s without changing the document, events or redo branch', (index) => {
    const ctx = createTestContext();
    const handler = new CommandHandler(ctx);
    handler.execute(new SetPaletteColorCommand(0, '#112233'));
    handler.undo();
    const before = documentToProjectData(ctx.doc, 0);
    let documentEvents = 0;
    ctx.events.onPixelsChanged = () => { documentEvents++; };
    ctx.events.onMaskChanged = () => { documentEvents++; };
    ctx.events.onHairPresetChanged = () => { documentEvents++; };
    ctx.events.onHistoryChanged = () => { documentEvents++; };
    const pixels = new Uint8Array(ctx.doc.pixelIndices);
    // Test the last position so validation cannot stop after a legal prefix.
    pixels[pixels.length - 1] = index;

    expect(handler.execute(new CommitHairRecolorCommand(pixels, '01_black_黑'))).toBe(false);
    expect(documentToProjectData(ctx.doc, 0)).toEqual(before);
    expect(documentEvents).toBe(0);
    expect(handler.canUndo()).toBe(false);
    expect(handler.canRedo()).toBe(true);
    expect(handler.redo()).toBe(true);
    expect(ctx.doc.palette[0]).toBe('#112233');
  });

  it('accepts legal hair pixel boundaries and restores transparent masks through undo/redo', () => {
    const ctx = createTestContext();
    const handler = new CommandHandler(ctx);
    ctx.doc.pixelIndices[2] = 0;
    ctx.doc.semanticMask[2] = SemanticZone.Hair;
    const before = documentToProjectData(ctx.doc, 0);
    const pixels = new Uint8Array(ctx.doc.pixelIndices);
    pixels[0] = 0;
    pixels[1] = PALETTE_36.length - 1;
    pixels[2] = TRANSPARENT_INDEX;

    expect(handler.execute(new CommitHairRecolorCommand(pixels, '01_black_黑'))).toBe(true);
    expect(ctx.doc.pixelIndices).toEqual(pixels);
    expect(ctx.doc.semanticMask[2]).toBe(SemanticZone.None);
    expect(ctx.doc.currentHairPreset).toBe('01_black_黑');
    expect(validateProjectData(documentToProjectData(ctx.doc)).valid).toBe(true);
    const after = documentToProjectData(ctx.doc, 0);
    handler.undo();
    expect(documentToProjectData(ctx.doc, 0)).toEqual(before);
    handler.redo();
    expect(documentToProjectData(ctx.doc, 0)).toEqual(after);
  });
});
