/**
 * 画布上方的浮动上下文工具条 (仅像素模式)：
 * 有选区 → 尺寸 + 翻转/旋转/替换色/取消；正在框选 → 实时尺寸；
 * 选区工具 → 操作提示；油漆桶 → 8/4 连通切换；其它工具 → 隐藏。
 *
 * 同一形态下只更新文字/状态而不重建 DOM，避免拖拽中按钮闪烁。
 */

import { RectSelection } from '../../types';
import { EditorSession } from '../../model/session';

interface ContextBarCallbacks {
  onFlipHorizontal: () => void;
  onFlipVertical: () => void;
  onRotateCW: () => void;
  onOpenReplaceColor: () => void;
  onCancelSelection: () => void;
  onSetBucketConnectivity: (connectivity: 4 | 8) => void;
}

export class ContextBar {
  constructor(private el: HTMLElement, callbacks: ContextBarCallbacks) {
    const actions: Record<string, () => void> = {
      'btn-flip-h': callbacks.onFlipHorizontal,
      'btn-flip-v': callbacks.onFlipVertical,
      'btn-rotate-cw': callbacks.onRotateCW,
      'btn-replace-selection-color': callbacks.onOpenReplaceColor,
      'btn-cancel-selection': callbacks.onCancelSelection,
      'btn-floating-conn-8': () => callbacks.onSetBucketConnectivity(8),
      'btn-floating-conn-4': () => callbacks.onSetBucketConnectivity(4),
    };

    // 阻止事件穿透到下方画布，避免误绘制
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const button = (e.target as HTMLElement).closest('button');
      if (button) actions[button.id]?.();
    });
  }

  /** boxSelecting：正在拖拽中的框选矩形 (尚未成为选区) */
  public update(state: EditorSession, selection: RectSelection | null, boxSelecting: RectSelection | null): void {
    if (!state.isLoaded || state.activeMode !== 'pixel') return this.hide();

    if (selection) {
      const label = `选区: ${selection.w}×${selection.h}`;
      const badge = this.el.querySelector('#selection-status-badge');
      if (badge && this.el.querySelector('#btn-flip-h')) {
        badge.textContent = label;
      } else {
        this.show(`
          <div class="floating-context-group">
            <span class="selection-status-badge" id="selection-status-badge">${label}</span>
            <div class="floating-btn-group">
              <button class="tool-btn btn-xs" id="btn-flip-h" title="水平翻转选区 (快捷键: Shift+H)">↔ 水平翻转</button>
              <button class="tool-btn btn-xs" id="btn-flip-v" title="垂直翻转选区 (快捷键: Shift+V)">↕ 垂直翻转</button>
              <button class="tool-btn btn-xs" id="btn-rotate-cw" title="顺时针旋转90° (快捷键: Shift+T)">↻ 旋转90°</button>
              <button class="tool-btn btn-xs btn-replace-selection" id="btn-replace-selection-color" title="选区内颜色替换 (快捷键: Shift+R)">🔄 替换颜色</button>
              <button class="tool-btn btn-xs" id="btn-cancel-selection" title="取消选区 (快捷键: Esc 或 Ctrl+D)">✕ 取消</button>
            </div>
          </div>
        `);
      }
      return;
    }

    if (boxSelecting) {
      const label = `选区: ${boxSelecting.w}×${boxSelecting.h}`;
      const badge = this.el.querySelector('#box-select-badge');
      if (badge) {
        badge.textContent = label;
      } else {
        this.show(`
          <div class="floating-context-group">
            <span class="selection-status-badge" id="box-select-badge">${label}</span>
            <span class="floating-help-tip">松开鼠标完成框选 · 单击取消选区</span>
          </div>
        `);
      }
      return;
    }

    if (state.activeTool === 'select') {
      if (!this.el.querySelector('#select-tool-badge')) {
        this.show(`
          <div class="floating-context-group">
            <span class="floating-tool-badge" id="select-tool-badge">⬚ 矩形选区</span>
            <span class="floating-help-tip">在画布上拖拽框选矩形 · 选区内拖拽平移 (按住 Ctrl 复制)</span>
          </div>
        `);
      }
      this.el.style.display = 'inline-flex';
      return;
    }

    if (state.activeTool === 'bucket') {
      const conn = state.bucketConnectivity;
      const conn8Btn = this.el.querySelector('#btn-floating-conn-8');
      const conn4Btn = this.el.querySelector('#btn-floating-conn-4');
      if (conn8Btn && conn4Btn) {
        conn8Btn.className = `connectivity-pill-btn ${conn === 8 ? 'active' : ''}`;
        conn4Btn.className = `connectivity-pill-btn ${conn === 4 ? 'active' : ''}`;
        this.el.style.display = 'inline-flex';
      } else {
        this.show(`
          <div class="floating-context-group">
            <span class="floating-tool-badge">🪣 油漆桶连通域</span>
            <div class="floating-pills-group">
              <button class="connectivity-pill-btn ${conn === 8 ? 'active' : ''}" id="btn-floating-conn-8" title="8 邻居连通 (默认：横、竖、对角线全部连通)">
                <span class="pill-dot">●</span> 8 邻居 (默认)
              </button>
              <button class="connectivity-pill-btn ${conn === 4 ? 'active' : ''}" id="btn-floating-conn-4" title="4 邻居连通 (仅十字四向，不穿透对角单像素描边)">
                <span class="pill-dot">●</span> 4 邻居 (十字)
              </button>
            </div>
            <span class="floating-help-tip">Shift+点击可全图同色替换</span>
          </div>
        `);
      }
      return;
    }

    this.hide();
  }

  private show(html: string): void {
    this.el.innerHTML = html;
    this.el.style.display = 'inline-flex';
  }

  private hide(): void {
    this.el.style.display = 'none';
    this.el.innerHTML = '';
  }
}
