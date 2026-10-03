import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewModel } from '../src/app/viewModel';
import { PromptOptions } from '../src/app/ports';
import { createBrowserStorage } from '../src/app/adapters/BrowserStorage';
import { AutosaveService, KeyValueStore, STORAGE_KEY } from '../src/app/services/AutosaveService';
import { createValidDocument } from './helpers/documentFixture';
import { documentToProjectData } from '../src/core/projectData';
import { SemanticZone } from '../src/types';
import { App } from '../src/app/app';
import { CanvasPanel } from '../src/panels/canvas/CanvasPanel';
import { SelectionInteraction } from '../src/panels/canvas/SelectionInteraction';

const exportProjectPng = vi.fn().mockResolvedValue(undefined);
const exportProjectZip = vi.fn().mockResolvedValue(undefined);
const exportMaskPng = vi.fn().mockResolvedValue(undefined);

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: k => { map.delete(k); } };
}

describe('Follow-up review: persistence, gestures and stale requests', () => {
  const instances: ViewModel[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    for (const vm of instances.splice(0)) vm.dispose();
    vi.clearAllTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  function loaded(store: KeyValueStore = memoryStore()): ViewModel {
    const vm = new ViewModel({ autosave: new AutosaveService(store), exports: { exportPng: exportProjectPng, exportZip: exportProjectZip, exportMaskPng } });
    instances.push(vm);
    vm.loadProject(documentToProjectData(createValidDocument({ pixels: set => set(0, 0, 5, SemanticZone.Hair) })));
    return vm;
  }
  function capturePrompts(vm: ViewModel) {
    const prompts: PromptOptions[] = [];
    const dismiss = vi.fn();
    vm.setPrompts({ confirm: p => prompts.push(p), dismiss });
    return { prompts, dismiss };
  }
  function startStroke(vm: ViewModel) {
    vm.selectPaletteIndex(1);
    vm.beginStroke(0, false);
    vm.strokeAt(20, 20);
  }

  it('reports failure from the real default browser adapter when quota is exceeded', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); } });
    expect(new AutosaveService(createBrowserStorage(() => localStorage)).saveImmediate(createValidDocument())).toMatchObject({ success: false, error: '配额超限' });
  });
  it('does not report success when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(new AutosaveService(createBrowserStorage(() => localStorage)).saveImmediate(createValidDocument()).success).toBe(false);
  });
  it('clear returns a failure result and cancels delayed writes when removeItem fails', () => {
    const store = memoryStore();
    store.removeItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
    const service = new AutosaveService(store);
    service.saveDebounced(createValidDocument());
    expect(service.clear()).toMatchObject({ success: false, error: '存储受限' });
    vi.advanceTimersByTime(300);
    expect(store.map.size).toBe(0);
    service.dispose();
  });
  it('reset does not claim the cache was cleared when removal failed', () => {
    const store = memoryStore();
    store.removeItem = () => { throw new Error('cannot remove'); };
    const vm = loaded(store);
    const notices: string[] = [];
    vm.registerListener({ onNotify: msg => notices.push(msg) });
    const { prompts } = capturePrompts(vm);
    vm.requestReset();
    prompts[0].buttons[0].onClick();
    expect(vm.session.isLoaded).toBe(false);
    expect(notices.some(n => n.includes('未能清除'))).toBe(true);
    expect(notices).not.toContain('已重置画布并清除本地暂存');
  });
  it('keeps each instance on its explicitly injected store', () => {
    const a = memoryStore(), b = memoryStore();
    const vmA = loaded(a);
    const vmB = loaded(b);
    vmA.setPaletteColor(0, '#111111');
    vmB.setPaletteColor(0, '#222222');
    vmA.flushAutosave();
    vmB.flushAutosave();
    expect(JSON.parse(a.map.get(STORAGE_KEY)!).palette[0]).toBe('#111111');
    expect(JSON.parse(b.map.get(STORAGE_KEY)!).palette[0]).toBe('#222222');
  });

  for (const format of ['png', 'zip'] as const) {
    for (const action of ['load', 'dispose'] as const) {
      it(`settles a pending ${format} export when the document is ${action === 'load' ? 'replaced' : 'disposed'}`, async () => {
        const vm = loaded();
        const { prompts, dismiss } = capturePrompts(vm);
        vm.applyHairPreset('03_blonde_金');
        let settled = false;
        const pending = format === 'png' ? vm.exportPng() : vm.exportZip();
        void pending.then(() => { settled = true; });
        const oldPrompt = prompts[0];
        if (action === 'load') vm.loadProject(documentToProjectData(createValidDocument()));
        else vm.dispose();
        await Promise.resolve();
        await Promise.resolve();
        expect(settled).toBe(true);
        expect(dismiss).toHaveBeenCalled();
        oldPrompt.buttons[0].onClick();
        oldPrompt.buttons[1].onClick();
        oldPrompt.onDismiss?.();
        expect(exportProjectPng).not.toHaveBeenCalled();
        expect(exportProjectZip).not.toHaveBeenCalled();
      });
    }
  }
  it('does not export any format after ViewModel disposal', async () => {
    const vm = loaded();
    vm.dispose();
    await vm.exportPng();
    await vm.exportZip();
    await vm.exportMaskPng();
    expect(exportProjectPng).not.toHaveBeenCalled();
    expect(exportProjectZip).not.toHaveBeenCalled();
    expect(exportMaskPng).not.toHaveBeenCalled();
  });
  it('changing color ends the current stroke before later dabs arrive', () => {
    const vm = loaded();
    startStroke(vm);
    vm.selectPaletteIndex(2);
    vm.strokeAt(21, 20);
    vm.endStroke();
    expect(vm.doc.pixelIndices[20 * 64 + 21]).toBe(255);
    vm.undo();
    expect(vm.doc.pixelIndices[20 * 64 + 20]).toBe(255);
  });
  it('opening a prompt ends the active stroke', () => {
    const vm = loaded();
    capturePrompts(vm);
    startStroke(vm);
    vm.requestReset();
    vm.strokeAt(21, 20);
    expect(vm.canUndo()).toBe(true);
    expect(vm.doc.pixelIndices[20 * 64 + 21]).toBe(255);
  });
  it('export finishes the active stroke before taking its snapshot', async () => {
    const vm = loaded();
    startStroke(vm);
    await vm.exportPng();
    expect(vm.canUndo()).toBe(true);
    vm.strokeAt(21, 20);
    expect(vm.doc.pixelIndices[20 * 64 + 21]).toBe(255);
    expect(exportProjectPng).toHaveBeenCalledOnce();
  });
  it('does not clear the selection when Escape was consumed by a modal', () => {
    const vm = loaded();
    vm.selectAll();
    const selection = { ...vm.session.selection! };
    const app = {
      vm, isDisposed: false,
      ctx: { isHairHighlightPinned: false, highlightedPaletteIndex: null },
      confirmModal: { getIsOpen: () => false },
      replaceColorModal: { getIsOpen: () => false },
      clearSelectionWithToast: () => vm.clearSelection(),
    };
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { key: 'Escape', code: 'Escape' });
    event.preventDefault();
    (App.prototype as unknown as { handleShortcut(e: Event): void }).handleShortcut.call(app, event);
    expect(vm.session.selection).toEqual(selection);
  });
  it('cancels a Space-drag preview on blur without moving pixels', () => {
    const vm = loaded();
    const before = new Uint8Array(vm.doc.pixelIndices);
    const selection = new SelectionInteraction();
    selection.startMoving(0, 0, { x: 0, y: 0, w: 1, h: 1 }, vm.doc, false);
    selection.updateMoving(5, 5, false);
    const panel = {
      vm, selection, isMouseDown: true, spacePress: true,
      viewport: { style: { cursor: 'move' } },
      setAltHeld: vi.fn(), setShiftHeld: vi.fn(), updateCanvasCursor: vi.fn(), markDirty: vi.fn(),
      onMouseUp: vi.fn(() => vm.moveSelection(
        selection.moving!.floating.patch, { x: 0, y: 0, w: 1, h: 1 }, 5, 5, false
      )),
    };
    (CanvasPanel.prototype as unknown as { cancelPointerInteraction(): void }).cancelPointerInteraction.call(panel);
    expect(panel.onMouseUp).not.toHaveBeenCalled();
    expect(selection.moving).toBeNull();
    expect(panel.isMouseDown).toBe(false);
    expect(panel.spacePress).toBe(false);
    expect(vm.doc.pixelIndices).toEqual(before);
    expect(vm.canUndo()).toBe(false);
  });
  for (const zone of [SemanticZone.Background, SemanticZone.Clothes]) {
    it(`initializes the all-colors match group for zone ${zone}`, () => {
      const vm = loaded();
      vm.setActiveZone(zone);
      expect(vm.session.maskMatchPresetKey).toBe('all_colors');
      expect(vm.session.maskMatchColors).toEqual(Array.from({ length: 36 }, (_, i) => i));
      vm.setActiveZone(SemanticZone.Skin);
      vm.setActiveZone(zone);
      expect(vm.session.maskMatchColors).toHaveLength(36);
    });
  }
});
