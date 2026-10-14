/**
 * 动画实时预览播放器 (RAF 驱动，自然眨眼周期 + 说话嘴型切换)
 */

import { AnimationProject } from '../../core/animation/types';
import { drawIndexedPixels } from '../../app/browser/pixelCanvas';

export class AnimationPlayer {
  private isPlaying = true;
  private isTalking = true;
  private blinkIntervalMs = 3500;
  private talkStepMs = 100;

  private lastBlinkStartTime = 0;
  private lastTalkStepTime = 0;
  private talkFrameSequence = [0, 1, 2, 1];
  private talkSeqIndex = 0;

  private currentEyeIndex = 0;
  private currentMouthIndex = 0;
  private rafId: number | null = null;
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D;

  constructor(
    private readonly previewCanvas: HTMLCanvasElement,
    private project: AnimationProject,
    private palette: string[]
  ) {
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = 64;
    this.offscreenCanvas.height = 64;
    this.offscreenCtx = this.offscreenCanvas.getContext('2d')!;

    this.start();
  }

  public updateProject(project: AnimationProject, palette: string[]): void {
    this.project = project;
    this.palette = palette;
    this.renderCurrentFrame();
  }

  public setPlaying(playing: boolean): void {
    this.isPlaying = playing;
    if (playing) {
      this.lastBlinkStartTime = performance.now();
      this.lastTalkStepTime = performance.now();
    }
  }

  public setTalking(talking: boolean): void {
    this.isTalking = talking;
    if (!talking) {
      this.currentMouthIndex = 0;
      this.renderCurrentFrame();
    }
  }

  public setBlinkInterval(seconds: number): void {
    this.blinkIntervalMs = Math.max(1000, seconds * 1000);
  }

  public selectStaticFrame(eyeIdx: number, mouthIdx: number): void {
    this.isPlaying = false;
    this.currentEyeIndex = Math.max(0, Math.min(2, eyeIdx));
    this.currentMouthIndex = Math.max(0, Math.min(2, mouthIdx));
    this.renderCurrentFrame();
  }

  public start(): void {
    if (this.rafId !== null) return;
    this.lastBlinkStartTime = performance.now();
    this.lastTalkStepTime = performance.now();

    const loop = (timestamp: number) => {
      if (this.isPlaying) {
        this.updateAnimation(timestamp);
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  public stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private updateAnimation(timestamp: number): void {
    let changed = false;

    // 1. 眨眼节律调度
    const timeSinceBlink = timestamp - this.lastBlinkStartTime;
    if (timeSinceBlink >= this.blinkIntervalMs) {
      // 触发新眨眼
      this.lastBlinkStartTime = timestamp;
    }

    const elapsedBlink = timestamp - this.lastBlinkStartTime;
    let nextEye = 0;
    if (elapsedBlink < 60) {
      nextEye = 1; // half
    } else if (elapsedBlink < 200) {
      nextEye = 2; // closed
    } else if (elapsedBlink < 260) {
      nextEye = 1; // half
    } else {
      nextEye = 0; // open
    }

    if (nextEye !== this.currentEyeIndex) {
      this.currentEyeIndex = nextEye;
      changed = true;
    }

    // 2. 说话嘴型调度
    if (this.isTalking) {
      if (timestamp - this.lastTalkStepTime >= this.talkStepMs) {
        this.lastTalkStepTime = timestamp;
        this.talkSeqIndex = (this.talkSeqIndex + 1) % this.talkFrameSequence.length;
        const nextMouth = this.talkFrameSequence[this.talkSeqIndex];
        if (nextMouth !== this.currentMouthIndex) {
          this.currentMouthIndex = nextMouth;
          changed = true;
        }
      }
    } else if (this.currentMouthIndex !== 0) {
      this.currentMouthIndex = 0;
      changed = true;
    }

    if (changed) {
      this.renderCurrentFrame();
    }
  }

  public renderCurrentFrame(): void {
    const pixels = this.project.matrix[this.currentEyeIndex][this.currentMouthIndex];
    if (!pixels) return;

    this.offscreenCtx.clearRect(0, 0, 64, 64);
    drawIndexedPixels(this.offscreenCtx, pixels, this.palette);

    const ctx = this.previewCanvas.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
    ctx.drawImage(this.offscreenCanvas, 0, 0, this.previewCanvas.width, this.previewCanvas.height);
  }

  public destroy(): void {
    this.stop();
  }
}
