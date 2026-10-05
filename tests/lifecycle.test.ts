import { createTestViewModel } from './helpers/viewModelFixture';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Panel, flushDirtyPanelsForTest, getDirtyPanelsCountForTest, clearDirtyPanelsForTest } from '../src/panels/Panel';
import { ViewModel } from '../src/app/viewModel';
import { SelectionInteraction } from '../src/panels/canvas/SelectionInteraction';
import { ConfirmModal } from '../src/panels/modals/ConfirmModal';
import { ReplaceColorModal } from '../src/panels/modals/ReplaceColorModal';
import { createValidDocument } from './helpers/documentFixture';
import { documentToProjectData } from '../src/core/projectData';

class TestPanel extends Panel {
  renderCount = 0;
  onDisposeCount = 0;

  render(): void {
    this.renderCount++;
  }

  triggerDirty(): void {
    this.markDirty();
  }

  protected onDispose(): void {
    this.onDisposeCount++;
  }
}

describe('Lifecycle & Dispose Management (T09)', () => {
  let vm: ViewModel;

  beforeEach(() => {
    clearDirtyPanelsForTest();
    vm = createTestViewModel();
  });

  afterEach(() => {
    clearDirtyPanelsForTest();
    vi.restoreAllMocks();
  });

  describe('Panel Base Lifecycle', () => {
    it('Panel dispose is idempotent and cleans up listeners and dirty mark', () => {
      const panel = new TestPanel(vm);
      expect(panel.isDisposed).toBe(false);

      panel.triggerDirty();
      expect(getDirtyPanelsCountForTest()).toBe(1);

      // Dispose panel
      panel.dispose();
      expect(panel.isDisposed).toBe(true);
      expect(panel.onDisposeCount).toBe(1);
      // Disposing panel removes it from dirtyPanels
      expect(getDirtyPanelsCountForTest()).toBe(0);

      // Calling dispose again is a no-op
      panel.dispose();
      expect(panel.onDisposeCount).toBe(1);

      // markDirty on a disposed panel does not add to dirtyPanels
      panel.triggerDirty();
      expect(getDirtyPanelsCountForTest()).toBe(0);
      expect(panel.renderCount).toBe(0);
    });

    it('flush does not render panels that were disposed before flush', () => {
      const panel1 = new TestPanel(vm);
      const panel2 = new TestPanel(vm);

      panel1.triggerDirty();
      panel2.triggerDirty();
      expect(getDirtyPanelsCountForTest()).toBe(2);

      // Dispose panel1 before flush
      panel1.dispose();
      expect(getDirtyPanelsCountForTest()).toBe(1);

      flushDirtyPanelsForTest();
      expect(panel1.renderCount).toBe(0);
      expect(panel2.renderCount).toBe(1);
    });
  });

  describe('SelectionInteraction Lifecycle', () => {
    it('dispose cancels marching ants interval timer', () => {
      vi.useFakeTimers();
      const selection = new SelectionInteraction();
      const tickFn = vi.fn();

      selection.manageMarchingAnts(true, tickFn);
      vi.advanceTimersByTime(240);
      expect(tickFn).toHaveBeenCalledTimes(2);

      selection.dispose();
      vi.advanceTimersByTime(500);
      // No more ticks after dispose
      expect(tickFn).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

function createMockElement(tag = 'div') {
  const el: any = {
    tagName: tag.toUpperCase(),
    className: '',
    id: '',
    style: {},
    innerHTML: '',
    textContent: '',
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
      contains: vi.fn().mockReturnValue(false),
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    appendChild: vi.fn((child: any) => child),
    remove: vi.fn(),
    setAttribute: vi.fn(),
    getAttribute: vi.fn().mockReturnValue(''),
    querySelector: vi.fn(),
    querySelectorAll: vi.fn().mockReturnValue([]),
  };
  el.querySelector.mockImplementation((_sel: string) => createMockElement('div'));
  return el;
}

  describe('ConfirmModal Lifecycle', () => {
    it('dispose resolves pending onDismiss and cleans up overlay and listeners', () => {
      const container = createMockElement('div');
      const mockOverlay = createMockElement('div');

      const origCreate = globalThis.document?.createElement;
      globalThis.document = {
        ...globalThis.document,
        createElement: vi.fn().mockReturnValue(mockOverlay),
      } as unknown as Document;

      const modal = new ConfirmModal(container);

      let dismissed = false;
      modal.show({
        title: 'Confirm Delete',
        message: 'Are you sure?',
        buttons: [{ label: 'OK', onClick: () => {} }],
        onDismiss: () => {
          dismissed = true;
        },
      });
      expect(modal.getIsOpen()).toBe(true);

      modal.dispose();
      expect(modal.isDisposed).toBe(true);
      expect(modal.getIsOpen()).toBe(false);
      expect(dismissed).toBe(true);
      expect(mockOverlay.remove).toHaveBeenCalled();

      // Dispose again is idempotent
      modal.dispose();

      if (origCreate) {
        globalThis.document.createElement = origCreate;
      }
    });
  });

  describe('ReplaceColorModal Lifecycle', () => {
    it('dispose closes modal, aborts listeners, and removes overlay', () => {
      const container = createMockElement('div');
      const mockOverlay = createMockElement('div');

      const origCreate = globalThis.document?.createElement;
      globalThis.document = {
        ...globalThis.document,
        createElement: vi.fn().mockReturnValue(mockOverlay),
      } as unknown as Document;

      const modal = new ReplaceColorModal(container, { onConfirm: vi.fn() });
      modal.open(
        { palette: createValidDocument().palette, activePaletteIndex: 1, bgPaletteIndex: 0 },
        null
      );
      expect(modal.getIsOpen()).toBe(true);

      modal.dispose();
      expect(modal.isDisposed).toBe(true);
      expect(modal.getIsOpen()).toBe(false);
      expect(mockOverlay.remove).toHaveBeenCalled();

      // Dispose again is idempotent
      modal.dispose();

      if (origCreate) {
        globalThis.document.createElement = origCreate;
      }
    });
  });

  describe('ViewModel Lifecycle', () => {
    it('dispose flushes pending debounced save, clears listeners, and blocks new commands', () => {
      vi.useFakeTimers();
      const doc = createValidDocument({
        pixels: (setPixel) => {
          setPixel(0, 0, 1);
        },
      });
      vm.loadProject(documentToProjectData(doc));

      const listener = {
        onPixelsChanged: vi.fn(),
        onSaveStatus: vi.fn(),
      };
      vm.registerListener(listener);

      // Trigger a change to queue debounced autosave
      vm.flipContent('horizontal');
      expect(listener.onSaveStatus).toHaveBeenCalledWith('saving');

      // Dispose ViewModel before the 300ms debounce fires
      vm.dispose();
      expect(vm.isDisposed).toBe(true);

      // Subsequent changes and commands are no-ops
      listener.onPixelsChanged.mockClear();
      vm.flipContent('horizontal');
      expect(listener.onPixelsChanged).not.toHaveBeenCalled();

      // Calling dispose again is a no-op
      vm.dispose();

      vi.useRealTimers();
    });
  });
});
