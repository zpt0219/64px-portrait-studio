import { test, expect } from '@playwright/test';

test.describe('E2E: 选区框选与几何变换全流程', () => {
  test('矩形选区框选、浮动工具栏显示、水平镜像翻转与取消选区', async ({ page }) => {
    await page.goto('./?debug');

    // 1. 创建空白画布
    await page.click('#btn-empty-blank');
    const canvas = page.locator('#main-display-canvas');
    await expect(canvas).toBeVisible();

    const box = (await canvas.boundingBox())!;
    const stepX = box.width / 64;
    const stepY = box.height / 64;

    // 2. 在 (10, 10) 绘制一个色块 (索引 7)
    await page.click('.palette-chip[data-index="7"]');
    await page.mouse.move(box.x + 10.5 * stepX, box.y + 10.5 * stepY);
    await page.mouse.down();
    await page.mouse.up();

    // 确认 (10, 10) 为 7，而 (14, 10) 为 255 (透明)
    const beforeState = await page.evaluate(() => {
      const idx = window.__studio?.vm.doc.pixelIndices;
      return [idx?.[10 * 64 + 10], idx?.[10 * 64 + 14]];
    });
    expect(beforeState).toEqual([7, 255]);

    // 3. 切换选区工具 (点击 #btn-tool-select)
    await page.click('#btn-tool-select');
    await expect(page.locator('#btn-tool-select')).toHaveClass(/active/);

    // 框选 (10, 10) 到 (14, 10)
    await page.mouse.move(box.x + 10.5 * stepX, box.y + 10.5 * stepY);
    await page.mouse.down();
    await page.mouse.move(box.x + 14.5 * stepX, box.y + 10.5 * stepY, { steps: 5 });
    await page.mouse.up();

    // 断言：浮动工具栏出现，显示选区尺寸 5×1
    const contextBar = page.locator('#floating-context-bar');
    await expect(contextBar).toBeVisible();
    await expect(contextBar.locator('#btn-flip-h')).toBeVisible();

    // 4. 点击水平翻转按钮 #btn-flip-h
    await contextBar.locator('#btn-flip-h').click();

    // 断言：(10, 10) 与 (14, 10) 的像素发生了水平镜像对调！
    // 此时 (10, 10) 变为 255，而 (14, 10) 变为 7
    const afterFlipState = await page.evaluate(() => {
      const idx = window.__studio?.vm.doc.pixelIndices;
      return [idx?.[10 * 64 + 10], idx?.[10 * 64 + 14]];
    });
    expect(afterFlipState).toEqual([255, 7]);

    // 5. 点击取消选区按钮 #btn-cancel-selection
    await contextBar.locator('#btn-cancel-selection').click();

    // 断言：选区清空，操作按钮组隐藏，转为选区工具提示
    const currentSelection = await page.evaluate(() => window.__studio?.vm.session.selection);
    expect(currentSelection).toBeNull();
    await expect(contextBar.locator('#btn-cancel-selection')).toBeHidden();

    // 切回画笔工具，浮动上下文工具栏完全隐藏
    await page.click('#btn-tool-pen');
    await expect(contextBar).toBeHidden();
  });
});
