import type { ViewModel } from '../src/app/viewModel';
import { createTestViewModel } from './helpers/viewModelFixture';
import { describe, it, expect } from 'vitest';
import { PromptOptions } from '../src/app/ports';
import { SemanticZone, HairPresetKey } from '../src/core/types';
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
      vm.patchSession({ isLoaded: true, activeMode: 'mask', visibleMaskZones: [SemanticZone.Hair] });
      // Mark some pixels as non-transparent Hair so document invariant holds
      vm.doc.pixelIndices[0] = 0;
      vm.doc.pixelIndices[1] = 0;
      vm.doc.semanticMask[0] = SemanticZone.Hair;
      vm.doc.semanticMask[1] = SemanticZone.Hair;
      assertDocumentInvariant(vm.doc);
    }

    it('immediately recolors hair pixels and can be undone cleanly with undo()', () => {
      const vm = createTestViewModel();
      setupHairTestDoc(vm);
      const originalPreset = vm.doc.currentHairPreset;
      const originalPixel0 = vm.doc.pixelIndices[0];

      vm.applyHairPreset('06_silver_银白');
      expect(vm.doc.currentHairPreset).toBe('06_silver_银白');

      // Undo reverts hair recolor and preset
      vm.undo();
      expect(vm.doc.currentHairPreset).toBe(originalPreset);
      expect(vm.doc.pixelIndices[0]).toBe(originalPixel0);

      // Redo restores hair recolor
      vm.redo();
      expect(vm.doc.currentHairPreset).toBe('06_silver_银白');
    });

    it('switches between mask and pixel mode without prompting any modal', () => {
      const vm = createTestViewModel();
      setupHairTestDoc(vm);
      let promptCalled = false;
      vm.setPrompts({ confirm: () => { promptCalled = true; } });

      vm.applyHairPreset('06_silver_银白');
      vm.setMode('pixel');

      expect(promptCalled).toBe(false);
      expect(vm.session.activeMode).toBe('pixel');
      expect(vm.doc.currentHairPreset).toBe('06_silver_银白');
    });

    it('switches mode to pixel without prompts when clearing all mask visibility', () => {
      const vm = createTestViewModel();
      setupHairTestDoc(vm);
      let promptCalled = false;
      vm.setPrompts({ confirm: () => { promptCalled = true; } });

      vm.applyHairPreset('06_silver_银白');
      vm.setAllZonesVisibility(false);

      expect(promptCalled).toBe(false);
      expect(vm.session.activeMode).toBe('pixel');
    });

    it('switches mode to pixel without prompts when unchecking last visible mask zone', () => {
      const vm = createTestViewModel();
      setupHairTestDoc(vm);
      let promptCalled = false;
      vm.setPrompts({ confirm: () => { promptCalled = true; } });

      vm.applyHairPreset('06_silver_银白');
      vm.toggleZoneVisibility(SemanticZone.Hair, false);

      expect(promptCalled).toBe(false);
      expect(vm.session.activeMode).toBe('pixel');
    });

    it('switches mode to pixel without prompts when selecting palette color', () => {
      const vm = createTestViewModel();
      setupHairTestDoc(vm);
      let promptCalled = false;
      vm.setPrompts({ confirm: () => { promptCalled = true; } });

      vm.applyHairPreset('06_silver_银白');
      vm.selectPaletteIndex(5);

      expect(promptCalled).toBe(false);
      expect(vm.session.activeMode).toBe('pixel');
      expect(vm.session.activePaletteIndex).toBe(5);
    });
  });

  describe('Hair Presets Visibility Condition', () => {
    it('defaults to not selecting hair mask by default (Background zone)', () => {
      const vm = createTestViewModel();
      expect(vm.session.activeZone).toBe(SemanticZone.Background);
      expect(vm.session.visibleMaskZones).not.toContain(SemanticZone.Hair);

      // Even entering mask mode keeps Background zone by default
      vm.setMode('mask');
      expect(vm.session.activeZone).toBe(SemanticZone.Background);
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

