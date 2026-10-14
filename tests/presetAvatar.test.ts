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

  it('prompts confirmation modal before replacing an already loaded project', () => {
    const vm = createTestViewModel();
    vm.newBlankProject();
    expect(vm.session.isLoaded).toBe(true);
    vm.doc.pixelIndices[0] = 5;

    let promptCalled = false;
    let promptOptions: any = null;
    vm.setPrompts({
      confirm: (opts) => {
        promptCalled = true;
        promptOptions = opts;
      },
    });

    vm.loadPresetAvatar();
    expect(promptCalled).toBe(true);
    expect(promptOptions.title).toBe('载入预设头像');
    expect(promptOptions.message).toContain(PRESET_AVATAR_NAME);

    // Click cancel button
    promptOptions.buttons[1].onClick();
    expect(vm.doc.pixelIndices[0]).toBe(5);
    expect(vm.doc.currentHairPreset).toBeNull();

    // Click confirm button
    vm.loadPresetAvatar();
    promptOptions.buttons[0].onClick();
    expect(vm.doc.currentHairPreset).toBe('03_blonde_金');
  });
});
