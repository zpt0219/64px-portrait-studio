import { describe, it, expect } from 'vitest';
import { createTestViewModel } from './helpers/viewModelFixture';
import { PRESET_PORTRAIT_PROJECT, PRESET_AVATAR_NAME } from '../src/core/presetAvatar';
import { validateProjectData } from '../src/core/projectData';
import { SemanticZone } from '../src/core/types';
import { PIXEL_COUNT } from '../src/core/pixelGrid';

describe('Preset Avatar (Blonde Knight)', () => {
  it('passes validateProjectData schema validation without errors', () => {
    const result = validateProjectData(PRESET_PORTRAIT_PROJECT);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.data.palette).toHaveLength(36);
    expect(result.data.hairPreset).toBe('03_blonde_金');
  });

  it('loads preset avatar into ViewModel directly when not loaded', () => {
    const vm = createTestViewModel();
    expect(vm.session.isLoaded).toBe(false);

    vm.loadPresetAvatar();

    expect(vm.session.isLoaded).toBe(true);
    expect(vm.session.activeMode).toBe('pixel');
    expect(vm.doc.currentHairPreset).toBe('03_blonde_金');
    expect(vm.doc.palette).toHaveLength(36);

    // Verify non-empty pixels & semantic masks
    let nonTransparent = 0;
    let hairPixels = 0;
    let skinPixels = 0;
    let eyePixels = 0;
    let clothesPixels = 0;

    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (vm.doc.pixelIndices[i] !== 255) nonTransparent++;
      if (vm.doc.semanticMask[i] === SemanticZone.Hair) hairPixels++;
      if (vm.doc.semanticMask[i] === SemanticZone.Skin) skinPixels++;
      if (vm.doc.semanticMask[i] === SemanticZone.Eyes) eyePixels++;
      if (vm.doc.semanticMask[i] === SemanticZone.Clothes) clothesPixels++;
    }

    expect(nonTransparent).toBeGreaterThan(1500);
    expect(hairPixels).toBe(1494);
    expect(skinPixels).toBe(258);
    expect(eyePixels).toBe(18);
    expect(clothesPixels).toBe(63);
  });

  it('opens in a new tab without overwrite prompt when another project is already loaded', () => {
    const vm = createTestViewModel();
    vm.newBlankProject();
    expect(vm.session.isLoaded).toBe(true);
    vm.doc.pixelIndices[0] = 5;

    let promptCalled = false;
    vm.setPrompts({
      confirm: () => {
        promptCalled = true;
      },
    });

    vm.loadPresetAvatar();
    expect(promptCalled).toBe(false);
    expect(vm.getTabs()).toHaveLength(2);
    expect(vm.getActiveTabName()).toBe(PRESET_AVATAR_NAME);
    expect(vm.doc.currentHairPreset).toBe('03_blonde_金');
  });
});
