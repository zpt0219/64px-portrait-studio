import { test, expect } from '@playwright/test';

test.describe('E2E: 基础绘画与工具箱全流程', () => {
  test('画笔绘制、橡皮擦除、油漆桶单点填充与吸管快速取色', async ({ page }) => {
    await page.goto('./?debug');

    // 1. 创建空白画布 (64×64)
    await page.click('#btn-empty-blank');
    const canvas = page.locator('#main-display-canvas');
    await expect(canvas).toBeVisible();

    const box = (await canvas.boundingBox())!;
    const stepX = box.width / 64;
    const stepY = box.height / 64;

    // 2. 选择色板索引 5 颜色并绘制水平线 (10, 10) -> (15, 10)
    await page.click('.palette-chip[data-index="5"]');
    await page.mouse.move(box.x + 10.5 * stepX, box.y + 10.5 * stepY);
    await page.mouse.down();
    await page.mouse.move(box.x + 15.5 * stepX, box.y + 10.5 * stepY, { steps: 5 });
    await page.mouse.up();

    // 验证像素 10~15 均为 5
    const linePixels = await page.evaluate(() => {
      const idx = window.__studio?.vm.doc.pixelIndices;
      return [idx?.[10 * 64 + 10], idx?.[10 * 64 + 12], idx?.[10 * 64 + 15]];
    });
    expect(linePixels).toEqual([5, 5, 5]);

    // 3. 切换橡皮擦工具 (快捷键 E 或点击 #btn-tool-eraser)
    await page.click('#btn-tool-eraser');
    await expect(page.locator('#btn-tool-eraser')).toHaveClass(/active/);

    // 擦除中间的像素 (12, 10)
    await page.mouse.move(box.x + 12.5 * stepX, box.y + 10.5 * stepY);
    await page.mouse.down();
    await page.mouse.up();

    // 验证 (12, 10) 变为透明索引 255
    const erasedPixel = await page.evaluate(() => window.__studio?.vm.doc.pixelIndices[10 * 64 + 12]);
    expect(erasedPixel).toBe(255);

    // 4. 选用油漆桶工具 (点击 #btn-tool-bucket)
    await page.click('#btn-tool-bucket');
    await expect(page.locator('#btn-tool-bucket')).toHaveClass(/active/);

    // 选择新的颜色索引 9
    await page.click('.palette-chip[data-index="9"]');

    // 点击之前未擦除的像素 (10, 10)，油漆桶应当泛洪填充相连的像素 (10, 10) 和 (11, 10)
    await page.mouse.move(box.x + 10.5 * stepX, box.y + 10.5 * stepY);
    await page.mouse.down();
    await page.mouse.up();

    const filledPixels = await page.evaluate(() => {
      const idx = window.__studio?.vm.doc.pixelIndices;
      return [idx?.[10 * 64 + 10], idx?.[10 * 64 + 11], idx?.[10 * 64 + 12]];
    });
    // (10, 10) 和 (11, 10) 被填充为 9，而断开的 (12, 10) 仍保持 255
    expect(filledPixels).toEqual([9, 9, 255]);

    // 5. 吸管工具取色验证 (点击 #btn-tool-eyedropper)
    await page.click('#btn-tool-eyedropper');
    // 在 (15, 10) 处取色（那里的颜色仍是 5）
    await page.mouse.move(box.x + 15.5 * stepX, box.y + 10.5 * stepY);
    await page.mouse.down();
    await page.mouse.up();

    // 断言：前景色被吸管吸取并自动更新回索引 5
    const activeIndexAfterPick = await page.evaluate(() => window.__studio?.vm.session.activePaletteIndex);
    expect(activeIndexAfterPick).toBe(5);
  });
});
