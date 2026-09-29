/**
 * 颜色替换对话框 (Shift+R)：选择原颜色 / 新颜色与作用范围 (选区或整张画布)
 */

import { StudioState, RectSelection } from '../types';
import { TRANSPARENT_INDEX, PALETTE_FAMILIES } from '../data/palette';

interface ReplaceColorModalCallbacks {
  onConfirm: (fromIdx: number, toIdx: number, scope: 'selection' | 'all') => void;
}

export class ReplaceColorModal {
  private container: HTMLElement;
  private callbacks: ReplaceColorModalCallbacks;

  // DOM 元素
  private overlayEl: HTMLElement | null = null;
  private fromPreviewEl: HTMLElement | null = null;
  private fromLabelEl: HTMLElement | null = null;
  private toPreviewEl: HTMLElement | null = null;
  private toLabelEl: HTMLElement | null = null;
  private scopeSelectionRadio: HTMLInputElement | null = null;
  private scopeSelectionLabel: HTMLElement | null = null;
  private scopeAllRadio: HTMLInputElement | null = null;
  private miniPaletteGridEl: HTMLElement | null = null;
  private btnConfirm: HTMLButtonElement | null = null;

  // 内部状态
  private isOpen = false;
  private fromIndex = 0;
  private toIndex = 0;
  private activePickingSlot: 'from' | 'to' = 'from';
  private currentScope: 'selection' | 'all' = 'selection';
  private currentState: StudioState | null = null;

  constructor(container: HTMLElement, callbacks: ReplaceColorModalCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
    this.setupEvents();
  }

  private render(): void {
    const overlay = document.createElement('div');
    overlay.className = 'replace-modal-overlay';
    overlay.id = 'replace-color-modal-overlay';
    overlay.style.display = 'none';

    overlay.innerHTML = `
      <div class="replace-modal-card" id="replace-color-modal-card" role="dialog" aria-modal="true">
        <div class="replace-modal-header">
          <div class="modal-title-group">
            <span class="modal-title-icon">🔄</span>
            <span class="modal-title-text">颜色替换 (Replace Color)</span>
          </div>
          <button class="modal-close-btn" id="btn-close-replace-modal" title="关闭 (Esc)">✕</button>
        </div>

        <div class="replace-modal-body">
          <!-- From / To 颜色选择区域 -->
          <div class="replace-slots-row">
            <!-- From 槽位 -->
            <div class="replace-slot-box active" id="slot-box-from" title="点击后在下方色板中选择原颜色 (From)">
              <div class="slot-box-header">
                <span class="slot-tag">原颜色 (From)</span>
                <span class="slot-active-dot">● 选取中</span>
              </div>
              <div class="slot-box-content">
                <div class="slot-chip-preview" id="replace-from-preview"></div>
                <div class="slot-chip-desc">
                  <span class="slot-name" id="replace-from-label">#000000 [#0]</span>
                  <span class="slot-sub">待替换的目标像素</span>
                </div>
              </div>
            </div>

            <!-- 互换按钮 -->
            <button class="btn-swap-replace-slots" id="btn-swap-replace-slots" title="交换原颜色与新颜色 (⇄)">⇄</button>

            <!-- To 槽位 -->
            <div class="replace-slot-box" id="slot-box-to" title="点击后在下方色板中选择新颜色 (To)">
              <div class="slot-box-header">
                <span class="slot-tag">替换为 (To)</span>
                <span class="slot-active-dot">● 选取中</span>
              </div>
              <div class="slot-box-content">
                <div class="slot-chip-preview" id="replace-to-preview"></div>
                <div class="slot-chip-desc">
                  <span class="slot-name" id="replace-to-label">#FFFFFF [#1]</span>
                  <span class="slot-sub">替换后的新颜色</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 快速选色迷你色板 (36 色 + 基础透明色) -->
          <div class="replace-palette-picker">
            <div class="replace-palette-header">
              <span class="palette-picker-tip" id="replace-picker-tip">👉 点击色块设定【原颜色 From】：</span>
            </div>
            <div class="replace-mini-palette" id="replace-mini-palette"></div>
          </div>

          <!-- 作用范围单选 -->
          <div class="replace-scope-section">
            <span class="scope-label">作用范围:</span>
            <div class="scope-options">
              <label class="scope-radio-label" id="label-scope-selection">
                <input type="radio" name="replace-scope" value="selection" id="radio-scope-selection" checked>
                <span class="radio-custom"></span>
                <span class="scope-text" id="text-scope-selection">仅当前选区 (0×0)</span>
              </label>
              <label class="scope-radio-label" id="label-scope-all">
                <input type="radio" name="replace-scope" value="all" id="radio-scope-all">
                <span class="radio-custom"></span>
                <span class="scope-text">整张画布 (64×64)</span>
              </label>
            </div>
          </div>
        </div>

        <div class="replace-modal-footer">
          <span class="footer-shortcut-hint">按 <b>Enter</b> 执行替换 · <b>Esc</b> 取消</span>
          <div class="footer-buttons">
            <button class="btn btn-outline btn-sm" id="btn-cancel-replace">取消 (Esc)</button>
            <button class="btn btn-primary btn-sm" id="btn-confirm-replace">确定替换 (Enter)</button>
          </div>
        </div>
      </div>
    `;

    this.container.appendChild(overlay);
    this.overlayEl = overlay;
    this.fromPreviewEl = overlay.querySelector('#replace-from-preview');
    this.fromLabelEl = overlay.querySelector('#replace-from-label');
    this.toPreviewEl = overlay.querySelector('#replace-to-preview');
    this.toLabelEl = overlay.querySelector('#replace-to-label');
    this.scopeSelectionRadio = overlay.querySelector('#radio-scope-selection');
    this.scopeSelectionLabel = overlay.querySelector('#text-scope-selection');
    this.scopeAllRadio = overlay.querySelector('#radio-scope-all');
    this.miniPaletteGridEl = overlay.querySelector('#replace-mini-palette');
    this.btnConfirm = overlay.querySelector('#btn-confirm-replace');
  }

  private setupEvents(): void {
    if (!this.overlayEl) return;

    // 点击遮罩外部关闭
    this.overlayEl.addEventListener('mousedown', (e) => {
      if (e.target === this.overlayEl) {
        this.close();
      }
    });

    // 关闭按钮与取消按钮
    this.overlayEl.querySelector('#btn-close-replace-modal')?.addEventListener('click', () => this.close());
    this.overlayEl.querySelector('#btn-cancel-replace')?.addEventListener('click', () => this.close());

    // 确认按钮
    this.btnConfirm?.addEventListener('click', () => this.confirm());

    // 槽位选择切换 (点击设置哪个槽位在被挑选)
    const slotFrom = this.overlayEl.querySelector('#slot-box-from');
    const slotTo = this.overlayEl.querySelector('#slot-box-to');
    slotFrom?.addEventListener('click', () => this.setActiveSlot('from'));
    slotTo?.addEventListener('click', () => this.setActiveSlot('to'));

    // 互换按钮
    this.overlayEl.querySelector('#btn-swap-replace-slots')?.addEventListener('click', () => {
      const temp = this.fromIndex;
      this.fromIndex = this.toIndex;
      this.toIndex = temp;
      this.updateSlotPreviews();
    });

    // 作用范围变更
    this.scopeSelectionRadio?.addEventListener('change', () => {
      if (this.scopeSelectionRadio?.checked) {
        this.currentScope = 'selection';
      }
    });
    this.scopeAllRadio?.addEventListener('change', () => {
      if (this.scopeAllRadio?.checked) {
        this.currentScope = 'all';
      }
    });

    // 键盘监听 (Enter 确定，Escape 关闭，打开期间阻断其余快捷键向底层冒泡)
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this.confirm();
        return;
      }

      // 阻断所有快捷键冒泡到底层画布监听器，防止误触发画笔切换、选区删除等
      e.stopPropagation();
    }, true);
  }

  private setActiveSlot(slot: 'from' | 'to'): void {
    this.activePickingSlot = slot;
    const slotFrom = this.overlayEl?.querySelector('#slot-box-from');
    const slotTo = this.overlayEl?.querySelector('#slot-box-to');
    const tipEl = this.overlayEl?.querySelector('#replace-picker-tip');

    if (slot === 'from') {
      slotFrom?.classList.add('active');
      slotTo?.classList.remove('active');
      if (tipEl) tipEl.textContent = '👉 点击色块设定【原颜色 From】：';
    } else {
      slotFrom?.classList.remove('active');
      slotTo?.classList.add('active');
      if (tipEl) tipEl.textContent = '👉 点击色块设定【新颜色 To】：';
    }
    this.updateMiniPaletteActiveState();
  }

  public open(state: StudioState, selection: RectSelection | null): void {
    this.currentState = state;
    this.isOpen = true;

    // 默认 From 为当前背景色 (右键色)；To 为当前前景色 (左键色)
    this.fromIndex = state.bgPaletteIndex;
    this.toIndex = state.activePaletteIndex;

    // 范围默认：若有选区则默认选区，无选区则整张画布
    const hasSel = selection !== null;
    this.currentScope = hasSel ? 'selection' : 'all';

    if (this.scopeSelectionRadio) {
      this.scopeSelectionRadio.disabled = !hasSel;
      this.scopeSelectionRadio.checked = hasSel;
    }
    if (this.scopeAllRadio) {
      this.scopeAllRadio.checked = !hasSel;
    }
    if (this.scopeSelectionLabel) {
      if (hasSel) {
        this.scopeSelectionLabel.textContent = `仅当前选区 (${selection.w}×${selection.h})`;
      } else {
        this.scopeSelectionLabel.textContent = `仅当前选区 (当前无选区)`;
      }
    }

    const labelSelectionWrapper = this.overlayEl?.querySelector('#label-scope-selection');
    if (labelSelectionWrapper) {
      labelSelectionWrapper.classList.toggle('disabled', !hasSel);
    }

    this.setActiveSlot('from');
    this.buildMiniPalette();
    this.updateSlotPreviews();

    if (this.overlayEl) {
      this.overlayEl.style.display = 'flex';
    }
  }

  public close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (this.overlayEl) {
      this.overlayEl.style.display = 'none';
    }
  }

  public getIsOpen(): boolean {
    return this.isOpen;
  }

  private confirm(): void {
    const scope = this.currentScope;
    this.callbacks.onConfirm(this.fromIndex, this.toIndex, scope);
    this.close();
  }

  private updateSlotPreviews(): void {
    if (!this.currentState) return;
    const palette = this.currentState.palette;

    // 1. From 预览
    const isFromTrans = this.fromIndex === TRANSPARENT_INDEX;
    const fromHex = isFromTrans ? '透明' : (palette[this.fromIndex] || '#000000');
    if (this.fromPreviewEl) {
      if (isFromTrans) {
        this.fromPreviewEl.className = 'slot-chip-preview slot-transparent';
        this.fromPreviewEl.style.backgroundColor = '';
      } else {
        this.fromPreviewEl.className = 'slot-chip-preview';
        this.fromPreviewEl.style.backgroundColor = fromHex;
      }
    }
    if (this.fromLabelEl) {
      this.fromLabelEl.textContent = isFromTrans ? '[透明/空白]' : `${fromHex} [#${this.fromIndex}]`;
    }

    // 2. To 预览
    const isToTrans = this.toIndex === TRANSPARENT_INDEX;
    const toHex = isToTrans ? '透明' : (palette[this.toIndex] || '#FFFFFF');
    if (this.toPreviewEl) {
      if (isToTrans) {
        this.toPreviewEl.className = 'slot-chip-preview slot-transparent';
        this.toPreviewEl.style.backgroundColor = '';
      } else {
        this.toPreviewEl.className = 'slot-chip-preview';
        this.toPreviewEl.style.backgroundColor = toHex;
      }
    }
    if (this.toLabelEl) {
      this.toLabelEl.textContent = isToTrans ? '[透明/删除]' : `${toHex} [#${this.toIndex}]`;
    }

    this.updateMiniPaletteActiveState();
  }

  private buildMiniPalette(): void {
    if (!this.miniPaletteGridEl || !this.currentState) return;
    this.miniPaletteGridEl.innerHTML = '';

    const palette = this.currentState.palette;

    PALETTE_FAMILIES.forEach((family) => {
      const famGroup = document.createElement('div');
      famGroup.className = 'mini-palette-family-group';

      family.indices.forEach((idx) => {
        const chip = document.createElement('button');
        const isTrans = idx === TRANSPARENT_INDEX;
        const hex = isTrans ? '' : (palette[idx] || '#000000');

        chip.className = `mini-chip ${isTrans ? 'chip-transparent' : ''}`;
        chip.setAttribute('data-index', String(idx));
        if (!isTrans) {
          chip.style.backgroundColor = hex;
        }

        const label = isTrans ? '透' : String(idx);
        chip.innerHTML = `<span class="mini-chip-idx">${label}</span>`;
        chip.title = isTrans ? '透明色 (255)' : `#${idx}: ${hex}`;

        chip.addEventListener('click', (e) => {
          e.preventDefault();
          if (this.activePickingSlot === 'from') {
            this.fromIndex = idx;
            // 选完原色后，自动切到新色槽位
            this.setActiveSlot('to');
          } else {
            this.toIndex = idx;
          }
          this.updateSlotPreviews();
        });

        famGroup.appendChild(chip);
      });

      this.miniPaletteGridEl?.appendChild(famGroup);
    });
  }

  private updateMiniPaletteActiveState(): void {
    if (!this.miniPaletteGridEl) return;
    const activeTargetIdx = this.activePickingSlot === 'from' ? this.fromIndex : this.toIndex;
    const chips = this.miniPaletteGridEl.querySelectorAll('.mini-chip');

    chips.forEach((c) => {
      const idx = parseInt(c.getAttribute('data-index') || '-1', 10);
      c.classList.toggle('selected', idx === activeTargetIdx);
    });
  }
}
