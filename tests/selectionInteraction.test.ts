import { describe, it, expect, vi } from 'vitest';
import { SelectionInteraction } from '../src/panels/canvas/SelectionInteraction';
import { createEmptyDocument } from '../src/model/document';

describe('SelectionInteraction', () => {
  it('manages box selection coordinate bounding correctly', () => {
    const si = new SelectionInteraction();
    expect(si.boxSelect).toBeNull();

    // Drag down-right: (10, 10) to (20, 25)
    si.startBoxSelect(10, 10, null);
    expect(si.boxSelect).toEqual({
      start: [10, 10],
      rect: { x: 10, y: 10, w: 1, h: 1 },
      maskAction: null,
    });

    si.updateBoxSelect(20, 25);
    expect(si.boxSelect?.rect).toEqual({ x: 10, y: 10, w: 11, h: 16 });

    // Drag up-left: (10, 10) to (5, 4)
    si.updateBoxSelect(5, 4);
    expect(si.boxSelect?.rect).toEqual({ x: 5, y: 4, w: 6, h: 7 });

    si.cancel();
    expect(si.boxSelect).toBeNull();
  });

  it('manages moving selection and copy latch', () => {
    const si = new SelectionInteraction();
    const doc = createEmptyDocument();
    doc.pixelIndices[10 * 64 + 10] = 5;

    expect(si.moving).toBeNull();
    expect(si.isCopy).toBe(false);

    si.startMoving(10, 10, { x: 10, y: 10, w: 5, h: 5 }, doc, false);
    expect(si.moving).not.toBeNull();
    expect(si.moving?.offset).toEqual([0, 0]);
    expect(si.isCopy).toBe(false);

    si.updateMoving(15, 18, false);
    expect(si.moving?.offset).toEqual([5, 8]);
    expect(si.isCopy).toBe(false);

    // Modifier key pressed (Ctrl / Alt)
    si.setCopyMode(true);
    expect(si.isCopy).toBe(true);

    si.cancel();
    expect(si.moving).toBeNull();
    expect(si.isCopy).toBe(false);
  });

  it('checks pointerInSelection properly', () => {
    const si = new SelectionInteraction();
    const selection = { x: 10, y: 10, w: 20, h: 20 };

    expect(si.isPointerInSelection(15, 15, selection)).toBe(true);
    expect(si.isPointerInSelection(10, 10, selection)).toBe(true);
    expect(si.isPointerInSelection(29, 29, selection)).toBe(true);
    expect(si.isPointerInSelection(30, 30, selection)).toBe(false);
    expect(si.isPointerInSelection(5, 5, selection)).toBe(false);
    expect(si.isPointerInSelection(15, 15, null)).toBe(false);
  });

  it('manages marching ants timer and offsets', () => {
    vi.useFakeTimers();
    const si = new SelectionInteraction();
    expect(si.antsOffset).toBe(0);

    let ticks = 0;
    si.manageMarchingAnts(true, () => {
      ticks++;
    });

    vi.advanceTimersByTime(120);
    expect(ticks).toBe(1);
    expect(si.antsOffset).toBe(1);

    vi.advanceTimersByTime(240);
    expect(ticks).toBe(3);
    expect(si.antsOffset).toBe(3);

    si.manageMarchingAnts(false, () => {});
    vi.advanceTimersByTime(240);
    expect(ticks).toBe(3); // Stopped

    si.dispose();
    vi.useRealTimers();
  });
});
