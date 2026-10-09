import type { ViewModel } from '../src/app/viewModel';
import { createTestViewModel } from './helpers/viewModelFixture';
import { describe, it, expect } from 'vitest';
import { SemanticZone } from '../src/core/types';
import { assertDocumentInvariant } from './helpers/documentFixture';

describe('Mode Switching and Mask Visibility', () => {
  it('switches between pixel and mask modes via setMode', () => {
    const vm = createTestViewModel();
    expect(vm.session.activeMode).toBe('pixel');

    vm.setMode('mask');
    expect(vm.session.activeMode).toBe('mask');

    vm.setMode('pixel');
    expect(vm.session.activeMode).toBe('pixel');
  });

  it('automatically switches to pixel mode when all masks are hidden', () => {
    const vm = createTestViewModel();
    // Enter mask mode
    vm.setMode('mask');
    expect(vm.session.activeMode).toBe('mask');
    expect(vm.session.visibleMaskZones.length).toBeGreaterThan(0);

    // Hide all masks via setAllZonesVisibility(false)
    vm.setAllZonesVisibility(false);
    expect(vm.session.visibleMaskZones).toEqual([]);
    expect(vm.session.showMaskOverlay).toBe(false);
    // Should automatically switch back to pixel mode!
    expect(vm.session.activeMode).toBe('pixel');
  });

  it('automatically switches to pixel mode when unchecking the last visible mask zone', () => {
    const vm = createTestViewModel();
    vm.setMode('mask');

    // Only keep Hair visible
    vm.patchSession({ visibleMaskZones: [SemanticZone.Hair], showMaskOverlay: true });
    expect(vm.session.activeMode).toBe('mask');

    // Uncheck Hair
    vm.toggleZoneVisibility(SemanticZone.Hair, false);
    expect(vm.session.visibleMaskZones).toEqual([]);
    expect(vm.session.showMaskOverlay).toBe(false);
    // Should automatically switch back to pixel mode!
    expect(vm.session.activeMode).toBe('pixel');
  });

  it('does not force mask mode when toggling mask visibility from pixel mode', () => {
    const vm = createTestViewModel();
    expect(vm.session.activeMode).toBe('pixel');

    // User is drawing in pixel mode and wants to toggle Hair mask overlay on
    vm.toggleZoneVisibility(SemanticZone.Hair, true);
    // Should remain in pixel mode so left sidebar stays as palette
    expect(vm.session.activeMode).toBe('pixel');
    expect(vm.session.visibleMaskZones).toContain(SemanticZone.Hair);
    expect(vm.session.showMaskOverlay).toBe(true);
  });

  it('enters mask mode when selecting a mask zone brush and selects ONLY that zone', () => {
    const vm = createTestViewModel();
    expect(vm.session.activeMode).toBe('pixel');

    vm.setActiveZone(SemanticZone.Hair);
    expect(vm.session.activeMode).toBe('mask');
    expect(vm.session.activeZone).toBe(SemanticZone.Hair);
    expect(vm.session.visibleMaskZones).toEqual([SemanticZone.Hair]);
  });

  describe('Direct Hair Recolor as Undoable Command', () => {
    function setupHairTestDoc(vm: ViewModel) {
      vm.patchSession({ isLoaded: true, activeMode: 'mask', visibleMaskZones: [SemanticZone.Hair], showMaskOverlay: true });
      // Mark some pixels as non-transparent Hair so document invariant holds
      vm.doc.pixelIndices[0] = 0;
      vm.doc.pixelIndices[1] = 0;
      vm.doc.semanticMask[0] = SemanticZone.Hair;
      vm.doc.semanticMask[1] = SemanticZone.Hair;
      assertDocumentInvariant(vm.doc);
    }

    it('immediately reflects hair preset in displayPixels and commits as undoable command upon confirm', () => {
      const vm = createTestViewModel();
      setupHairTestDoc(vm);
      const originalPreset = vm.doc.currentHairPreset;
      const originalPixel0 = vm.doc.pixelIndices[0];
      let promptOptions: any = null;
      vm.setPrompts({ confirm: (opts) => { promptOptions = opts; } });

      vm.applyHairPreset('06_silver_银白');
      // 试色立即体现在 displayPixels() 渲染中，尚未固化到 doc
      expect(vm.displayPixels()[0]).not.toBe(originalPixel0);
      expect(vm.doc.currentHairPreset).toBe(originalPreset);

      // 切换模式并确认固化
      vm.setMode('pixel');
      expect(promptOptions).not.toBeNull();
      promptOptions.buttons[0].onClick();
      expect(vm.doc.currentHairPreset).toBe('06_silver_银白');

      // 固化后可正常执行撤销与重做
      vm.undo();
      expect(vm.doc.currentHairPreset).toBe(originalPreset);
      expect(vm.doc.pixelIndices[0]).toBe(originalPixel0);

      // Redo restores hair recolor
      vm.redo();
      expect(vm.doc.currentHairPreset).toBe('06_silver_银白');
    });

    it('prompts confirmation modal before switching to pixel mode and commits recolor upon confirm', () => {
      const vm = createTestViewModel();
      setupHairTestDoc(vm);
      let promptOptions: any = null;
      vm.setPrompts({ confirm: (opts) => { promptOptions = opts; } });

      vm.applyHairPreset('06_silver_银白');
      vm.setMode('pixel');

      expect(promptOptions).not.toBeNull();
      expect(promptOptions.title).toBe('切换至画板模式前发色确认');
      expect(promptOptions.buttons).toHaveLength(3);
      expect(promptOptions.buttons[0].label).toBe('✓ 确认替换并切换');
      expect(promptOptions.buttons[1].label).toBe('✕ 放弃替换并切换');
      expect(promptOptions.buttons[2].label).toBe('继续试色');

      // Modal is open, mode has not switched yet
      expect(vm.session.activeMode).toBe('mask');
      expect(vm.hasHairDraft()).toBe(true);

      // Click confirm: commits recolor and enters pixel mode, mask overlay is hidden
      promptOptions.buttons[0].onClick();
      expect(vm.session.activeMode).toBe('pixel');
      expect(vm.session.showMaskOverlay).toBe(false);
      expect(vm.doc.currentHairPreset).toBe('06_silver_银白');
    });

    it('discards hair recolor when user clicks discard and enters pixel mode', () => {
      const vm = createTestViewModel();
      setupHairTestDoc(vm);
      const originalPreset = vm.doc.currentHairPreset;
      let promptOptions: any = null;
      vm.setPrompts({ confirm: (opts) => { promptOptions = opts; } });

      vm.applyHairPreset('06_silver_银白');
      vm.setMode('pixel');
      expect(promptOptions).not.toBeNull();

      // Click discard button
      promptOptions.buttons[1].onClick();
      expect(vm.session.activeMode).toBe('pixel');
      expect(vm.session.showMaskOverlay).toBe(false);
      expect(vm.doc.currentHairPreset).toBe(originalPreset);
    });

    it('stays in mask mode when user clicks continue testing', () => {
      const vm = createTestViewModel();
      setupHairTestDoc(vm);
      let promptOptions: any = null;
      vm.setPrompts({ confirm: (opts) => { promptOptions = opts; } });

      vm.applyHairPreset('06_silver_银白');
      vm.setMode('pixel');
      expect(promptOptions).not.toBeNull();

      // Click cancel/continue testing
      promptOptions.buttons[2].onClick();
      expect(vm.session.activeMode).toBe('mask');
      expect(vm.session.showMaskOverlay).toBe(true);
      expect(vm.hasHairDraft()).toBe(true);
    });

    it('prompts confirmation when clearing all mask visibility with active hair draft', () => {
      const vm = createTestViewModel();
      setupHairTestDoc(vm);
      let promptOptions: any = null;
      vm.setPrompts({ confirm: (opts) => { promptOptions = opts; } });

      vm.applyHairPreset('06_silver_银白');
      vm.setAllZonesVisibility(false);
      expect(promptOptions).not.toBeNull();
      expect(vm.session.activeMode).toBe('mask');

      // Click confirm
      promptOptions.buttons[0].onClick();
      expect(vm.session.activeMode).toBe('pixel');
      expect(vm.session.showMaskOverlay).toBe(false);
    });

    it('prompts confirmation when unchecking last visible mask zone with active hair draft', () => {
      const vm = createTestViewModel();
      setupHairTestDoc(vm);
      let promptOptions: any = null;
      vm.setPrompts({ confirm: (opts) => { promptOptions = opts; } });

      vm.applyHairPreset('06_silver_银白');
      vm.toggleZoneVisibility(SemanticZone.Hair, false);
      expect(promptOptions).not.toBeNull();
      expect(vm.session.activeMode).toBe('mask');

      // Click confirm
      promptOptions.buttons[0].onClick();
      expect(vm.session.activeMode).toBe('pixel');
      expect(vm.session.showMaskOverlay).toBe(false);
    });

    it('prompts confirmation when selecting palette color with active hair draft', () => {
      const vm = createTestViewModel();
      setupHairTestDoc(vm);
      let promptOptions: any = null;
      vm.setPrompts({ confirm: (opts) => { promptOptions = opts; } });

      vm.applyHairPreset('06_silver_银白');
      vm.selectPaletteIndex(5);
      expect(promptOptions).not.toBeNull();
      expect(vm.session.activeMode).toBe('mask');

      // Click confirm
      promptOptions.buttons[0].onClick();
      expect(vm.session.activeMode).toBe('pixel');
      expect(vm.session.showMaskOverlay).toBe(false);
      expect(vm.session.activePaletteIndex).toBe(5);
    });
  });

  describe('Hair Presets Visibility Condition', () => {
    it('defaults to Hair zone, but hair presets requires both activeZone Hair and visibleMaskZones', () => {
      const vm = createTestViewModel();
      expect(vm.session.activeZone).toBe(SemanticZone.Hair);
      expect(vm.session.visibleMaskZones).not.toContain(SemanticZone.Hair);

      // Entering mask mode initializes visible zones and sets Hair active
      vm.setMode('mask');
      expect(vm.session.activeZone).toBe(SemanticZone.Hair);
      expect(vm.session.visibleMaskZones).toContain(SemanticZone.Hair);
    });

    it('selects hair mask only when activeZone is Hair and Hair is in visibleMaskZones', () => {
      const vm = createTestViewModel();
      vm.setMode('mask');

      // Click Hair zone card
      vm.setActiveZone(SemanticZone.Hair);
      expect(vm.session.activeZone).toBe(SemanticZone.Hair);
      expect(vm.session.visibleMaskZones).toContain(SemanticZone.Hair);

      // Switch to Skin zone card -> Hair is no longer active
      vm.setActiveZone(SemanticZone.Skin);
      expect(vm.session.activeZone).toBe(SemanticZone.Skin);

      // Switch back to Hair, then uncheck Hair checkbox
      vm.setActiveZone(SemanticZone.Hair);
      expect(vm.session.activeZone).toBe(SemanticZone.Hair);
      vm.toggleZoneVisibility(SemanticZone.Hair, false);
      expect(vm.session.visibleMaskZones).not.toContain(SemanticZone.Hair);
    });
  });

  describe('Mask Lock Decoupling (Mask locked zones never restrict Pixel mode)', () => {
    it('allows painting, bucket fill, and selection operations in pixel mode even when zones are locked', () => {
      const vm = createTestViewModel();
      const hairIndex = 10 * 64 + 10;
      const doc = (vm as any).doc;
      // Set pixel at (10, 10) to Hair mask zone
      doc.semanticMask[hairIndex] = SemanticZone.Hair;
      doc.pixelIndices[hairIndex] = 1;

      // Lock Hair mask zone and mark session as loaded
      vm.patchSession({ isLoaded: true, lockedMaskZones: [SemanticZone.Hair] });

      // In pixel mode, painting on (10, 10) should succeed!
      expect(vm.session.activeMode).toBe('pixel');
      vm.selectPaletteIndex(5);
      vm.beginStroke(0, false);
      vm.strokeAt(10, 10);
      vm.endStroke();

      expect(doc.pixelIndices[hairIndex]).toBe(5);

      // In mask mode, locked zone should NOT allow painting over Hair with Skin
      vm.setMode('mask');
      vm.setActiveZone(SemanticZone.Skin);
      expect(vm.session.activeMode).toBe('mask');
      vm.beginStroke(0, false);
      vm.strokeAt(10, 10);
      vm.endStroke();

      // Mask should remain Hair because Hair zone is locked in mask mode
      expect(doc.semanticMask[hairIndex]).toBe(SemanticZone.Hair);
    });
  });
});

