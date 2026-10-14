import { test, expect } from '@playwright/test';

test.describe('E2E: 预设头像载入全流程 (Preset Avatar Loading)', () => {
  test('在空状态下点击载入预设头像，成功载入金发女骑士，并可直接进入蒙版模式进行发色置换', async ({ page }) => {
    await page.goto('./?debug');

    // 1. 空状态下点击「🎨 载入预设头像」
    const presetBtn = page.locator('#btn-empty-preset');
    await expect(presetBtn).toBeVisible();
    await presetBtn.click();

    // 2. 检查空状态遮罩消失，主画布激活，保存/导出按钮就绪
    await expect(page.locator('#empty-dropzone')).toBeHidden();
    const canvas = page.locator('#main-display-canvas');
    await expect(canvas).toBeVisible();

    const btnSave = page.locator('#btn-quick-save');
    await expect(btnSave).toBeEnabled();

    // 3. 切换到遮罩模式，验证发色与遮罩数据已完整就绪
    await page.click('#btn-mode-mask');
    await expect(page.locator('#mask-tools-panel-wrapper')).toBeVisible();

    // 验证头发分区卡片有大量像素
    const hairCard = page.locator('.zone-card[data-zone="1"]');
    await expect(hairCard).toContainText('1494');

    // 验证 03_blonde_金 发色预设处于当前激活状态
    const goldCard = page.locator('.hair-preset-card[data-preset="03_blonde_金"]');
    await expect(goldCard).toBeVisible();
    await expect(goldCard).toHaveClass(/active/);

    // 4. 点击顶栏「🎨 预设」按钮，应弹出防误触确认弹窗
    await page.click('#btn-header-preset');
    const confirmOverlay = page.locator('#confirm-modal-overlay');
    await expect(confirmOverlay).toBeVisible();
    await expect(confirmOverlay).toContainText('载入预设头像');

    // 点击取消关闭弹窗
    await page.click('#confirm-modal-actions button:has-text("取消")');
    await expect(confirmOverlay).toBeHidden();
  });
});
