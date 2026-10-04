import { test, expect } from '@playwright/test';

test.describe('64px Portrait Studio - 端到端工作流自动化测试', () => {
  test('从空白画布出发：选色、画画、标注蒙版、预置色板调色并验证每一步符合预期', async ({ page }) => {
    // -------------------------------------------------------------------------
    // 步骤 1：打开应用，进入空白画布（一张真正的白纸）
    // -------------------------------------------------------------------------
    await page.goto('./?debug');

    // 验证初始状态：空状态卡片可见
    const emptyDropzone = page.locator('#empty-dropzone');
    await expect(emptyDropzone).toBeVisible();

    // 点击“📄 新建空白画布”
    const btnBlank = page.locator('#btn-empty-blank');
    await expect(btnBlank).toBeVisible();
    await btnBlank.click();

    // 验证：空状态隐藏，主画布可见，ViewModel 处于已载入状态
    const canvas = page.locator('#main-display-canvas');
    await expect(canvas).toBeVisible();
    await expect(emptyDropzone).toBeHidden();

    const isLoaded = await page.evaluate(() => window.__studio?.vm.session.isLoaded);
    expect(isLoaded).toBe(true);

    // -------------------------------------------------------------------------
    // 步骤 2：从 36 色预置色板中选色，并用画笔在画布上画画
    // -------------------------------------------------------------------------
    // 选择预置色板中的颜色：比如索引 8（高亮亮色）
    const targetColorIndex = 8;
    const colorChip = page.locator(`.palette-chip[data-index="${targetColorIndex}"]`);
    await expect(colorChip).toBeVisible();
    await colorChip.click();

    // 断言：前景色已被更新为索引 8
    const activePaletteIndex = await page.evaluate(() => window.__studio?.vm.session.activePaletteIndex);
    expect(activePaletteIndex).toBe(targetColorIndex);

    // 获取画布屏幕坐标范围并计算像素网格 (64×64)
    const box = (await canvas.boundingBox())!;
    const stepX = box.width / 64;
    const stepY = box.height / 64;

    // 模拟画师鼠标操作：在像素坐标 (20, 20) 到 (25, 20) 拖拽绘制一条水平线段
    const startX = box.x + 20.5 * stepX;
    const startY = box.y + 20.5 * stepY;
    const endX = box.x + 25.5 * stepX;
    const endY = box.y + 20.5 * stepY;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up();

    // 断言底层像素数据：坐标 (20, 20) 到 (25, 20) 的像素颜色索引严格为 8
    const drawnPixels = await page.evaluate(() => {
      const indices = window.__studio?.vm.doc.pixelIndices;
      if (!indices) return [];
      return [
        indices[20 * 64 + 20],
        indices[20 * 64 + 21],
        indices[20 * 64 + 22],
        indices[20 * 64 + 23],
        indices[20 * 64 + 24],
        indices[20 * 64 + 25],
      ];
    });
    expect(drawnPixels).toEqual([targetColorIndex, targetColorIndex, targetColorIndex, targetColorIndex, targetColorIndex, targetColorIndex]);

    // -------------------------------------------------------------------------
    // 步骤 3：切换到语义遮罩模式，调用蒙版工具对该区域进行标注
    // -------------------------------------------------------------------------
    const btnModeMask = page.locator('#btn-mode-mask');
    await btnModeMask.click();

    // 断言：当前工作模式已切换为 'mask'，蒙版侧边栏可见
    const currentMode = await page.evaluate(() => window.__studio?.vm.session.activeMode);
    expect(currentMode).toBe('mask');
    await expect(page.locator('#mask-tools-panel-wrapper')).toBeVisible();

    // 选中头发（Hair）分区 (SemanticZone.Hair = 1)
    const hairZoneCard = page.locator('.zone-card[data-zone="1"]');
    await hairZoneCard.click();

    const activeZone = await page.evaluate(() => window.__studio?.vm.session.activeZone);
    expect(activeZone).toBe(1);

    // 模拟画师在刚才画线的区域 (20, 20) 到 (25, 20) 涂抹蒙版
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up();

    // 断言蒙版数据：这几个像素的语义分区严格变为 1 (Hair)
    const maskValues = await page.evaluate(() => {
      const mask = window.__studio?.vm.doc.semanticMask;
      if (!mask) return [];
      return [
        mask[20 * 64 + 20],
        mask[20 * 64 + 21],
        mask[20 * 64 + 22],
        mask[20 * 64 + 23],
        mask[20 * 64 + 24],
        mask[20 * 64 + 25],
      ];
    });
    expect(maskValues).toEqual([1, 1, 1, 1, 1, 1]);

    // -------------------------------------------------------------------------
    // 步骤 4：切回像素修图模式，选用另一个预置色板颜色进行重着色/覆盖
    // -------------------------------------------------------------------------
    const btnModePixel = page.locator('#btn-mode-pixel');
    await btnModePixel.click();

    const backMode = await page.evaluate(() => window.__studio?.vm.session.activeMode);
    expect(backMode).toBe('pixel');

    // 选用另一个预置颜色（例如索引 12 的发色/辅色）
    const recolorIndex = 12;
    const chip12 = page.locator(`.palette-chip[data-index="${recolorIndex}"]`);
    await chip12.click();

    const newActiveColor = await page.evaluate(() => window.__studio?.vm.session.activePaletteIndex);
    expect(newActiveColor).toBe(recolorIndex);

    // 在 (20, 20) 点画一笔新颜色
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.up();

    // 断言：像素 (20, 20) 颜色已成功变为 12
    const pixelAfterRecolor = await page.evaluate(() => window.__studio?.vm.doc.pixelIndices[20 * 64 + 20]);
    expect(pixelAfterRecolor).toBe(recolorIndex);

    // -------------------------------------------------------------------------
    // 步骤 5：验证撤销（Undo）与重做（Redo）
    // -------------------------------------------------------------------------
    const btnUndo = page.locator('#btn-undo');
    await btnUndo.click();

    // 撤销后，像素 (20, 20) 应该回退到之前的索引 8
    const pixelAfterUndo = await page.evaluate(() => window.__studio?.vm.doc.pixelIndices[20 * 64 + 20]);
    expect(pixelAfterUndo).toBe(targetColorIndex);

    const btnRedo = page.locator('#btn-redo');
    await btnRedo.click();

    // 重做后，像素 (20, 20) 再次恢复为新颜色 12
    const pixelAfterRedo = await page.evaluate(() => window.__studio?.vm.doc.pixelIndices[20 * 64 + 20]);
    expect(pixelAfterRedo).toBe(recolorIndex);
  });
});
