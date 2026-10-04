import { test, expect } from '@playwright/test';

test.describe('E2E: 选区高级操作与工具箱全矩阵 (Selection & Tools Advanced Matrix)', () => {
  // 辅助函数：定位画布并计算单像素跨度
  async function getCanvasMetrics(page: any) {
    const canvas = page.locator('#main-display-canvas');
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    const stepX = box.width / 64;
    const stepY = box.height / 64;
    return { canvas, box, stepX, stepY };
  }

  test('测试 1：选区约束：画笔与橡皮擦横穿选区内外（左键前景色、右键背景色、透明橡皮严格边界裁剪）', async ({ page }) => {
    await page.goto('./?debug');
    await page.click('#btn-empty-blank');
    const { box, stepX, stepY } = await getCanvasMetrics(page);

    // 1. 建立选区 (10, 10) 至 (20, 20)，尺寸 11×11
    await page.click('#btn-tool-select');
    await page.mouse.move(box.x + 10.5 * stepX, box.y + 10.5 * stepY);
    await page.mouse.down();
    await page.mouse.move(box.x + 20.5 * stepX, box.y + 20.5 * stepY, { steps: 5 });
    await page.mouse.up();

    const contextBar = page.locator('#floating-context-bar');
    await expect(contextBar).toBeVisible();

    // 2. 左键画笔：横穿选区内外 (从 x=5 到 x=25, y=15)
    await page.click('#btn-tool-pen');
    await page.click('.palette-chip[data-index="5"]'); // 前景色为 5

    await page.mouse.move(box.x + 5.5 * stepX, box.y + 15.5 * stepY);
    await page.mouse.down();
    await page.mouse.move(box.x + 25.5 * stepX, box.y + 15.5 * stepY, { steps: 12 });
    await page.mouse.up();

    // 断言左键画笔裁剪：仅内部 (10..20, 15) 着色为 5，外部 (5..9, 15) 与 (21..25, 15) 严守 255
    const penLeftCheck = await page.evaluate(() => {
      const idx = window.__studio?.vm.doc.pixelIndices!;
      return {
        outsideLeft: idx[15 * 64 + 5],
        outsideLeftNear: idx[15 * 64 + 9],
        insideLeft: idx[15 * 64 + 10],
        insideCenter: idx[15 * 64 + 15],
        insideRight: idx[15 * 64 + 20],
        outsideRightNear: idx[15 * 64 + 21],
        outsideRight: idx[15 * 64 + 25],
      };
    });
    expect(penLeftCheck.outsideLeft).toBe(255);
    expect(penLeftCheck.outsideLeftNear).toBe(255);
    expect(penLeftCheck.insideLeft).toBe(5);
    expect(penLeftCheck.insideCenter).toBe(5);
    expect(penLeftCheck.insideRight).toBe(5);
    expect(penLeftCheck.outsideRightNear).toBe(255);
    expect(penLeftCheck.outsideRight).toBe(255);

    // 3. 右键画笔：纵穿选区内外绘制背景色 (从 y=5 到 y=25, x=15)
    // 右键点击色板 12 设为背景色
    await page.click('.palette-chip[data-index="12"]', { button: 'right' });
    const bgIndex = await page.evaluate(() => window.__studio?.vm.session.bgPaletteIndex);
    expect(bgIndex).toBe(12);

    await page.mouse.move(box.x + 15.5 * stepX, box.y + 5.5 * stepY);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(box.x + 15.5 * stepX, box.y + 25.5 * stepY, { steps: 12 });
    await page.mouse.up({ button: 'right' });

    // 断言右键画笔裁剪：仅内部 (15, 10..20) 变更为背景色 12，外部 (15, 5..9) 与 (15, 21..25) 保持 255
    const penRightCheck = await page.evaluate(() => {
      const idx = window.__studio?.vm.doc.pixelIndices!;
      return {
        outsideTop: idx[5 * 64 + 15],
        insideTop: idx[10 * 64 + 15],
        insideCenter: idx[15 * 64 + 15],
        insideBottom: idx[20 * 64 + 15],
        outsideBottom: idx[25 * 64 + 15],
      };
    });
    expect(penRightCheck.outsideTop).toBe(255);
    expect(penRightCheck.insideTop).toBe(12);
    expect(penRightCheck.insideCenter).toBe(12);
    expect(penRightCheck.insideBottom).toBe(12);
    expect(penRightCheck.outsideBottom).toBe(255);

    // 4. 橡皮擦：横扫擦除选区内部 (y=15, 从 x=5 到 x=25)
    await page.click('#btn-tool-eraser');
    await page.mouse.move(box.x + 5.5 * stepX, box.y + 15.5 * stepY);
    await page.mouse.down();
    await page.mouse.move(box.x + 25.5 * stepX, box.y + 15.5 * stepY, { steps: 12 });
    await page.mouse.up();

    // 断言橡皮擦裁剪：内部 (15, 15) 被精确擦除为 255；而内部上方未被橡皮扫到的 (15, 12) 依然是 12
    const eraserCheck = await page.evaluate(() => {
      const idx = window.__studio?.vm.doc.pixelIndices!;
      return {
        erasedCenter: idx[15 * 64 + 15],
        preservedTop: idx[12 * 64 + 15],
      };
    });
    expect(eraserCheck.erasedCenter).toBe(255);
    expect(eraserCheck.preservedTop).toBe(12);
  });

  test('测试 2：选区约束：油漆桶单点泛洪截断与 Shift+油漆桶选区内全域同色替换', async ({ page }) => {
    await page.goto('./?debug');
    await page.click('#btn-empty-blank');
    const { box, stepX, stepY } = await getCanvasMetrics(page);

    // 1. 建立精准选区 (15, 15) 至 (25, 25) (尺寸 11×11)
    // 此时选区内外皆为透明色 255 (全连通)
    await page.click('#btn-tool-select');
    await page.mouse.move(box.x + 15.5 * stepX, box.y + 15.5 * stepY);
    await page.mouse.down();
    await page.mouse.move(box.x + 25.5 * stepX, box.y + 25.5 * stepY, { steps: 5 });
    await page.mouse.up();

    const sel = await page.evaluate(() => window.__studio?.vm.session.selection);
    expect(sel).toEqual({ x: 15, y: 15, w: 11, h: 11 });

    // 2. 油漆桶左键单点填充 (前景色 18 灿金)
    await page.click('#btn-tool-bucket');
    await page.click('.palette-chip[data-index="18"]');
    await page.mouse.move(box.x + 20.5 * stepX, box.y + 20.5 * stepY);
    await page.mouse.down();
    await page.mouse.up();

    // 断言单点泛洪截断：选区内部全部变为 18，但紧邻选区外的 (14, 20) 与 (26, 20) 严防溢流，仍为 255
    const bucketFloodCheck = await page.evaluate(() => {
      const idx = window.__studio?.vm.doc.pixelIndices!;
      return {
        insideCorner: idx[15 * 64 + 15],
        insideCenter: idx[20 * 64 + 20],
        outsideLeft: idx[20 * 64 + 14],
        outsideRight: idx[20 * 64 + 26],
      };
    });
    expect(bucketFloodCheck.insideCorner).toBe(18);
    expect(bucketFloodCheck.insideCenter).toBe(18);
    expect(bucketFloodCheck.outsideLeft).toBe(255);
    expect(bucketFloodCheck.outsideRight).toBe(255);

    // 3. 油漆桶右键单点填充 (背景色 8)
    await page.click('.palette-chip[data-index="8"]', { button: 'right' });
    await page.mouse.move(box.x + 20.5 * stepX, box.y + 20.5 * stepY);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });

    const bucketBgCheck = await page.evaluate(() => {
      const idx = window.__studio?.vm.doc.pixelIndices!;
      return {
        inside: idx[20 * 64 + 20],
        outside: idx[20 * 64 + 14],
      };
    });
    expect(bucketBgCheck.inside).toBe(8);
    expect(bucketBgCheck.outside).toBe(255);

    // 4. Shift + 油漆桶全域同色替换 (仅限选区内)
    // 先取消选区，在选区外部 (5, 5) 绘制颜色 3
    await page.keyboard.press('Escape');
    await page.click('#btn-tool-pen');
    await page.click('.palette-chip[data-index="3"]');
    await page.mouse.move(box.x + 5.5 * stepX, box.y + 5.5 * stepY);
    await page.mouse.down();
    await page.mouse.up();

    // 在刚才的色块内部 (17, 17) 与 (23, 23) 绘制两个分散不连通的颜色 3
    await page.mouse.move(box.x + 17.5 * stepX, box.y + 17.5 * stepY);
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.move(box.x + 23.5 * stepX, box.y + 23.5 * stepY);
    await page.mouse.down();
    await page.mouse.up();

    // 重新精准框选 (15, 15) 至 (25, 25)
    await page.click('#btn-tool-select');
    await page.mouse.move(box.x + 15.5 * stepX, box.y + 15.5 * stepY);
    await page.mouse.down();
    await page.mouse.move(box.x + 25.5 * stepX, box.y + 25.5 * stepY, { steps: 5 });
    await page.mouse.up();

    // 切换油漆桶，前景色选为 30 (纯白)
    await page.click('#btn-tool-bucket');
    await page.click('.palette-chip[data-index="30"]');

    // 按住 Shift 键，点击选区内的 (17, 17) 进行全域同色替换
    await page.keyboard.down('Shift');
    await page.mouse.move(box.x + 17.5 * stepX, box.y + 17.5 * stepY);
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Shift');

    // 断言：
    // 选区内 (17, 17) 与不相邻的 (23, 23) 均被批量替换为 30
    // 选区内底色 8 保持为 8
    // 选区外的 (5, 5) 绝对不被替换，依然为 3
    const shiftBucketCheck = await page.evaluate(() => {
      const idx = window.__studio?.vm.doc.pixelIndices!;
      return {
        insideDot1: idx[17 * 64 + 17],
        insideDot2: idx[23 * 64 + 23],
        insideBase: idx[20 * 64 + 20],
        outsideUntouched: idx[5 * 64 + 5],
      };
    });
    expect(shiftBucketCheck.insideDot1).toBe(30);
    expect(shiftBucketCheck.insideDot2).toBe(30);
    expect(shiftBucketCheck.insideBase).toBe(8);
    expect(shiftBucketCheck.outsideUntouched).toBe(3);
  });

  test('测试 3：选区几何变换与操作：Shift+H 水平翻转、Shift+V 垂直翻转、Shift+T 顺时针旋转90°(长宽自适应)、Delete 一键镂空', async ({ page }) => {
    await page.goto('./?debug');
    await page.click('#btn-empty-blank');
    const { box, stepX, stepY } = await getCanvasMetrics(page);

    // 1. 在 (10, 10) 绘制非对称图案：宽度 6，高度 4 (从 x=10..15, y=10..13)
    // 填充底色 1
    await page.click('.palette-chip[data-index="1"]');
    for (let y = 10; y <= 13; y++) {
      for (let x = 10; x <= 15; x++) {
        await page.mouse.move(box.x + (x + 0.5) * stepX, box.y + (y + 0.5) * stepY);
        await page.mouse.down();
        await page.mouse.up();
      }
    }
    // 在左上角 (10, 10) 点一颗高对比度特征点 7
    await page.click('.palette-chip[data-index="7"]');
    await page.mouse.move(box.x + 10.5 * stepX, box.y + 10.5 * stepY);
    await page.mouse.down();
    await page.mouse.up();

    // 精确框选该 6×4 区域 (从 10, 10 到 15, 13)
    await page.click('#btn-tool-select');
    await page.mouse.move(box.x + 10.5 * stepX, box.y + 10.5 * stepY);
    await page.mouse.down();
    await page.mouse.move(box.x + 15.5 * stepX, box.y + 13.5 * stepY, { steps: 5 });
    await page.mouse.up();

    const sel = await page.evaluate(() => window.__studio?.vm.session.selection);
    expect(sel).toEqual({ x: 10, y: 10, w: 6, h: 4 });

    // 验证初始状态：特征点 7 位于左上角 (10, 10)，右上角 (15, 10) 为 1
    const beforeFlip = await page.evaluate(() => {
      const idx = window.__studio?.vm.doc.pixelIndices!;
      return [idx[10 * 64 + 10], idx[10 * 64 + 15]];
    });
    expect(beforeFlip).toEqual([7, 1]);

    // 2. 按下快捷键 Shift + H 进行水平翻转
    await page.keyboard.press('Shift+h');

    // 断言：特征点 7 镜像对调至右上角 (15, 10)，左上角 (10, 10) 变为 1
    const afterFlipH = await page.evaluate(() => {
      const idx = window.__studio?.vm.doc.pixelIndices!;
      return [idx[10 * 64 + 10], idx[10 * 64 + 15]];
    });
    expect(afterFlipH).toEqual([1, 7]);

    // 3. 按下快捷键 Shift + V 进行垂直翻转
    await page.keyboard.press('Shift+v');

    // 断言：特征点 7 从右上角 (15, 10) 镜像对调至右下角 (15, 13)
    const afterFlipV = await page.evaluate(() => {
      const idx = window.__studio?.vm.doc.pixelIndices!;
      return [idx[10 * 64 + 15], idx[13 * 64 + 15]];
    });
    expect(afterFlipV).toEqual([1, 7]);

    // 4. 按下快捷键 Shift + T 进行顺时针旋转 90° (长宽自适应对调)
    await page.keyboard.press('Shift+t');

    // 断言：原选区 6×4 旋转后自动变为 4×6！
    const rotatedSel = await page.evaluate(() => window.__studio?.vm.session.selection);
    expect(rotatedSel?.w).toBe(4);
    expect(rotatedSel?.h).toBe(6);

    // 5. 按下 Delete 键一键镂空选区
    await page.keyboard.press('Delete');

    // 断言：选区内所有像素全部被清空为 255 (透明)，而选区框本身依然保留！
    const afterDelete = await page.evaluate(() => {
      const idx = window.__studio?.vm.doc.pixelIndices!;
      const sel = window.__studio?.vm.session.selection!;
      let allTransparent = true;
      for (let y = sel.y; y < sel.y + sel.h; y++) {
        for (let x = sel.x; x < sel.x + sel.w; x++) {
          if (idx[y * 64 + x] !== 255) allTransparent = false;
        }
      }
      return { allTransparent, hasSelection: sel !== null };
    });
    expect(afterDelete.allTransparent).toBe(true);
    expect(afterDelete.hasSelection).toBe(true);
  });

  test('测试 4：选区鼠标交互与剪贴板：拖拽平移镂空、Ctrl+拖拽复制、Ctrl+X 剪切、Ctrl+V 粘贴、Ctrl+D 取消选区', async ({ page }) => {
    await page.goto('./?debug');
    await page.click('#btn-empty-blank');
    const { box, stepX, stepY } = await getCanvasMetrics(page);

    // 1. 绘制 3×3 色块 (颜色 3) 在 (10, 10) 至 (12, 12)
    await page.click('.palette-chip[data-index="3"]');
    for (let y = 10; y <= 12; y++) {
      for (let x = 10; x <= 12; x++) {
        await page.mouse.move(box.x + (x + 0.5) * stepX, box.y + (y + 0.5) * stepY);
        await page.mouse.down();
        await page.mouse.up();
      }
    }

    // 框选 (10, 10) 至 (12, 12)
    await page.click('#btn-tool-select');
    await page.mouse.move(box.x + 10.5 * stepX, box.y + 10.5 * stepY);
    await page.mouse.down();
    await page.mouse.move(box.x + 12.5 * stepX, box.y + 12.5 * stepY, { steps: 5 });
    await page.mouse.up();

    // 2. 拖拽平移：向右下拖拽 +9 像素到 (19, 19)
    await page.mouse.move(box.x + 11.5 * stepX, box.y + 11.5 * stepY);
    await page.mouse.down();
    await page.mouse.move(box.x + 20.5 * stepX, box.y + 20.5 * stepY, { steps: 8 });
    await page.mouse.up();

    const moveCheck = await page.evaluate(() => {
      const idx = window.__studio?.vm.doc.pixelIndices!;
      return { origHollow: idx[10 * 64 + 10], newPasted: idx[19 * 64 + 19] };
    });
    expect(moveCheck.origHollow).toBe(255);
    expect(moveCheck.newPasted).toBe(3);

    // Ctrl+Z 撤回原位
    await page.keyboard.press('Control+z');

    // 3. Ctrl + 拖拽复制：原位保留，新位生成克隆
    await page.keyboard.down('Control');
    await page.mouse.move(box.x + 11.5 * stepX, box.y + 11.5 * stepY);
    await page.mouse.down();
    await page.mouse.move(box.x + 26.5 * stepX, box.y + 26.5 * stepY, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Control');

    const copyCheck = await page.evaluate(() => {
      const idx = window.__studio?.vm.doc.pixelIndices!;
      return { origPreserved: idx[10 * 64 + 10], clonedCopy: idx[25 * 64 + 25] };
    });
    expect(copyCheck.origPreserved).toBe(3);
    expect(copyCheck.clonedCopy).toBe(3);

    // 4. Ctrl + X 剪切选区 (此时选区位于 25, 25 副本处)
    await page.keyboard.press('Control+x');
    const cutCheck = await page.evaluate(() => window.__studio?.vm.doc.pixelIndices![25 * 64 + 25]);
    expect(cutCheck).toBe(255); // 副本被镂空剪切

    // 5. Ctrl + V 粘贴选区
    await page.keyboard.press('Control+v');
    const pasteCheck = await page.evaluate(() => {
      const sel = window.__studio?.vm.session.selection;
      return sel !== null;
    });
    expect(pasteCheck).toBe(true);

    // 6. Ctrl + D 取消选区
    await page.keyboard.press('Control+d');
    const deselectCheck = await page.evaluate(() => window.__studio?.vm.session.selection);
    expect(deselectCheck).toBeNull();
  });

  test('测试 5：选区内换色弹窗(Shift+R)与色彩交换(X)、顶栏使用教程与快捷键', async ({ page }) => {
    await page.goto('./?debug');
    await page.click('#btn-empty-blank');
    const { box, stepX, stepY } = await getCanvasMetrics(page);

    // 1. 在选区内 (10, 10) 绘制颜色 3，在选区外 (5, 5) 也绘制颜色 3
    await page.click('.palette-chip[data-index="3"]');
    await page.mouse.move(box.x + 5.5 * stepX, box.y + 5.5 * stepY);
    await page.mouse.down();
    await page.mouse.up();

    await page.mouse.move(box.x + 10.5 * stepX, box.y + 10.5 * stepY);
    await page.mouse.down();
    await page.mouse.up();

    // 框选 (10, 10)
    await page.click('#btn-tool-select');
    await page.mouse.move(box.x + 9.8 * stepX, box.y + 9.8 * stepY);
    await page.mouse.down();
    await page.mouse.move(box.x + 11.8 * stepX, box.y + 11.8 * stepY, { steps: 5 });
    await page.mouse.up();

    // 2. 按下 Shift + R 唤起选区内换色弹窗
    await page.keyboard.press('Shift+r');
    const replaceModal = page.locator('#replace-color-modal-overlay');
    await expect(replaceModal).toBeVisible();

    // 选择原颜色 3，新颜色 18，确定替换
    await replaceModal.locator('.mini-chip[data-index="3"]').click();
    await replaceModal.locator('.mini-chip[data-index="18"]').click();
    await replaceModal.locator('#btn-confirm-replace').click();
    await expect(replaceModal).toBeHidden();

    // 断言：选区内 (10, 10) 变为 18，选区外 (5, 5) 严格保持为 3
    const replaceResult = await page.evaluate(() => {
      const idx = window.__studio?.vm.doc.pixelIndices!;
      return { inside: idx[10 * 64 + 10], outside: idx[5 * 64 + 5] };
    });
    expect(replaceResult.inside).toBe(18);
    expect(replaceResult.outside).toBe(3);

    // 3. 快捷键 X 交换前景色与背景色
    const colorsBeforeX = await page.evaluate(() => {
      const s = window.__studio?.vm.session!;
      return { fg: s.activePaletteIndex, bg: s.bgPaletteIndex };
    });
    await page.keyboard.press('KeyX');
    const colorsAfterX = await page.evaluate(() => {
      const s = window.__studio?.vm.session!;
      return { fg: s.activePaletteIndex, bg: s.bgPaletteIndex };
    });
    expect(colorsAfterX.fg).toBe(colorsBeforeX.bg);
    expect(colorsAfterX.bg).toBe(colorsBeforeX.fg);

    // 4. 教程弹窗与快捷键
    await page.click('#btn-header-help');
    const helpModal = page.locator('#help-modal-overlay');
    await expect(helpModal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(helpModal).toBeHidden();

    // 验证 W 键解除绑定，不会误切至 mask 模式
    await page.keyboard.press('KeyW');
    const mode = await page.evaluate(() => window.__studio?.vm.session.activeMode);
    expect(mode).toBe('pixel');
  });
});
