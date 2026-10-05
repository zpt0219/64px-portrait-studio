/**
 * 画布矩形选区与选区平移/复制状态机
 */

import { RectSelection } from '../../core/types';
import { Patch, extractPatch } from '../../core/editOps';
import { layersOf, PortraitDocument } from '../../core/document';
import { isInRect } from '../../core/session';

interface BoxSelectState {
  start: [number, number];
  rect: RectSelection;
  maskAction: 'add' | 'remove' | 'subtract' | 'clear' | null;
}

interface MovingSelectionState {
  start: [number, number];
  offset: [number, number];
  floating: {
    origX: number;
    origY: number;
    patch: Patch;
  };
}

export class SelectionInteraction {
  private _boxSelect: BoxSelectState | null = null;
  private _moving: MovingSelectionState | null = null;
  private _isCopyMode = false;
  private _wasCopyTriggered = false;

  private antsTimer: ReturnType<typeof setInterval> | null = null;
  public antsOffset = 0;

  get boxSelect(): BoxSelectState | null {
    return this._boxSelect;
  }

  get moving(): MovingSelectionState | null {
    return this._moving;
  }

  get isCopy(): boolean {
    return this._isCopyMode || this._wasCopyTriggered;
  }

  setCopyMode(active: boolean): void {
    this._isCopyMode = active;
    if (active) this._wasCopyTriggered = true;
  }

  resetCopyLatch(): void {
    this._isCopyMode = false;
    this._wasCopyTriggered = false;
  }

  startBoxSelect(x: number, y: number, maskAction: 'add' | 'remove' | 'subtract' | 'clear' | null): void {
    this._moving = null;
    this._boxSelect = { start: [x, y], rect: { x, y, w: 1, h: 1 }, maskAction };
  }

  updateBoxSelect(rawX: number, rawY: number, maskAction?: 'add' | 'remove' | 'subtract' | 'clear' | null): void {
    if (!this._boxSelect) return;
    if (maskAction !== undefined) {
      this._boxSelect.maskAction = maskAction;
    }
    const [sx, sy] = this._boxSelect.start;
    const x0 = Math.min(sx, rawX);
    const y0 = Math.min(sy, rawY);
    this._boxSelect.rect = {
      x: x0,
      y: y0,
      w: Math.max(sx, rawX) - x0 + 1,
      h: Math.max(sy, rawY) - y0 + 1,
    };
  }

  startMoving(x: number, y: number, selection: RectSelection, doc: PortraitDocument, isModifier: boolean): void {
    this._isCopyMode = isModifier;
    this._wasCopyTriggered = isModifier;
    this._moving = {
      start: [x, y],
      offset: [0, 0],
      floating: {
        origX: selection.x,
        origY: selection.y,
        patch: extractPatch(layersOf(doc, []), selection),
      },
    };
  }

  updateMoving(rawX: number, rawY: number, isModifier: boolean): void {
    if (!this._moving) return;
    this._moving.offset = [rawX - this._moving.start[0], rawY - this._moving.start[1]];
    if (isModifier) {
      this._isCopyMode = true;
      this._wasCopyTriggered = true;
    }
  }

  cancel(): void {
    if (this._boxSelect?.maskAction === null) {
      this._boxSelect = null;
    }
    this._moving = null;
    this.resetCopyLatch();
  }

  cancelAll(): void {
    this._boxSelect = null;
    this._moving = null;
    this.resetCopyLatch();
  }

  isPointerInSelection(px: number, py: number, selection: RectSelection | null): boolean {
    return selection !== null && px !== -1 && py !== -1 && isInRect(px, py, selection);
  }

  manageMarchingAnts(active: boolean, onTick: () => void): void {
    if (active && this.antsTimer === null) {
      this.antsTimer = setInterval(() => {
        this.antsOffset = (this.antsOffset + 1) % 8;
        onTick();
      }, 120);
    } else if (!active && this.antsTimer !== null) {
      clearInterval(this.antsTimer);
      this.antsTimer = null;
    }
  }

  dispose(): void {
    if (this.antsTimer !== null) {
      clearInterval(this.antsTimer);
      this.antsTimer = null;
    }
  }
}
