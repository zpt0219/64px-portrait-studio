import { test, expect } from '@playwright/test';

test.describe('E2E: 多标签页与跨标签剪贴板 (Multi-Tab & Cross-Tab Clipboard)', () => {
  test('支持多标签页管理、预设与新建打开新Tab、标签切换与独立撤销历史', async ({ page }) => {
    await page.goto('./?debug');

    // 1. 验证初始状态：TabBar 存在且有 1 个默认标签页
    const tabBar = page.locator('#tabbar-mount');
    await expect(tabBar).toBeVisible();

    const tabs = page.locator('.tab-item');
    await expect(tabs).toHaveCount(1);
    await expect(page.locator('.tab-item.active .tab-title')).toContainText('未命名-1');

    // 2. 点击 ＋ 新建空白标签页
    const addBtn = page.locator('#btn-tab-add');
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    await expect(tabs).toHaveCount(2);
    await expect(page.locator('.tab-item.active .tab-title')).toContainText('未命名-2');

    // 3. 点击载入预设头像，预设会在新标签页中打开
    await page.click('#btn-header-preset');
    await expect(tabs).toHaveCount(3);
    await expect(page.locator('.tab-item.active .tab-title')).toContainText('金发女骑士');

    // 4. 双击第三个标签页重命名
    const activeTab = tabs.nth(2);
    const tabTitleSpan = activeTab.locator('.tab-title');
    await tabTitleSpan.dblclick();

    await expect(activeTab.locator('.tab-title.editing')).toBeVisible();
    await tabTitleSpan.evaluate((el) => {
      (el as HTMLElement).textContent = '我的骑士';
    });
    await page.keyboard.press('Enter');

    await expect(activeTab.locator('.tab-title')).toHaveText('我的骑士');

    // 5. 使用快捷键 Alt+[ 和 Alt+] 切换标签
    // 当前在 Tab 3 (我的骑士，下标 2)
    await page.keyboard.press('Alt+BracketLeft');
    await expect(page.locator('.tab-item.active .tab-title')).toContainText('未命名-2');

    await page.keyboard.press('Alt+BracketRight');
    await expect(page.locator('.tab-item.active .tab-title')).toContainText('我的骑士');

    // 6. 测试无撤销历史的静默关闭
    // 切换到 Tab 2 (未命名-2) 并点击关闭按钮
    await tabs.nth(1).click();
    await expect(page.locator('.tab-item.active .tab-title')).toContainText('未命名-2');
    await tabs.nth(1).locator('.tab-close-btn').click();

    // 应直接关闭，不需要二次弹窗
    await expect(tabs).toHaveCount(2);
    await expect(page.locator('#confirm-modal-overlay')).toBeHidden();

    // 7. 测试有撤销历史时的防误关确认
    // 切换到第 2 个标签页 (我的骑士) 选择画笔画一笔
    await tabs.nth(1).click();
    await expect(page.locator('.tab-item.active .tab-title')).toContainText('我的骑士');

    // 在 (10, 10) 画一笔
    const canvas = page.locator('#main-display-canvas');
    const box = await canvas.boundingBox();
    if (box) {
      const stepX = box.width / 64;
      const stepY = box.height / 64;
      await page.mouse.move(box.x + 10.5 * stepX, box.y + 10.5 * stepY);
      await page.mouse.down();
      await page.mouse.move(box.x + 12.5 * stepX, box.y + 10.5 * stepY);
      await page.mouse.up();
    }

    // 验证有撤销历史
    await expect(page.locator('#btn-undo')).toBeEnabled();

    // 点击关闭标签页
    await tabs.nth(1).locator('.tab-close-btn').click();

    // 应该弹出确认弹窗
    const confirmOverlay = page.locator('#confirm-modal-overlay');
    await expect(confirmOverlay).toBeVisible();
    await expect(confirmOverlay).toContainText('关闭标签页');

    // 点击取消：标签页保留
    await confirmOverlay.locator('#confirm-modal-actions button:has-text("取消")').click();
    await expect(confirmOverlay).toBeHidden();
    await expect(tabs).toHaveCount(2);

    // 再次点击关闭并确认
    await tabs.nth(1).locator('.tab-close-btn').click();
    await expect(confirmOverlay).toBeVisible();
    await confirmOverlay.locator('#confirm-modal-actions button:has-text("关闭")').click();
    await expect(confirmOverlay).toBeHidden();
    await expect(tabs).toHaveCount(1);
  });

  test('支持跨标签页复制选区与粘贴 (Cross-Tab Selection Copy & Paste)', async ({ page }) => {
    await page.goto('./?debug');

    // 1. 载入预设头像 (Tab 1: 金发女骑士)
    const emptyPresetBtn = page.locator('#btn-empty-preset');
    if (await emptyPresetBtn.isVisible()) {
      await emptyPresetBtn.click();
    } else {
      await page.click('#btn-header-preset');
    }

    const tabs = page.locator('.tab-item');
    await expect(tabs).toHaveCount(1);
    await expect(page.locator('.tab-item.active .tab-title')).toContainText('金发女骑士');

    // 2. 新建空白标签页 (Tab 2: 未命名-2)
    await page.click('#btn-tab-add');
    await expect(tabs).toHaveCount(2);
    await expect(page.locator('.tab-item.active .tab-title')).toContainText('未命名-2');

    // 3. 切回 Tab 1 (金发女骑士)
    await tabs.nth(0).click();
    await expect(page.locator('.tab-item.active .tab-title')).toContainText('金发女骑士');

    // 4. 切换到框选工具并选择一块区域
    await page.click('#btn-tool-select');

    const canvas = page.locator('#main-display-canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const stepX = box.width / 64;
    const stepY = box.height / 64;

    // 从 (28, 28) 拖动框选到 (36, 36)
    await page.mouse.move(box.x + 28.5 * stepX, box.y + 28.5 * stepY);
    await page.mouse.down();
    await page.mouse.move(box.x + 36.5 * stepX, box.y + 36.5 * stepY);
    await page.mouse.up();

    // 5. 按 Ctrl+C 复制选区
    await page.keyboard.press('Control+c');

    // 6. 切换到 Tab 2 (空白标签页)
    await tabs.nth(1).click();
    await expect(page.locator('.tab-item.active .tab-title')).toContainText('未命名-2');

    // 验证此时 Tab 2 是全透明画布 (所有像素均为 255)
    const isBlankBefore = await page.evaluate(() => {
      const pixels = window.__studio?.vm.doc.pixelIndices;
      if (!pixels) return false;
      return Array.from(pixels).every((p) => p === 255);
    });
    expect(isBlankBefore).toBe(true);

    // 7. 按 Ctrl+V 粘贴选区到 Tab 2
    await page.keyboard.press('Control+v');

    // 按 Enter 提交浮动选区到画布
    await page.keyboard.press('Enter');

    // 8. 验证 Tab 2 已经包含粘贴的像素 (不再全为 255)
    const nonTransparentCount = await page.evaluate(() => {
      const pixels = window.__studio?.vm.doc.pixelIndices;
      if (!pixels) return 0;
      return Array.from(pixels).filter((p) => p !== 255).length;
    });
    expect(nonTransparentCount).toBeGreaterThan(0);

    // 9. 验证 Tab 2 可以通过 Undo 撤销粘贴
    await page.click('#btn-undo');
    const isBlankAfterUndo = await page.evaluate(() => {
      const pixels = window.__studio?.vm.doc.pixelIndices;
      if (!pixels) return false;
      return Array.from(pixels).every((p) => p === 255);
    });
    expect(isBlankAfterUndo).toBe(true);

    // 10. 切回 Tab 1，验证 Tab 1 的内容与历史未受任何影响
    await tabs.nth(0).click();
    await expect(page.locator('.tab-item.active .tab-title')).toContainText('金发女骑士');
    const tab1NonTransparentCount = await page.evaluate(() => {
      const pixels = window.__studio?.vm.doc.pixelIndices;
      if (!pixels) return 0;
      return Array.from(pixels).filter((p) => p !== 255).length;
    });
    expect(tab1NonTransparentCount).toBeGreaterThan(1000);
  });
});
