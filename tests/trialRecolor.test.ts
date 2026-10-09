import { describe, it, expect, vi } from 'vitest';
import { createTestViewModel } from './helpers/viewModelFixture';
import { SemanticZone } from '../src/core/types';
import { createValidDocument } from './helpers/documentFixture';
import { documentToProjectData } from '../src/core/projectData';
import { MATCH_COLOR_PRESETS } from '../src/core/constants';

describe('Trial Recolor Data Isolation and Transformation Invariants (F1 & F2)', () => {
  it('[F1] document replacement discards trial baseline and prevents cross-document pollution', () => {
    const vm = createTestViewModel();
    // 1. Setup Document A: has Hair at [0], pixel 5, trial silver hair
    vm.loadProject(
      documentToProjectData(
        createValidDocument({
          currentHairPreset: '01_black_黑',
          pixels: (set) => set(0, 0, 5, SemanticZone.Hair),
        })
      )
    );
    vm.setMode('mask');
    vm.applyHairPreset('06_silver_银白');
    expect(vm.hasHairDraft()).toBe(true);

    // 2. Load Document B: non-hair pixel at index 1 = 12
    const docB = createValidDocument({
      currentHairPreset: '02_brown_棕',
      pixels: (set) => {
        set(0, 0, 5, SemanticZone.Hair);
        set(1, 0, 12, SemanticZone.Skin);
      },
    });
    vm.loadProject(documentToProjectData(docB));
    expect(vm.doc.pixelIndices[1]).toBe(12);
    expect(vm.hasHairDraft()).toBe(false);

    // 3. Enter mask mode on B, trial silver, then discard
    vm.setMode('mask');
    vm.applyHairPreset('06_silver_银白');
    expect(vm.hasHairDraft()).toBe(true);
    vm.discardHairRecolor();

    // 4. Verify Document B has zero data from Document A
    expect(vm.doc.pixelIndices[1]).toBe(12);
    expect(vm.doc.currentHairPreset).toBe('02_brown_棕');
    expect(vm.hasHairDraft()).toBe(false);
  });

  it('[F2] canceling hair trial does not roll back geometric transforms (horizontal flip)', () => {
    const vm = createTestViewModel();
    // 1. Setup document: Skin pixel at (1, 0) with index 5, Hair pixel at (0, 0) with index 2
    const doc = createValidDocument({
      currentHairPreset: '01_black_黑',
      pixels: (set) => {
        set(0, 0, 2, SemanticZone.Hair);
        set(1, 0, 5, SemanticZone.Skin);
      },
    });
    vm.loadProject(documentToProjectData(doc));
    expect(vm.doc.pixelIndices[1]).toBe(5);
    expect(vm.doc.semanticMask[1]).toBe(SemanticZone.Skin);

    // 2. Enter mask mode and trial silver hair
    vm.setMode('mask');
    vm.applyHairPreset('06_silver_银白');
    expect(vm.hasHairDraft()).toBe(true);

    // 3. Flip canvas horizontally (Skin pixel moves from x=1 to x=62)
    vm.flipContent('horizontal');
    expect(vm.doc.pixelIndices[1]).toBe(255);
    expect(vm.doc.pixelIndices[62]).toBe(5);
    expect(vm.doc.semanticMask[62]).toBe(SemanticZone.Skin);

    // 4. Cancel / discard hair trial
    vm.discardHairRecolor();
    expect(vm.hasHairDraft()).toBe(false);

    // 5. Verify the flip is NOT destroyed: Skin pixel remains at x=62, x=1 is NOT reverted to 5!
    expect(vm.doc.pixelIndices[62]).toBe(5);
    expect(vm.doc.pixelIndices[1]).toBe(255);
    expect(vm.doc.semanticMask[62]).toBe(SemanticZone.Skin);
  });

  it('separates displayPixels from doc.pixelIndices during trial and commits cleanly', () => {
    const vm = createTestViewModel();
    const doc = createValidDocument({
      currentHairPreset: '01_black_黑',
      pixels: (set) => {
        set(0, 0, 5, SemanticZone.Hair);
      },
    });
    vm.loadProject(documentToProjectData(doc));
    const originalPixel = vm.doc.pixelIndices[0];

    vm.setMode('mask');
    vm.applyHairPreset('06_silver_银白');

    // displayPixels reflects trial, doc is unchanged
    expect(vm.displayPixels()[0]).not.toBe(originalPixel);
    expect(vm.doc.pixelIndices[0]).toBe(originalPixel);
    expect(vm.doc.currentHairPreset).toBe('01_black_黑');
    // 在蒙版模式下有试色历史，可通过 undo 撤销试色回到原样
    expect(vm.canUndo()).toBe(true);

    // Discarding trial restores displayPixels without executing any undoable command
    vm.discardHairRecolor();
    expect(vm.displayPixels()[0]).toBe(originalPixel);
    expect(vm.doc.pixelIndices[0]).toBe(originalPixel);
    expect(vm.canUndo()).toBe(false);
  });
});

describe('Export & Autosave Pending Decoupling (F3)', () => {
  it('[F3] export prompts user for decision when hair trial is pending, direct export when clean', async () => {
    let promptCaptured: any = null;
    const exportPng = vi.fn(async () => {});
    const vm = createTestViewModel({ exports: { exportPng, exportZip: vi.fn(async () => {}) } });
    vm.setPrompts({ confirm: (p) => { promptCaptured = p; } });
    const doc = createValidDocument({
      currentHairPreset: '01_black_黑',
      pixels: (set) => set(0, 0, 5, SemanticZone.Hair),
    });
    vm.loadProject(documentToProjectData(doc));

    // 1. Without trial: direct export, 0 prompts
    await vm.exportPng();
    expect(promptCaptured).toBeNull();
    expect(exportPng).toHaveBeenCalledOnce();
    expect(exportPng).toHaveBeenCalledWith(expect.objectContaining({ currentHairPreset: '01_black_黑' }));
    exportPng.mockClear();

    // 2. With trial: prompt triggered
    vm.setMode('mask');
    vm.applyHairPreset('06_silver_银白');
    expect(vm.hasHairDraft()).toBe(true);

    const exportPromise = vm.exportPng();
    expect(promptCaptured).not.toBeNull();
    expect(promptCaptured.title).toBe('导出前换色确认');
    expect(promptCaptured.buttons).toHaveLength(3);

    // Cancel export: keeps trial intact, does not export
    promptCaptured.buttons[2].onClick();
    await exportPromise;
    expect(vm.hasHairDraft()).toBe(true);
    expect(vm.doc.currentHairPreset).toBe('01_black_黑');
    expect(exportPng).not.toHaveBeenCalled();

    // Prompt again and choose confirm & export
    promptCaptured = null;
    const exportPromise2 = vm.exportPng();
    expect(promptCaptured).not.toBeNull();
    promptCaptured.buttons[0].onClick();
    await exportPromise2;
    expect(vm.hasHairDraft()).toBe(false);
    expect(vm.doc.currentHairPreset).toBe('06_silver_银白');
    expect(exportPng).toHaveBeenCalledOnce();
    expect(exportPng).toHaveBeenCalledWith(expect.objectContaining({ currentHairPreset: '06_silver_银白' }));
    vm.dispose();
  });

  it('[F3] autosave cache contains only committed doc and never stores pending trial pixels', () => {
    const vm = createTestViewModel();
    const doc = createValidDocument({
      currentHairPreset: '01_black_黑',
      pixels: (set) => set(0, 0, 5, SemanticZone.Hair),
    });
    vm.loadProject(documentToProjectData(doc));
    vm.setMode('mask');
    vm.applyHairPreset('06_silver_银白');

    // Flush autosave and check saved data
    const res = vm.flushAutosave();
    expect(res).not.toBeNull();
    // Restore and check that saved state is the clean committed state
    const saved = (vm as any).autosave.load();
    expect(saved).not.toBeNull();
    expect(saved.hairPreset).toBe('01_black_黑');
  });
});

describe('Pending Detection and Trial History Boundary (F4)', () => {
  it('[F4] same hair preset with out-of-ramp pixels correctly marks pending and prompts on exit', () => {
    const vm = createTestViewModel();
    // Document preset is 01_black_黑, but has pixel 0 (which is outside black ramp)
    const doc = createValidDocument({
      currentHairPreset: '01_black_黑',
      pixels: (set) => set(0, 0, 0, SemanticZone.Hair),
    });
    vm.loadProject(documentToProjectData(doc));
    let promptCaptured: any = null;
    vm.setPrompts({ confirm: (p) => { promptCaptured = p; } });

    vm.setMode('mask');
    // Selecting black again: pixel 0 will be re-mapped to ramp color (e.g. 2)
    vm.applyHairPreset('01_black_黑');

    // Even though preset key didn't change, actual pixels change, so pending must be TRUE!
    expect(vm.hasHairDraft()).toBe(true);

    // Exiting mask mode prompts user
    vm.setMode('pixel');
    expect(promptCaptured).not.toBeNull();
    expect(promptCaptured.title).toBe('切换至画板模式前发色确认');

    // Confirm commits the pixel cleanup
    promptCaptured.buttons[0].onClick();
    expect(vm.doc.pixelIndices[0]).not.toBe(0);
    expect(vm.hasHairDraft()).toBe(false);
  });

  it('[F4] undo and redo inside mask mode track trial history in sequence (A -> B -> undo -> redo)', () => {
    const vm = createTestViewModel();
    const doc = createValidDocument({
      currentHairPreset: '01_black_黑',
      pixels: (set) => set(0, 0, 5, SemanticZone.Hair),
    });
    vm.loadProject(documentToProjectData(doc));
    const basePixel = vm.doc.pixelIndices[0];

    vm.setMode('mask');
    // 1. Trial A: silver
    vm.applyHairPreset('06_silver_银白');
    expect(vm.hairDraftName()).toBe('银白');
    expect(vm.hasHairDraft()).toBe(true);
    const silverPixel = vm.displayPixels()[0];
    expect(silverPixel).not.toBe(basePixel);

    // 2. Trial B: brown
    vm.applyHairPreset('02_brown_棕');
    expect(vm.hairDraftName()).toBe('棕色');
    expect(vm.hasHairDraft()).toBe(true);
    const brownPixel = vm.displayPixels()[0];
    expect(brownPixel).not.toBe(silverPixel);

    // 3. Undo: returns to silver!
    expect(vm.canUndo()).toBe(true);
    vm.undo();
    expect(vm.hairDraftName()).toBe('银白');
    expect(vm.displayPixels()[0]).toBe(silverPixel);
    expect(vm.hasHairDraft()).toBe(true);

    // 4. Undo again: returns to base (no trial)!
    expect(vm.canUndo()).toBe(true);
    vm.undo();
    expect(vm.hairDraftName()).toBe('');
    expect(vm.displayPixels()[0]).toBe(basePixel);
    expect(vm.hasHairDraft()).toBe(false);

    // 5. Redo: restores silver!
    expect(vm.canRedo()).toBe(true);
    vm.redo();
    expect(vm.hairDraftName()).toBe('银白');
    expect(vm.displayPixels()[0]).toBe(silverPixel);
    expect(vm.hasHairDraft()).toBe(true);

    // 6. Redo again: restores brown!
    expect(vm.canRedo()).toBe(true);
    vm.redo();
    expect(vm.hairDraftName()).toBe('棕色');
    expect(vm.displayPixels()[0]).toBe(brownPixel);
    expect(vm.hasHairDraft()).toBe(true);
  });
});

describe('Mode Lifecycle & Visibility Boundaries (F5 & F6)', () => {
  it('[F5] entering mask mode via setActiveZone triggers full lifecycle (pixel.cleanup & mask.enter)', () => {
    const vm = createTestViewModel();
    expect(vm.session.activeMode).toBe('pixel');

    let pixelCleanupCount = 0;
    let maskEnterCount = 0;
    const origPixelCleanup = (vm as any).pixel.cleanup.bind((vm as any).pixel);
    const origMaskEnter = (vm as any).mask.enter.bind((vm as any).mask);
    (vm as any).pixel.cleanup = () => {
      pixelCleanupCount++;
      origPixelCleanup();
    };
    (vm as any).mask.enter = () => {
      maskEnterCount++;
      origMaskEnter();
    };

    // Selecting a zone from pixel mode must route through setMode('mask')
    vm.setActiveZone(SemanticZone.Skin);
    expect(pixelCleanupCount).toBe(1);
    expect(maskEnterCount).toBe(1);
    expect(vm.session.activeMode).toBe('mask');
    expect(vm.session.activeZone).toBe(SemanticZone.Skin);
    expect(vm.session.visibleMaskZones).toEqual([SemanticZone.Skin]);

    // Selecting another zone while already in mask mode should NOT re-trigger lifecycle
    vm.setActiveZone(SemanticZone.Hair);
    expect(pixelCleanupCount).toBe(1);
    expect(maskEnterCount).toBe(1);
    expect(vm.session.activeZone).toBe(SemanticZone.Hair);
  });

  it('[F5] entering mask mode via setActiveMaskTool triggers full lifecycle (pixel.cleanup & mask.enter)', () => {
    const vm = createTestViewModel();
    expect(vm.session.activeMode).toBe('pixel');

    let pixelCleanupCount = 0;
    let maskEnterCount = 0;
    const origPixelCleanup = (vm as any).pixel.cleanup.bind((vm as any).pixel);
    const origMaskEnter = (vm as any).mask.enter.bind((vm as any).mask);
    (vm as any).pixel.cleanup = () => {
      pixelCleanupCount++;
      origPixelCleanup();
    };
    (vm as any).mask.enter = () => {
      maskEnterCount++;
      origMaskEnter();
    };

    vm.setActiveMaskTool('eraser');
    expect(pixelCleanupCount).toBe(1);
    expect(maskEnterCount).toBe(1);
    expect(vm.session.activeMode).toBe('mask');
    expect(vm.session.activeMaskTool).toBe('eraser');
  });

  it('[F6] unchecking last zone when trial is pending keeps visibleMaskZones intact if user cancels exit', () => {
    const vm = createTestViewModel();
    const doc = createValidDocument({
      currentHairPreset: '01_black_黑',
      pixels: (set) => set(0, 0, 5, SemanticZone.Hair),
    });
    vm.loadProject(documentToProjectData(doc));
    let promptCaptured: any = null;
    vm.setPrompts({ confirm: (p) => { promptCaptured = p; } });

    vm.setMode('mask');
    vm.setActiveZone(SemanticZone.Hair, true);
    expect(vm.session.visibleMaskZones).toEqual([SemanticZone.Hair]);
    expect(vm.session.showMaskOverlay).toBe(true);

    vm.applyHairPreset('06_silver_银白');
    expect(vm.hasHairDraft()).toBe(true);

    // Uncheck Hair (the only visible zone)
    vm.toggleZoneVisibility(SemanticZone.Hair, false);

    // Prompt is shown because hiding last zone triggers exiting mask mode
    expect(promptCaptured).not.toBeNull();
    // BUT visibleMaskZones is NOT yet cleared before user decision!
    expect(vm.session.visibleMaskZones).toEqual([SemanticZone.Hair]);
    expect(vm.session.showMaskOverlay).toBe(true);
    expect(vm.session.activeMode).toBe('mask');

    // Click "继续试色" (button index 2)
    promptCaptured.buttons[2].onClick();
    // State remains in mask mode and visibleMaskZones is STILL intact!
    expect(vm.session.activeMode).toBe('mask');
    expect(vm.session.visibleMaskZones).toEqual([SemanticZone.Hair]);
    expect(vm.session.showMaskOverlay).toBe(true);
    expect(vm.hasHairDraft()).toBe(true);

    // Now try again and choose confirm (button 0)
    promptCaptured = null;
    vm.toggleZoneVisibility(SemanticZone.Hair, false);
    expect(promptCaptured).not.toBeNull();
    promptCaptured.buttons[0].onClick();
    // Confirmed exit: now visibleMaskZones is cleared and mode is pixel
    expect(vm.session.activeMode).toBe('pixel');
    expect(vm.session.visibleMaskZones).toEqual([]);
    expect(vm.session.showMaskOverlay).toBe(false);
    expect(vm.hasHairDraft()).toBe(false);
    expect(vm.doc.currentHairPreset).toBe('06_silver_银白');
  });

  it('[F6] hiding all zones when trial is pending keeps visibleMaskZones intact if user dismisses prompt', () => {
    const vm = createTestViewModel();
    const doc = createValidDocument({
      currentHairPreset: '01_black_黑',
      pixels: (set) => set(0, 0, 5, SemanticZone.Hair),
    });
    vm.loadProject(documentToProjectData(doc));
    let promptCaptured: any = null;
    vm.setPrompts({ confirm: (p) => { promptCaptured = p; } });

    vm.setMode('mask');
    vm.applyHairPreset('06_silver_银白');
    expect(vm.hasHairDraft()).toBe(true);
    const initialZones = [...vm.session.visibleMaskZones];

    // Click "隐藏全部遮罩"
    vm.setAllZonesVisibility(false);
    expect(promptCaptured).not.toBeNull();

    // Verify state was not prematurely wiped
    expect(vm.session.visibleMaskZones).toEqual(initialZones);
    expect(vm.session.showMaskOverlay).toBe(true);
    expect(vm.session.activeMode).toBe('mask');

    // Dismiss dialog (e.g. click close / outside)
    promptCaptured.onDismiss();
    expect(vm.session.activeMode).toBe('mask');
    expect(vm.session.visibleMaskZones).toEqual(initialZones);
    expect(vm.session.showMaskOverlay).toBe(true);
    expect(vm.hasHairDraft()).toBe(true);

    // Try again and click "✕ 放弃替换并切换" (button 1)
    promptCaptured = null;
    vm.setAllZonesVisibility(false);
    expect(promptCaptured).not.toBeNull();
    promptCaptured.buttons[1].onClick();
    expect(vm.session.activeMode).toBe('pixel');
    expect(vm.session.visibleMaskZones).toEqual([]);
    expect(vm.session.showMaskOverlay).toBe(false);
    expect(vm.hasHairDraft()).toBe(false);
    expect(vm.doc.currentHairPreset).toBe('01_black_黑');
  });
});

describe('Multi-Zone Recolor Abstraction and Interface Cleanliness (C1 & C2)', () => {
  it('provides unified getPendingRecolorDescriptions and commitAllRecolors / discardAllRecolors', () => {
    const vm = createTestViewModel();
    const doc = createValidDocument({
      currentHairPreset: '01_black_黑',
      pixels: (set) => set(0, 0, 5, SemanticZone.Hair),
    });
    vm.loadProject(documentToProjectData(doc));

    // Initially no pending recolor
    expect(vm.mask.hasPendingTrial).toBe(false);
    expect(vm.mask.getPendingRecolorDescriptions()).toEqual([]);

    vm.setMode('mask');
    vm.applyHairPreset('06_silver_银白');

    expect(vm.mask.hasPendingTrial).toBe(true);
    const descriptions = vm.mask.getPendingRecolorDescriptions();
    expect(descriptions).toHaveLength(1);
    expect(descriptions[0]).toEqual({
      zone: SemanticZone.Hair,
      name: '发色',
      icon: '💇',
      previewName: '银白',
    });

    // discardAllRecolors clears the pending trial cleanly
    vm.discardAllRecolors();
    expect(vm.mask.hasPendingTrial).toBe(false);
    expect(vm.mask.getPendingRecolorDescriptions()).toEqual([]);
    expect(vm.doc.currentHairPreset).toBe('01_black_黑');

    // Trial again and commitAllRecolors
    vm.applyHairPreset('06_silver_银白');
    expect(vm.mask.hasPendingTrial).toBe(true);
    vm.commitAllRecolors();
    expect(vm.mask.hasPendingTrial).toBe(false);
    expect(vm.doc.currentHairPreset).toBe('06_silver_银白');
  });

  it('unifies exit prompt format with multi-zone description support', () => {
    const vm = createTestViewModel();
    const doc = createValidDocument({
      currentHairPreset: '01_black_黑',
      pixels: (set) => set(0, 0, 5, SemanticZone.Hair),
    });
    vm.loadProject(documentToProjectData(doc));
    let promptCaptured: any = null;
    vm.setPrompts({ confirm: (p) => { promptCaptured = p; } });

    vm.setMode('mask');
    vm.applyHairPreset('06_silver_银白');

    vm.setMode('pixel');
    expect(promptCaptured).not.toBeNull();
    expect(promptCaptured.title).toBe('切换至画板模式前发色确认');
    expect(promptCaptured.message).toContain('【银白】');
    expect(promptCaptured.buttons[0].label).toBe('✓ 确认替换并切换');
    expect(promptCaptured.buttons[1].label).toBe('✕ 放弃替换并切换');

    // Confirm commits and switches mode
    promptCaptured.buttons[0].onClick();
    expect(vm.session.activeMode).toBe('pixel');
    expect(vm.doc.currentHairPreset).toBe('06_silver_银白');
  });
});

describe('Trial recolor and committed mask matching', () => {
  function setup() {
    const vm = createTestViewModel();
    vm.loadProject(documentToProjectData(createValidDocument({
      currentHairPreset: '01_black_黑',
      pixels: (set) => set(0, 0, 3, SemanticZone.Hair),
    })));
    vm.setMode('mask');
    return vm;
  }

  it('keeps matching the source pixels through trial undo, redo and cancellation', () => {
    const vm = setup();
    try {
      const sourceColors = [...vm.session.maskMatchColors];
      expect(sourceColors).toContain(3);
      vm.applyHairPreset('06_silver_银白');
      expect(vm.displayPixels()[0]).not.toBe(3);
      expect(vm.doc.pixelIndices[0]).toBe(3);
      expect(vm.session.maskMatchColors).toEqual(sourceColors);

      vm.applyHairPreset('02_brown_棕');
      vm.undo();
      expect(vm.hairDraftName()).toBe('银白');
      expect(vm.session.maskMatchColors).toEqual(sourceColors);
      vm.redo();
      expect(vm.hairDraftName()).toBe('棕色');
      expect(vm.session.maskMatchColors).toEqual(sourceColors);
      vm.discardAllRecolors();
      expect(vm.session.maskMatchColors).toEqual(sourceColors);
    } finally {
      vm.dispose();
    }
  });

  it('does not subtract valid source hair while displaying a different trial color', () => {
    const vm = setup();
    try {
      vm.applyHairPreset('06_silver_银白');
      vm.maskBoxSelect({ x: 0, y: 0, w: 1, h: 1 }, 'subtract');
      expect(vm.doc.semanticMask[0]).toBe(SemanticZone.Hair);

      // Explicit removal still matches the same source pixel during trial.
      vm.maskBoxSelect({ x: 0, y: 0, w: 1, h: 1 }, 'remove');
      expect(vm.doc.semanticMask[0]).toBe(SemanticZone.None);
      vm.discardAllRecolors();
      expect(vm.doc.semanticMask[0]).toBe(SemanticZone.None);
    } finally {
      vm.dispose();
    }
  });

  it('refreshes source colors after confirmation, document undo/redo and palette edits', () => {
    const vm = setup();
    try {
      const sourceColors = [...vm.session.maskMatchColors];
      const preset = MATCH_COLOR_PRESETS.find((p) => p.id === 'current_hair')!;
      const silverColors = preset.getIndices(vm.doc.palette, '06_silver_银白');
      vm.applyHairPreset('06_silver_银白');
      vm.commitAllRecolors();
      expect(vm.session.maskMatchColors).toEqual(silverColors);
      expect(vm.session.maskMatchColors).toContain(vm.doc.pixelIndices[0]);

      vm.undo();
      expect(vm.doc.currentHairPreset).toBe('01_black_黑');
      expect(vm.session.maskMatchColors).toEqual(sourceColors);
      vm.redo();
      expect(vm.session.maskMatchColors).toEqual(silverColors);

      const changedIndex = silverColors[1];
      vm.setPaletteColor(changedIndex, '#123456');
      expect(vm.session.maskMatchColors).not.toContain(changedIndex);
      vm.undo();
      expect(vm.session.maskMatchColors).toEqual(silverColors);
    } finally {
      vm.dispose();
    }
  });

  it('preserves custom matching colors across trial, confirmation and document history', () => {
    const vm = setup();
    try {
      vm.setCustomMaskMatchColors([3, 7]);
      vm.applyHairPreset('06_silver_银白');
      vm.commitAllRecolors();
      vm.undo();
      vm.redo();
      expect(vm.session.maskMatchPresetKey).toBe('custom');
      expect(vm.session.maskMatchColors).toEqual([3, 7]);
    } finally {
      vm.dispose();
    }
  });
});
