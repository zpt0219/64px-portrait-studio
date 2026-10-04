import { test, expect } from '@playwright/test';

test.describe('E2E: 本地缓存自动暂存与工程恢复全流程', () => {
  test('编辑过程自动暂存、刷新网页后检测恢复横幅并成功一键还原', async ({ page }) => {
    await page.goto('./?debug');

    // 1. 创建空白画布
    await page.click('#btn-empty-blank');
    const canvas = page.locator('#main-display-canvas');
    await expect(canvas).toBeVisible();

    const box = (await canvas.boundingBox())!;
    const stepX = box.width / 64;
    const stepY = box.height / 64;

    // 2. 选用色板索引 6 颜色，在 (10, 10) 绘制特征像素
    await page.click('.palette-chip[data-index="6"]');
    await page.mouse.move(box.x + 10.5 * stepX, box.y + 10.5 * stepY);
    await page.mouse.down();
    await page.mouse.up();

    // 强制触发持久化暂存 (调用 flushAutosave 确保写入 localStorage)
    await page.evaluate(() => window.__studio?.vm.flushAutosave());

    // 3. 刷新浏览器页面 (模拟意外退出/重新打开网页)
    await page.reload();

    // 4. 验证：由于本地有未完成进度，中心空状态显示“⚠️ 检测到上次未完成的编辑进度”横幅
    const restoreBanner = page.locator('#restore-banner');
    await expect(restoreBanner).toBeVisible();

    // 5. 点击“立即恢复”按钮 #btn-restore-project
    const restoreBtn = page.locator('#btn-restore-project');
    await restoreBtn.click();

    // 6. 验证：画布重新加载，之前绘制的 (10, 10) 像素被 100% 完整复原！
    await expect(canvas).toBeVisible();
    await expect(restoreBanner).toBeHidden();

    const restoredPixel = await page.evaluate(() => window.__studio?.vm.doc.pixelIndices[10 * 64 + 10]);
    expect(restoredPixel).toBe(6);
  });
});
