import { test, expect } from '@playwright/test';

test.describe('E2E: 眨眼与张嘴动画工坊 (Animation Studio E2E)', () => {
  test('在未载入头像时动画按钮禁用；载入预设头像后打开动画工坊，可进行实时播放、打字模拟、特征锚点微调、静止帧检查及导出 Sprite Sheet 与引擎 JSON', async ({
    page,
  }) => {
    await page.goto('./?debug');

    // 1. 未载入时顶栏「🎬 动画」按钮处于禁用状态
    const btnAnim = page.locator('#btn-header-anim');
    await expect(btnAnim).toBeVisible();
    await expect(btnAnim).toBeDisabled();

    // 2. 载入预设金发骑士头像
    const presetBtn = page.locator('#btn-empty-preset');
    await expect(presetBtn).toBeVisible();
    await presetBtn.click();
    await expect(page.locator('#empty-dropzone')).toBeHidden();

    // 3. 载入后动画按钮应激活
    await expect(btnAnim).toBeEnabled();

    // 4. 点击打开动画工坊弹窗
    await btnAnim.click();
    const modalOverlay = page.locator('#animation-modal-overlay');
    await expect(modalOverlay).toBeVisible();

    // 5. 验证播放器与对话框存在
    const playerCanvas = page.locator('#anim-player-canvas');
    await expect(playerCanvas).toBeVisible();
    const dialogueBox = page.locator('#anim-dialogue-text');
    await expect(dialogueBox).toBeVisible();

    // 6. 播放/暂停控制
    const btnPlayToggle = page.locator('#btn-anim-toggle-play');
    await expect(btnPlayToggle).toContainText('暂停');
    await btnPlayToggle.click();
    await expect(btnPlayToggle).toContainText('播放');
    await btnPlayToggle.click();
    await expect(btnPlayToggle).toContainText('暂停');

    // 7. 说话嘴型切换复选框
    const chkTalking = page.locator('#chk-anim-talking');
    await expect(chkTalking).toBeChecked();
    await chkTalking.uncheck();
    await expect(chkTalking).not.toBeChecked();
    await chkTalking.check();
    await expect(chkTalking).toBeChecked();

    // 8. 缩略图点击测试 (切换为静止帧预览，播放按钮自动显示播放)
    const eyeThumb2 = page.locator('#thumb-eye-2');
    await expect(eyeThumb2).toBeVisible();
    await eyeThumb2.click();
    await expect(btnPlayToggle).toContainText('播放');

    const mouthThumb1 = page.locator('#thumb-mouth-1');
    await expect(mouthThumb1).toBeVisible();
    await mouthThumb1.click();
    await expect(btnPlayToggle).toContainText('播放');

    // 9. 锚点坐标输入与微调
    const leftEyeX = page.locator('#inp-left-eye-x');
    const eyeY = page.locator('#inp-eye-y');
    const mouthY = page.locator('#inp-mouth-y');

    const oldLeftX = await leftEyeX.inputValue();
    expect(Number(oldLeftX)).toBeGreaterThan(0);
    expect(Number(oldLeftX)).toBeLessThan(64);

    // 修改左眼 X 坐标并点击重算
    await leftEyeX.fill(String(Number(oldLeftX) + 1));
    await page.click('#btn-anim-apply-anchors');

    // 点击重新检测恢复默认锚点
    await page.click('#btn-anim-reset-anchors');
    const resetLeftX = await leftEyeX.inputValue();
    expect(resetLeftX).toBe(oldLeftX);

    // 10. 导出 Sprite Sheet (192x192 PNG)
    const sheetDownloadPromise = page.waitForEvent('download');
    await page.click('#btn-export-sheet-3x3');
    const sheetDownload = await sheetDownloadPromise;
    expect(sheetDownload.suggestedFilename()).toBe('portrait_spritesheet_3x3.png');

    // 11. 导出游戏引擎 JSON 元数据
    const jsonDownloadPromise = page.waitForEvent('download');
    await page.click('#btn-export-meta-json');
    const jsonDownload = await jsonDownloadPromise;
    expect(jsonDownload.suggestedFilename()).toBe('portrait_animation_frames.json');

    // 12. 关闭弹窗 (点击右上角 ✕ 按钮)
    await page.click('#anim-modal-close');
    await expect(modalOverlay).toBeHidden();

    // 13. 再次打开并按 Esc 键关闭
    await btnAnim.click();
    await expect(modalOverlay).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modalOverlay).toBeHidden();
  });
});
