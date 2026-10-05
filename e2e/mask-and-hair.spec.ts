import { test, expect } from '@playwright/test';

test.describe('E2E: 语义遮罩与经典发色置换全流程', () => {
  test('绘制头发区域、涂抹遮罩、预览 9 大二次元发色卡并固化', async ({ page }) => {
    await page.goto('./?debug');

    // 1. 创建空白画布
    await page.click('#btn-empty-blank');
    const canvas = page.locator('#main-display-canvas');
    await expect(canvas).toBeVisible();

    const box = (await canvas.boundingBox())!;
    const stepX = box.width / 64;
    const stepY = box.height / 64;

    // 2. 在画布 (30, 20) 到 (35, 20) 绘制黑色头发线稿 (色板索引 0)
    await page.click('.palette-chip[data-index="0"]');
    await page.mouse.move(box.x + 30.5 * stepX, box.y + 20.5 * stepY);
    await page.mouse.down();
    await page.mouse.move(box.x + 35.5 * stepX, box.y + 20.5 * stepY, { steps: 5 });
    await page.mouse.up();

    // 3. 切换到语义遮罩模式 (点击 #btn-mode-mask)
    await page.click('#btn-mode-mask');
    await expect(page.locator('#mask-tools-panel-wrapper')).toBeVisible();

    // 选中头发分区 (SemanticZone.Hair = 1)
    await page.click('.zone-card[data-zone="1"]');

    // 在刚才画线的区域涂抹头发遮罩
    await page.mouse.move(box.x + 30.5 * stepX, box.y + 20.5 * stepY);
    await page.mouse.down();
    await page.mouse.move(box.x + 35.5 * stepX, box.y + 20.5 * stepY, { steps: 5 });
    await page.mouse.up();

    // 断言：右侧遮罩面板中的“头发 9 大预设发色置换”区域自动显现！
    const hairRecolorSection = page.locator('#hair-recolor-section');
    await expect(hairRecolorSection).toBeVisible();

    // 4. 点击选择“03 金发”卡片进行即时发色置换 (可撤销)
    const goldCard = page.locator('.hair-preset-card[data-preset="03_blonde_金"]');
    await expect(goldCard).toBeVisible();
    await goldCard.click();

    // 验证发色成功应用并固化到文档 (currentHairPreset === "03_blonde_金")
    await expect(goldCard).toHaveClass(/active/);
    const committedPreset = await page.evaluate(() => window.__studio?.vm.doc.currentHairPreset);
    expect(committedPreset).toBe('03_blonde_金');
  });
});
