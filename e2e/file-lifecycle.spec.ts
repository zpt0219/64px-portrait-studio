import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

test.describe('E2E: 文件生命周期闭环 (File Lifecycle Round-trip)', () => {
  test('导出完整工程 ZIP 与纯净 PNG、刷新重置、再导入 ZIP 完整恢复所有像素/遮罩/发色', async ({ page }) => {
    await page.goto('./?debug');

    // 1. 创建空白画布
    await page.click('#btn-empty-blank');
    const canvas = page.locator('#main-display-canvas');
    await expect(canvas).toBeVisible();

    const box = (await canvas.boundingBox())!;
    const stepX = box.width / 64;
    const stepY = box.height / 64;

    // 2. 绘制特征像素 (头发线稿与衣服色块)
    // 颜色 0 (黑色) 绘制在 (30, 20) 到 (35, 20)
    await page.click('.palette-chip[data-index="0"]');
    await page.mouse.move(box.x + 30.5 * stepX, box.y + 20.5 * stepY);
    await page.mouse.down();
    await page.mouse.move(box.x + 35.5 * stepX, box.y + 20.5 * stepY, { steps: 5 });
    await page.mouse.up();

    // 颜色 12 绘制在 (15, 45) 到 (20, 45)
    await page.click('.palette-chip[data-index="12"]');
    await page.mouse.move(box.x + 15.5 * stepX, box.y + 45.5 * stepY);
    await page.mouse.down();
    await page.mouse.move(box.x + 20.5 * stepX, box.y + 45.5 * stepY, { steps: 5 });
    await page.mouse.up();

    // 3. 切换至遮罩模式，标注衣服与头发
    await page.click('#btn-mode-mask');
    await expect(page.locator('#mask-tools-panel-wrapper')).toBeVisible();

    // 涂抹衣服分区 (Zone 4: Clothes)
    await page.click('.zone-card[data-zone="4"]');
    await page.mouse.move(box.x + 15.5 * stepX, box.y + 45.5 * stepY);
    await page.mouse.down();
    await page.mouse.move(box.x + 20.5 * stepX, box.y + 45.5 * stepY, { steps: 5 });
    await page.mouse.up();

    // 涂抹头发分区 (Zone 1: Hair)，保持头发为激活状态以显示发色预设卡
    await page.click('.zone-card[data-zone="1"]');
    await page.mouse.move(box.x + 30.5 * stepX, box.y + 20.5 * stepY);
    await page.mouse.down();
    await page.mouse.move(box.x + 35.5 * stepX, box.y + 20.5 * stepY, { steps: 5 });
    await page.mouse.up();

    // 4. 应用发色置换 (03_blonde_金)
    const goldCard = page.locator('.hair-preset-card[data-preset="03_blonde_金"]');
    await expect(goldCard).toBeVisible();
    await goldCard.click();
    await expect(goldCard).toHaveClass(/active/);

    // 记录导出前当前文档的 100% 完整状态
    const originalSnapshot = await page.evaluate(() => {
      const doc = window.__studio?.vm.doc;
      if (!doc) return null;
      return {
        pixels: Array.from(doc.pixelIndices),
        mask: Array.from(doc.semanticMask),
        palette: [...doc.palette],
        hairPreset: doc.currentHairPreset,
      };
    });
    expect(originalSnapshot).not.toBeNull();
    expect(originalSnapshot!.hairPreset).toBe('03_blonde_金');

    // 5. 真实工程 ZIP 导出与捕获
    const zipDownloadPromise = page.waitForEvent('download');
    await page.click('#btn-export-zip');
    const zipDownload = await zipDownloadPromise;

    expect(zipDownload.suggestedFilename()).toMatch(/^portrait_studio_project_.*\.zip$/);
    const tempZipPath = path.join(os.tmpdir(), `test-export-${Date.now()}.zip`);
    await zipDownload.saveAs(tempZipPath);
    expect(fs.existsSync(tempZipPath)).toBe(true);
    const zipStat = fs.statSync(tempZipPath);
    expect(zipStat.size).toBeGreaterThan(1000);

    // 6. 纯净 64×64 PNG 极简无损导出与验证
    const pngDownloadPromise = page.waitForEvent('download');
    await page.click('#btn-quick-save');
    const pngDownload = await pngDownloadPromise;

    expect(pngDownload.suggestedFilename()).toMatch(/^avatar_36color_64x64_.*\.png$/);
    const tempPngPath = path.join(os.tmpdir(), `test-export-${Date.now()}.png`);
    await pngDownload.saveAs(tempPngPath);
    expect(fs.existsSync(tempPngPath)).toBe(true);
    const pngBuffer = fs.readFileSync(tempPngPath);
    expect(pngBuffer.length).toBeGreaterThan(0);
    expect(pngBuffer.length).toBeLessThan(50000);

    // 验证标准 PNG 文件头签名 (8 字节: 137, 80, 78, 71, 13, 10, 26, 10)
    const pngHeader = Array.from(pngBuffer.subarray(0, 8));
    expect(pngHeader).toEqual([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

    // 7. 清空本地缓存并刷新网页，重置为空白未加载状态
    await page.evaluate(() => localStorage.clear());
    await page.goto('./?debug');

    const isLoadedAfterReload = await page.evaluate(() => window.__studio?.vm.session.isLoaded);
    expect(isLoadedAfterReload).toBe(false);

    // 8. 真实文件注入并上传刚刚导出的工程 ZIP
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(tempZipPath);

    // 等待导入完成
    await expect.poll(async () => {
      return page.evaluate(() => window.__studio?.vm.session.isLoaded);
    }).toBe(true);

    // 9. 严苛 100% 双向比对断言
    const restoredSnapshot = await page.evaluate(() => {
      const doc = window.__studio?.vm.doc;
      if (!doc) return null;
      return {
        pixels: Array.from(doc.pixelIndices),
        mask: Array.from(doc.semanticMask),
        palette: [...doc.palette],
        hairPreset: doc.currentHairPreset,
      };
    });

    expect(restoredSnapshot).not.toBeNull();
    // 逐点比对 4096 像素
    expect(restoredSnapshot!.pixels).toEqual(originalSnapshot!.pixels);
    // 逐点比对 4096 遮罩标注
    expect(restoredSnapshot!.mask).toEqual(originalSnapshot!.mask);
    // 比对 36 色色板
    expect(restoredSnapshot!.palette).toEqual(originalSnapshot!.palette);
    // 比对固化发色预设
    expect(restoredSnapshot!.hairPreset).toBe('03_blonde_金');

    // 清理临时文件
    try {
      fs.unlinkSync(tempZipPath);
      fs.unlinkSync(tempPngPath);
    } catch {
      // 忽略清理异常
    }
  });
});
