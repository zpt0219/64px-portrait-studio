/**
 * 动画工坊与游戏导出模态窗口 (Animation Studio Modal)
 */

import { ViewModel } from '../../app/viewModel';
import { createAnimationProject, AnimationProject, FacialAnchors } from '../../core/animation';
import { AnimationPlayer } from './AnimationPlayer';
import { downloadMatrixSpriteSheet, downloadEngineMetadataJson } from '../../app/browser/animationExport';
import { drawIndexedPixels } from '../../app/browser/pixelCanvas';

export class AnimationModal {
  private overlayEl: HTMLElement | null = null;
  private player: AnimationPlayer | null = null;
  private currentProject: AnimationProject | null = null;
  private anchors: FacialAnchors | null = null;
  private isOpen = false;
  private abortController = new AbortController();
  private _isDisposed = false;

  constructor(private readonly container: HTMLElement, private readonly vm: ViewModel) {
    this.build();
    this.setupEvents();
  }

  private build(): void {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-modal-overlay animation-modal-overlay';
    overlay.id = 'animation-modal-overlay';
    overlay.style.display = 'none';

    overlay.innerHTML = `
      <div class="confirm-modal-card animation-modal-card" role="dialog" aria-modal="true" style="max-width: 900px; width: 95%;">
        <!-- 弹窗顶栏 -->
        <div class="confirm-modal-header">
          <div class="confirm-modal-title-group">
            <span class="confirm-modal-icon">🎬</span>
            <span class="confirm-modal-title">动画工坊与游戏导出 (Animation Studio)</span>
          </div>
          <button class="confirm-modal-close-btn" id="anim-modal-close" title="关闭 (Esc)">✕</button>
        </div>

        <!-- 弹窗主体：左侧游戏模拟播放，右侧帧与锚点管理 -->
        <div class="confirm-modal-body anim-modal-body" style="display: flex; gap: 24px; padding: 20px 0;">
          <!-- 左侧：模拟游戏对话框 -->
          <div class="anim-preview-pane" style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 16px;">
            <div class="anim-viewport-frame" style="background: #111422; border: 2px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);">
              <canvas id="anim-player-canvas" width="256" height="256" style="display: block; image-rendering: pixelated; width: 256px; height: 256px;"></canvas>
            </div>

            <!-- 对话框文字打字模拟 -->
            <div class="anim-dialogue-mock" style="width: 100%; max-width: 320px; background: rgba(18, 22, 38, 0.9); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; padding: 10px 14px; font-size: 13px; line-height: 1.5; color: #E2E8F0;">
              <div style="font-weight: bold; color: #38BDF8; margin-bottom: 4px;">💬 游戏对话模拟:</div>
              <div id="anim-dialogue-text">「你好！这里是 64px Portrait Studio 动画工坊，支持全自动眨眼与张嘴对话模拟。」</div>
            </div>

            <!-- 播放器快捷控制 -->
            <div class="anim-player-controls" style="display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; align-items: center;">
              <button class="btn btn-outline btn-sm" id="btn-anim-toggle-play">⏸ 暂停</button>
              <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;">
                <input type="checkbox" id="chk-anim-talking" checked> 模拟讲话嘴型
              </label>
              <label style="display: flex; align-items: center; gap: 6px; font-size: 12px;">
                眨眼间隔:
                <input type="range" id="rng-anim-blink" min="1.5" max="5.0" step="0.5" value="3.5" style="width: 80px;">
                <span id="txt-anim-blink">3.5s</span>
              </label>
            </div>
          </div>

          <!-- 右侧：多帧缩略图与锚点微调 -->
          <div class="anim-config-pane" style="flex: 1.3; display: flex; flex-direction: column; gap: 16px;">
            <!-- 关键帧序列展示 -->
            <div class="anim-section-card" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 12px;">
              <div style="font-weight: 600; font-size: 13px; margin-bottom: 8px; color: #F1F5F9;">🎞️ 眨眼 3 帧序列 (Blink Frames)</div>
              <div class="anim-thumbs-row" id="row-eye-thumbs" style="display: flex; gap: 12px;">
                <!-- 0: 睁眼, 1: 半睁, 2: 闭眼 -->
                <div class="anim-thumb-box" data-eye="0" style="text-align: center; cursor: pointer;">
                  <canvas width="64" height="64" id="thumb-eye-0" style="width: 64px; height: 64px; border: 1px solid #475569; border-radius: 4px; display: block; image-rendering: pixelated;"></canvas>
                  <span style="font-size: 11px; color: #94A3B8;">0: 睁眼</span>
                </div>
                <div class="anim-thumb-box" data-eye="1" style="text-align: center; cursor: pointer;">
                  <canvas width="64" height="64" id="thumb-eye-1" style="width: 64px; height: 64px; border: 1px solid #475569; border-radius: 4px; display: block; image-rendering: pixelated;"></canvas>
                  <span style="font-size: 11px; color: #94A3B8;">1: 半睁</span>
                </div>
                <div class="anim-thumb-box" data-eye="2" style="text-align: center; cursor: pointer;">
                  <canvas width="64" height="64" id="thumb-eye-2" style="width: 64px; height: 64px; border: 1px solid #475569; border-radius: 4px; display: block; image-rendering: pixelated;"></canvas>
                  <span style="font-size: 11px; color: #94A3B8;">2: 完全闭合</span>
                </div>
              </div>
            </div>

            <div class="anim-section-card" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 12px;">
              <div style="font-weight: 600; font-size: 13px; margin-bottom: 8px; color: #F1F5F9;">💬 说话嘴型 3 帧序列 (Lip-sync Frames)</div>
              <div class="anim-thumbs-row" id="row-mouth-thumbs" style="display: flex; gap: 12px;">
                <!-- 0: 闭嘴, 1: 微张, 2: 大张 -->
                <div class="anim-thumb-box" data-mouth="0" style="text-align: center; cursor: pointer;">
                  <canvas width="64" height="64" id="thumb-mouth-0" style="width: 64px; height: 64px; border: 1px solid #475569; border-radius: 4px; display: block; image-rendering: pixelated;"></canvas>
                  <span style="font-size: 11px; color: #94A3B8;">0: 闭嘴</span>
                </div>
                <div class="anim-thumb-box" data-mouth="1" style="text-align: center; cursor: pointer;">
                  <canvas width="64" height="64" id="thumb-mouth-1" style="width: 64px; height: 64px; border: 1px solid #475569; border-radius: 4px; display: block; image-rendering: pixelated;"></canvas>
                  <span style="font-size: 11px; color: #94A3B8;">1: 微张说话</span>
                </div>
                <div class="anim-thumb-box" data-mouth="2" style="text-align: center; cursor: pointer;">
                  <canvas width="64" height="64" id="thumb-mouth-2" style="width: 64px; height: 64px; border: 1px solid #475569; border-radius: 4px; display: block; image-rendering: pixelated;"></canvas>
                  <span style="font-size: 11px; color: #94A3B8;">2: 开口发音</span>
                </div>
              </div>
            </div>

            <!-- 特征锚点与微调折叠面板 -->
            <div class="anim-section-card" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 12px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-weight: 600; font-size: 13px; color: #F1F5F9;">🎯 特征锚点与包围盒微调</span>
                <button class="btn btn-ghost btn-sm" id="btn-anim-reset-anchors" title="重新从面部与语义遮罩自动识别">🔄 重新检测</button>
              </div>
              <div class="anim-anchor-inputs" style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-size: 12px;">
                <div>
                  <span style="color: #94A3B8;">左眼 X:</span>
                  <input type="number" id="inp-left-eye-x" min="0" max="63" style="width: 100%;" class="input-sm">
                </div>
                <div>
                  <span style="color: #94A3B8;">右眼 X:</span>
                  <input type="number" id="inp-right-eye-x" min="0" max="63" style="width: 100%;" class="input-sm">
                </div>
                <div>
                  <span style="color: #94A3B8;">双眼 Y:</span>
                  <input type="number" id="inp-eye-y" min="0" max="63" style="width: 100%;" class="input-sm">
                </div>
                <div>
                  <span style="color: #94A3B8;">嘴部 X:</span>
                  <input type="number" id="inp-mouth-x" min="0" max="63" style="width: 100%;" class="input-sm">
                </div>
                <div>
                  <span style="color: #94A3B8;">嘴部 Y:</span>
                  <input type="number" id="inp-mouth-y" min="0" max="63" style="width: 100%;" class="input-sm">
                </div>
                <div style="display: flex; align-items: flex-end;">
                  <button class="btn btn-outline btn-sm" id="btn-anim-apply-anchors" style="width: 100%;">⚡ 立即重算</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 弹窗底栏：导出与关闭 -->
        <div class="confirm-modal-footer" style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 14px;">
          <div style="font-size: 12px; color: #94A3B8;">
            格式: 192×192 PNG (3×3 矩阵，标准 8-bit 透明图集)
          </div>
          <div style="display: flex; gap: 10px;">
            <button class="btn btn-outline" id="btn-export-meta-json" title="导出帧时间轴与切片配置 JSON">📄 导出引擎 JSON</button>
            <button class="btn btn-primary" id="btn-export-sheet-3x3" title="导出 3×3 全套 Sprite Sheet PNG">📦 导出 Sprite Sheet</button>
            <button class="btn btn-ghost" id="btn-anim-close">关闭</button>
          </div>
        </div>
      </div>
    `;

    this.container.appendChild(overlay);
    this.overlayEl = overlay;
  }

  private setupEvents(): void {
    if (!this.overlayEl) return;
    const q = <T extends Element>(sel: string) => this.overlayEl!.querySelector(sel) as T;

    // 关闭弹窗
    q<HTMLElement>('#anim-modal-close').addEventListener('click', () => this.close());
    q<HTMLElement>('#btn-anim-close').addEventListener('click', () => this.close());
    this.overlayEl.addEventListener('click', (e) => {
      if (e.target === this.overlayEl) this.close();
    });

    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    }, { signal: this.abortController.signal });

    // 播放/暂停
    const btnPlay = q<HTMLButtonElement>('#btn-anim-toggle-play');
    btnPlay.addEventListener('click', () => {
      if (!this.player) return;
      const playing = btnPlay.textContent?.includes('暂停');
      this.player.setPlaying(!playing);
      btnPlay.textContent = playing ? '▶ 播放' : '⏸ 暂停';
    });

    // 说话开关
    const chkTalking = q<HTMLInputElement>('#chk-anim-talking');
    chkTalking.addEventListener('change', () => {
      this.player?.setTalking(chkTalking.checked);
    });

    // 眨眼滑块
    const rngBlink = q<HTMLInputElement>('#rng-anim-blink');
    const txtBlink = q<HTMLElement>('#txt-anim-blink');
    rngBlink.addEventListener('input', () => {
      const val = parseFloat(rngBlink.value);
      txtBlink.textContent = `${val.toFixed(1)}s`;
      this.player?.setBlinkInterval(val);
    });

    // 缩略图点击静止预览
    const setupThumbClick = (id: string, eyeIdx: number, mouthIdx: number) => {
      q<HTMLElement>(id)?.addEventListener('click', () => {
        this.player?.selectStaticFrame(eyeIdx, mouthIdx);
        btnPlay.textContent = '▶ 播放';
      });
    };
    setupThumbClick('#thumb-eye-0', 0, 0);
    setupThumbClick('#thumb-eye-1', 1, 0);
    setupThumbClick('#thumb-eye-2', 2, 0);

    setupThumbClick('#thumb-mouth-0', 0, 0);
    setupThumbClick('#thumb-mouth-1', 0, 1);
    setupThumbClick('#thumb-mouth-2', 0, 2);

    // 锚点应用与重置
    q<HTMLElement>('#btn-anim-reset-anchors')?.addEventListener('click', () => {
      this.regenerateProject(true);
    });
    q<HTMLElement>('#btn-anim-apply-anchors')?.addEventListener('click', () => {
      this.applyAnchorInputs();
    });

    // 导出 Sprite Sheet
    q<HTMLElement>('#btn-export-sheet-3x3')?.addEventListener('click', async () => {
      if (!this.currentProject) return;
      try {
        await downloadMatrixSpriteSheet(this.currentProject, this.vm.doc.palette);
        this.vm.notify('🎉 成功导出 192×192 Sprite Sheet PNG！', 'success');
      } catch (err) {
        this.vm.notify('导出 Sprite Sheet 失败', 'error');
      }
    });

    // 导出引擎配置 JSON
    q<HTMLElement>('#btn-export-meta-json')?.addEventListener('click', () => {
      try {
        downloadEngineMetadataJson('matrix3x3');
        this.vm.notify('🎉 成功导出游戏引擎配置 JSON！', 'success');
      } catch (err) {
        this.vm.notify('导出 JSON 失败', 'error');
      }
    });
  }

  public open(): void {
    if (!this.vm.session.isLoaded) {
      this.vm.notify('请先载入或绘制肖像以开启生成器', 'warning');
      return;
    }
    if (!this.overlayEl) return;

    this.isOpen = true;
    this.overlayEl.style.display = 'flex';

    this.regenerateProject(true);

    const canvas = this.overlayEl.querySelector('#anim-player-canvas') as HTMLCanvasElement;
    if (canvas && this.currentProject) {
      if (this.player) this.player.destroy();
      this.player = new AnimationPlayer(canvas, this.currentProject, this.vm.doc.palette);
    }
  }

  public close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (this.overlayEl) this.overlayEl.style.display = 'none';
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
  }

  public getIsOpen(): boolean {
    return this.isOpen;
  }

  public dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;
    this.close();
    this.abortController.abort();
    this.overlayEl?.remove();
    this.overlayEl = null;
  }

  private regenerateProject(autoDetect = false): void {
    const doc = this.vm.doc;
    if (autoDetect || !this.anchors) {
      this.currentProject = createAnimationProject(doc);
      this.anchors = { ...this.currentProject.anchors };
    } else {
      this.currentProject = createAnimationProject(doc, this.anchors);
    }

    this.updateAnchorInputs();
    this.renderThumbnails();

    if (this.player && this.currentProject) {
      this.player.updateProject(this.currentProject, this.vm.doc.palette);
    }
  }

  private updateAnchorInputs(): void {
    if (!this.anchors || !this.overlayEl) return;
    const q = <T extends HTMLInputElement>(sel: string) => this.overlayEl!.querySelector(sel) as T;

    q('#inp-left-eye-x').value = String(Math.round((this.anchors.leftEyeBbox[0] + this.anchors.leftEyeBbox[2]) / 2));
    q('#inp-right-eye-x').value = String(Math.round((this.anchors.rightEyeBbox[0] + this.anchors.rightEyeBbox[2]) / 2));
    q('#inp-eye-y').value = String(Math.round(this.anchors.leftEyeBbox[1]));
    q('#inp-mouth-x').value = String(Math.round((this.anchors.mouthBbox[0] + this.anchors.mouthBbox[2]) / 2));
    q('#inp-mouth-y').value = String(Math.round(this.anchors.mouthBbox[1]));
  }

  private applyAnchorInputs(): void {
    if (!this.anchors || !this.overlayEl) return;
    const q = <T extends HTMLInputElement>(sel: string) => this.overlayEl!.querySelector(sel) as T;

    const lx = parseInt(q('#inp-left-eye-x').value, 10);
    const rx = parseInt(q('#inp-right-eye-x').value, 10);
    const ey = parseInt(q('#inp-eye-y').value, 10);
    const mx = parseInt(q('#inp-mouth-x').value, 10);
    const my = parseInt(q('#inp-mouth-y').value, 10);

    const lWidth = this.anchors.leftEyeBbox[2] - this.anchors.leftEyeBbox[0];
    const lHeight = this.anchors.leftEyeBbox[3] - this.anchors.leftEyeBbox[1];
    const rWidth = this.anchors.rightEyeBbox[2] - this.anchors.rightEyeBbox[0];
    const rHeight = this.anchors.rightEyeBbox[3] - this.anchors.rightEyeBbox[1];
    const mWidth = this.anchors.mouthBbox[2] - this.anchors.mouthBbox[0];
    const mHeight = this.anchors.mouthBbox[3] - this.anchors.mouthBbox[1];

    this.anchors.leftEyeBbox = [
      Math.max(0, Math.round(lx - lWidth / 2)),
      Math.max(0, ey),
      Math.min(63, Math.round(lx + lWidth / 2)),
      Math.min(63, ey + lHeight),
    ];

    this.anchors.rightEyeBbox = [
      Math.max(0, Math.round(rx - rWidth / 2)),
      Math.max(0, ey),
      Math.min(63, Math.round(rx + rWidth / 2)),
      Math.min(63, ey + rHeight),
    ];

    this.anchors.mouthBbox = [
      Math.max(0, Math.round(mx - mWidth / 2)),
      Math.max(0, my),
      Math.min(63, Math.round(mx + mWidth / 2)),
      Math.min(63, my + mHeight),
    ];

    this.regenerateProject(false);
    this.vm.notify('已依据调整后的锚点重新计算动画帧', 'info');
  }

  private renderThumbnails(): void {
    if (!this.currentProject || !this.overlayEl) return;
    const palette = this.vm.doc.palette;

    const drawThumb = (canvasId: string, pixels: Uint8Array) => {
      const canvas = this.overlayEl!.querySelector(canvasId) as HTMLCanvasElement;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, 64, 64);
      drawIndexedPixels(ctx, pixels, palette);
    };

    drawThumb('#thumb-eye-0', this.currentProject.eyeFrames.open);
    drawThumb('#thumb-eye-1', this.currentProject.eyeFrames.half);
    drawThumb('#thumb-eye-2', this.currentProject.eyeFrames.closed);

    drawThumb('#thumb-mouth-0', this.currentProject.mouthFrames.closed);
    drawThumb('#thumb-mouth-1', this.currentProject.mouthFrames.half);
    drawThumb('#thumb-mouth-2', this.currentProject.mouthFrames.open);
  }
}
