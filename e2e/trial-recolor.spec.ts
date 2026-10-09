import { test, expect } from '@playwright/test';
import { createEmptyDocument } from '../src/core/document';
import { documentToProjectData } from '../src/core/projectData';
import { SemanticZone } from '../src/core/types';

for (const matchGroup of ['all_colors', 'custom'] as const) {
  test(`trial undo/redo buttons update with ${matchGroup} matching`, async ({ page }) => {
    const doc = createEmptyDocument();
    doc.pixelIndices[0] = 3;
    doc.semanticMask[0] = SemanticZone.Hair;
    doc.currentHairPreset = '01_black_黑';
    const project = documentToProjectData(doc);

    await page.goto('./?debug');
    await page.evaluate(({ project, matchGroup }) => {
      const vm = window.__studio!.vm;
      vm.loadProject(project);
      vm.setMode('mask');
      if (matchGroup === 'custom') vm.setCustomMaskMatchColors([3, 7]);
      else vm.setMaskMatchPreset(matchGroup);
    }, { project, matchGroup });

    const undo = page.locator('#btn-mask-undo');
    const redo = page.locator('#btn-mask-redo');
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    await page.locator('.hair-preset-card[data-preset="06_silver_银白"]').click();
    await expect(undo).toBeEnabled();
    await expect(redo).toBeDisabled();
    await undo.click();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();

    await redo.click();
    await expect(undo).toBeEnabled();
    await expect(redo).toBeDisabled();
    await undo.click();
    await expect(redo).toBeEnabled();
    await page.locator('.hair-preset-card[data-preset="02_brown_棕"]').click();
    await expect(undo).toBeEnabled();
    await expect(redo).toBeDisabled();

    // Discard through the export decision while staying in mask mode.
    await page.locator('#btn-quick-save').click();
    const prompt = page.locator('#confirm-modal-overlay');
    await expect(prompt).toBeVisible();
    await prompt.locator('.btn-danger').click();
    await expect(prompt).toBeHidden();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
    expect(await page.evaluate(() => window.__studio!.vm.doc.currentHairPreset)).toBe('01_black_黑');
  });
}
