import { describe, it, expect, vi, afterEach } from 'vitest';
import { ViewModel } from '../src/app/viewModel';
import { App } from '../src/app/app';
import { SemanticZone } from '../src/types';
import { createEmptyDocument } from '../src/model/document';
import { documentToProjectData, base64ToUint8Array } from '../src/core/projectData';
import { AutosaveService, KeyValueStore } from '../src/app/services/AutosaveService';
import { createMemoryStore } from './helpers/viewModelFixture';
import { createBrowserStorage } from '../src/app/adapters/BrowserStorage';
import { floodFillMask, FULL_CANVAS } from '../src/core/editOps';
import { ConfirmModal } from '../src/panels/modals/ConfirmModal';

describe('Review Findings (R1–R7) Regression Suite', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createLoadedVm(pixel0 = 5, mask0 = SemanticZone.Hair, store: KeyValueStore = createMemoryStore()): ViewModel {
    const doc = createEmptyDocument();
    doc.pixelIndices[0] = pixel0;
    doc.semanticMask[0] = mask0;
    const vm = new ViewModel({ autosave: new AutosaveService(store) });
    vm.loadProject(documentToProjectData(doc));
    return vm;
  }

  describe('R1: Stroke Transaction & History Invariants', () => {
    it('R1.1: undo during active stroke commits/aborts stroke so history is not corrupted', () => {
      const vm = createLoadedVm(255, SemanticZone.Background);

      // Stroke 1: color 1 at (0, 0)
      vm.selectPaletteIndex(1);
      vm.beginStroke(0, false);
      vm.strokeAt(0, 0);
      vm.endStroke();
      expect(vm.doc.pixelIndices[0]).toBe(1);

      // Stroke 2: color 2 at (1, 0)
      vm.selectPaletteIndex(2);
      vm.beginStroke(0, false);
      vm.strokeAt(1, 0);
      expect(vm.doc.pixelIndices[1]).toBe(2);

      // User hits undo while Stroke 2 was in progress
      vm.undo();

      // At this point, the in-progress stroke should be undone or aborted:
      // pixel 1 must NOT stay 2, and pixel 0 must NOT be corrupted
      const afterUndo = [...vm.doc.pixelIndices.slice(0, 3)];
      expect(afterUndo[1]).toBe(255); // stroke 2 reverted
      expect(afterUndo[0]).toBe(1); // stroke 1 remains intact!

      // Continuing to dab without beginStroke must be a no-op
      vm.strokeAt(2, 0);
      vm.endStroke();

      // Second undo must undo Stroke 1 cleanly
      vm.undo();
      const afterSecondUndo = [...vm.doc.pixelIndices.slice(0, 3)];
      expect(afterSecondUndo[0]).toBe(255); // stroke 1 undone cleanly
      expect(afterSecondUndo[1]).toBe(255);
      expect(afterSecondUndo[2]).toBe(255);

      vm.dispose();
    });

    it('R1.2: loading project while stroke in progress invalidates stroke so old data cannot be restored', () => {
      const vm = createLoadedVm(5, SemanticZone.Hair);

      // Start stroke on Doc A
      vm.selectPaletteIndex(2);
      vm.beginStroke(0, false);
      vm.strokeAt(1, 0);

      // In the middle of stroke, Doc B is loaded
      const nextDoc = createEmptyDocument();
      nextDoc.pixelIndices[0] = 8;
      vm.loadProject(documentToProjectData(nextDoc));

      // Old stroke finishes or is ended
      vm.endStroke();

      // Doc B must NOT have any undo history from Doc A
      expect(vm.canUndo()).toBe(false);
      expect(vm.doc.pixelIndices[0]).toBe(8);

      vm.dispose();
    });
  });

  describe('R2: Stale Confirmation Isolation & Document Generation', () => {
    it('R2.1: stale reset confirmation callback does not clear newly loaded project', () => {
      const vm = createLoadedVm(5);
      let capturedPrompt: any = null;
      vm.setPrompts({
        confirm: (p: any) => {
          capturedPrompt = p;
        },
      } as any);

      // Open reset confirmation on Doc A
      vm.requestReset();
      expect(capturedPrompt).not.toBeNull();

      // Before user clicks, Doc B is loaded
      const nextDoc = createEmptyDocument();
      nextDoc.pixelIndices[0] = 8;
      vm.loadProject(documentToProjectData(nextDoc));

      // User now clicks the OLD "清空画布" confirmation button
      capturedPrompt.buttons[0].onClick();

      // The old callback must be rejected because documentGeneration changed
      expect(vm.doc.pixelIndices[0]).toBe(8);
      expect(vm.session.isLoaded).toBe(true);

      vm.dispose();
    });
  });

  describe('R3: App Storage Startup SecurityError Protection', () => {
    it('R3.1: setupSplitterDragging does not throw when localStorage throws SecurityError', () => {
      const origLocalStorage = globalThis.localStorage;
      const origDoc = globalThis.document;
      const node = () => ({
        remove: () => {},
        style: {},
        classList: { add: () => {}, remove: () => {} },
        addEventListener: () => {},
        appendChild: () => {},
        querySelector: () => node(),
        offsetWidth: 280,
      });
      globalThis.document = {
        createElement: () => node(),
        getElementById: () => node(),
        body: node(),
      } as any;

      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('Access denied', 'SecurityError');
        },
      });

      try {
        let threw = false;
        try {
          const mockAppCtx = {
            abortController: new AbortController(),
            browserStorage: createBrowserStorage(() => localStorage),
          };
          (App.prototype as any).setupSplitterDragging.call(mockAppCtx);
        } catch {
          threw = true;
        }
        expect(threw).toBe(false);
      } finally {
        globalThis.document = origDoc;
        if (origLocalStorage !== undefined) {
          Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: origLocalStorage,
            writable: true,
          });
        } else {
          delete (globalThis as any).localStorage;
        }
      }
    });
  });

  describe('R4: Mask FloodFill with Start Point Already in Target Zone', () => {
    it('R4.1: traverses through start point if start already belongs to target zone', () => {
      const doc = createEmptyDocument();
      doc.pixelIndices[0] = 5;
      doc.pixelIndices[1] = 5;
      doc.semanticMask[0] = SemanticZone.Hair; // start is Hair
      doc.semanticMask[1] = SemanticZone.Skin; // neighbor is Skin

      // Flood fill targeting Hair starting at pixel (0, 0)
      const changed = floodFillMask(
        { pixels: doc.pixelIndices, mask: doc.semanticMask, lockedZones: new Set() },
        0,
        0,
        SemanticZone.Hair,
        false,
        FULL_CANVAS
      );

      expect(changed).toBe(true);
      expect(doc.semanticMask[1]).toBe(SemanticZone.Hair);
    });

    it('R4.2: respects locked zones even when start is in target zone', () => {
      const doc = createEmptyDocument();
      doc.pixelIndices[0] = 5;
      doc.pixelIndices[1] = 5;
      doc.semanticMask[0] = SemanticZone.Hair;
      doc.semanticMask[1] = SemanticZone.Skin;

      // Skin is locked!
      const changed = floodFillMask(
        { pixels: doc.pixelIndices, mask: doc.semanticMask, lockedZones: new Set([SemanticZone.Skin]) },
        0,
        0,
        SemanticZone.Hair,
        false,
        FULL_CANVAS
      );

      expect(changed).toBe(false);
      expect(doc.semanticMask[1]).toBe(SemanticZone.Skin);
    });
  });

  describe('R5: Autosave Instance Isolation', () => {
    it('R5.1: multiple ViewModel instances maintain isolated autosave timers and data', () => {
      const savedDocs: number[] = [];
      const store: KeyValueStore = {
        getItem: () => null,
        setItem: (_k: string, v: string) => {
          const parsed = JSON.parse(v);
          const px = base64ToUint8Array(parsed.pixels)[0];
          savedDocs.push(px);
        },
        removeItem: () => {},
      };

      const vmA = createLoadedVm(5, SemanticZone.Hair, store);
      const vmB = createLoadedVm(8, SemanticZone.Hair, store);

      const statusA: string[] = [];
      const statusB: string[] = [];
      vmA.registerListener({ onSaveStatus: (s) => statusA.push(s) });
      vmB.registerListener({ onSaveStatus: (s) => statusB.push(s) });

      vmA.setPaletteColor(0, '#111111');
      vmB.setPaletteColor(0, '#222222');

      // Dispose vmA should flush vmA (pixel 5), NOT vmB (pixel 8)
      vmA.dispose();

      expect(savedDocs).toContain(5);
      expect(statusA).toContain('saved');

      // Disposing vmB afterwards should flush vmB (pixel 8)
      vmB.dispose();
      expect(savedDocs).toContain(8);
      expect(statusB).toContain('saved');
    });
  });

  describe('R6: Complete Mutation Guard on Disposed ViewModel', () => {
    it('R6.1: setPaletteColor and commands cannot modify document after dispose', () => {
      const vm = createLoadedVm(5);
      const initialPaletteColor = vm.doc.palette[0];

      vm.dispose();

      // Mutation after dispose must be rejected
      vm.setPaletteColor(0, '#123456');
      expect(vm.doc.palette[0]).toBe(initialPaletteColor);

      // Begin stroke after dispose must do nothing
      vm.beginStroke(0, false);
      vm.strokeAt(0, 0);
      vm.endStroke();
      expect(vm.doc.pixelIndices[0]).toBe(5);
    });
  });

  describe('R7: ConfirmModal Replacement Calls onDismiss of Previous Modal', () => {
    function createMockNode() {
      const node: any = {
        remove: vi.fn(),
        style: {},
        classList: { add: vi.fn(), remove: vi.fn() },
        addEventListener: vi.fn(),
        appendChild: vi.fn((child: any) => child),
        querySelector: vi.fn(() => createMockNode()),
        innerHTML: '',
        textContent: '',
      };
      return node;
    }

    it('R7.1: calling show while a modal is already open triggers onDismiss of previous modal', () => {
      const container = createMockNode();
      const origDoc = globalThis.document;
      globalThis.document = {
        createElement: vi.fn(() => createMockNode()),
        getElementById: vi.fn(() => createMockNode()),
        body: createMockNode(),
      } as any;

      try {
        const modal = new ConfirmModal(container);
        let dismissedCount = 0;

        modal.show({
          title: 'Modal 1',
          message: 'Message 1',
          buttons: [],
          onDismiss: () => {
            dismissedCount++;
          },
        });

        // Show Modal 2 while Modal 1 is open
        modal.show({
          title: 'Modal 2',
          message: 'Message 2',
          buttons: [],
        });

        expect(dismissedCount).toBe(1);
        modal.dispose();
      } finally {
        globalThis.document = origDoc;
      }
    });
  });
});
