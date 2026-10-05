import { describe, it, expect } from 'vitest';
import {
  SetPaletteColorCommand,
  SetHairPresetCommand,
  nextGestureId,
} from '../src/command/paletteCommands';
import { CommandHandler } from '../src/command/commandHandler';
import { CommandContext } from '../src/command/command';
import { createValidDocument } from './helpers/documentFixture';
import { createInitialSession } from '../src/core/session';

function createContext() {
  const doc = createValidDocument();
  const session = createInitialSession();
  const events = {
    onPixelsChanged: () => {},
    onMaskChanged: () => {},
    onPaletteChanged: () => {},
    onHairPresetChanged: () => {},
    onSessionChanged: () => {},
    onHistoryChanged: () => {},
  };
  const ctx: CommandContext = { doc, session, events };
  const handler = new CommandHandler(ctx);
  return { ctx, handler, doc };
}

describe('Gesture Aggregation and Command History Isolation (T05 - B3)', () => {
  it('aggregates multiple consecutive color changes with identical gesture and index into a single undo step', () => {
    const { handler, doc } = createContext();
    const initialColor = doc.palette[0];
    const gesture = nextGestureId();

    // User drags color picker on slot 0
    handler.execute(new SetPaletteColorCommand(0, '#111111', gesture));
    expect(doc.palette[0]).toBe('#111111');
    expect(handler.canUndo()).toBe(true);

    handler.execute(new SetPaletteColorCommand(0, '#222222', gesture));
    expect(doc.palette[0]).toBe('#222222');

    handler.execute(new SetPaletteColorCommand(0, '#333333', gesture));
    expect(doc.palette[0]).toBe('#333333');

    // Single undo must restore directly to initialColor in one step
    const didUndo = handler.undo();
    expect(didUndo).toBe(true);
    expect(doc.palette[0]).toBe(initialColor);

    // No further undo available because all 3 were merged into 1 step
    expect(handler.canUndo()).toBe(false);

    // Redo restores final state of the merged gesture
    handler.redo();
    expect(doc.palette[0]).toBe('#333333');
  });

  it('does NOT merge when gesture is the same but index changes (B3 slot switch defect)', () => {
    const { handler, doc } = createContext();
    const initialSlot0 = doc.palette[0];
    const initialSlot1 = doc.palette[1];
    const gesture = nextGestureId();

    // User edits slot 0 with gesture
    handler.execute(new SetPaletteColorCommand(0, '#AAAAAA', gesture));
    expect(doc.palette[0]).toBe('#AAAAAA');

    // Anomaly/Fast switch: slot changes to 1 during the same gesture
    handler.execute(new SetPaletteColorCommand(1, '#BBBBBB', gesture));
    expect(doc.palette[1]).toBe('#BBBBBB');

    // First undo must only undo slot 1
    handler.undo();
    expect(doc.palette[1]).toBe(initialSlot1);
    expect(doc.palette[0]).toBe('#AAAAAA');

    // Second undo must undo slot 0
    handler.undo();
    expect(doc.palette[0]).toBe(initialSlot0);
    expect(handler.canUndo()).toBe(false);
  });

  it('does NOT merge when gesture is 0 or omitted (discrete clicks)', () => {
    const { handler, doc } = createContext();
    const initialColor = doc.palette[2];

    // Single click 1: gesture = 0
    handler.execute(new SetPaletteColorCommand(2, '#121212', 0));
    expect(doc.palette[2]).toBe('#121212');

    // Single click 2: default gesture = 0
    handler.execute(new SetPaletteColorCommand(2, '#343434'));
    expect(doc.palette[2]).toBe('#343434');

    // Must require 2 separate undos
    handler.undo();
    expect(doc.palette[2]).toBe('#121212');

    handler.undo();
    expect(doc.palette[2]).toBe(initialColor);
    expect(handler.canUndo()).toBe(false);
  });

  it('breaks gesture merge sequence when an intervening command is executed', () => {
    const { handler, doc } = createContext();
    const initialColor = doc.palette[3];
    const gesture = nextGestureId();

    // Step 1: gesture edit on slot 3
    handler.execute(new SetPaletteColorCommand(3, '#555555', gesture));
    expect(doc.palette[3]).toBe('#555555');

    // Intervening command: change hair preset
    handler.execute(new SetHairPresetCommand('03_blonde_金'));
    expect(doc.currentHairPreset).toBe('03_blonde_金');

    // Step 3: edit on slot 3 with same gesture (interrupted by preset command)
    handler.execute(new SetPaletteColorCommand(3, '#777777', gesture));
    expect(doc.palette[3]).toBe('#777777');

    // Undo 1: should undo the second palette change (#777777 -> #555555)
    handler.undo();
    expect(doc.palette[3]).toBe('#555555');
    expect(doc.currentHairPreset).toBe('03_blonde_金');

    // Undo 2: should undo hair preset
    handler.undo();
    expect(doc.currentHairPreset).not.toBe('03_blonde_金');
    expect(doc.palette[3]).toBe('#555555');

    // Undo 3: should undo the first palette change (#555555 -> initialColor)
    handler.undo();
    expect(doc.palette[3]).toBe(initialColor);
  });

  it('nextGestureId generates unique strictly monotonically increasing IDs', () => {
    const id1 = nextGestureId();
    const id2 = nextGestureId();
    const id3 = nextGestureId();

    expect(id2).toBeGreaterThan(id1);
    expect(id3).toBeGreaterThan(id2);
  });
});
