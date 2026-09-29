/**
 * ImageGem PalettePanel Component (左列：色板与修图工具)
 * 专注 36 色按色系排布展示、白色独立作为背景色/橡皮擦、颜色微调、修图画笔/橡皮/吸管、撤销/重做、语义遮罩重新识别
 */

import { StudioState } from '../types';
import { PALETTE_FAMILIES, WHITE_PALETTE_INDEX, TRANSPARENT_INDEX, RAMPS_INFO, TIER_NAMES } from '../data/palette';
import { findNearestColor } from '../core/colorUtils';

export interface PalettePanelCallbacks {
  onSelectPaletteColor: (index: number) => void;
  onSelectBgColor: (index: number) => void;
  onSwapFgBg: () => void;
  onModifyPaletteColor: (index: number, newHex: string) => void;
  onBeforePaletteModify?: () => void;
  onResetActiveColor: () => void;
  onResetAllPalette: () => void;
  onSelectTool: (tool: 'pen' | 'eraser' | 'bucket' | 'eyedropper' | 'select') => void;
  onSetBucketConnectivity: (conn: 8 | 4) => void;
  onUndo: () => void;
  onRedo: () => void;
  onActivate: () => void;
  onSelectHairRamp?: (presetKey: string) => void;
  onHighlightPaletteColor?: (index: number | null) => void;
}

export class PalettePanel {
  private container: HTMLElement;
  private callbacks: PalettePanelCallbacks;
  private currentState: StudioState | null = null;
  private selectedHairRampKey: string = '01_black_黑';

  constructor(container: HTMLElement, callbacks: PalettePanelCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
  }

  private render(): void {
    const rampOptions = Object.entries(RAMPS_INFO)
      .map(([key, info]) => `<option value="${key}">${info.icon} ${info.name}</option>`)
      .join('');

    this.container.innerHTML = `
      <aside class="column-sidebar palette-sidebar-inner">
        <div class="panel-section">
          <!-- 标题与状态反馈 -->
          <div class="section-header">
            <div class="section-title-group">
              <span class="section-title">🎨 色板修图</span>
              <span class="panel-active-badge" id="palette-active-badge">● 绘制中</span>
            </div>
            <div class="history-actions">
              <button class="btn-icon-sm" id="btn-undo" title="撤销 (Ctrl+Z)">↩️</button>
              <button class="btn-icon-sm" id="btn-redo" title="重做 (Ctrl+Y)">↪️</button>
            </div>
          </div>

          <!-- 工具选择 (画笔 / 橡皮擦 / 油漆桶 / 吸管 / 矩形选区: 3 + 2 紧凑布局) -->
          <div class="tool-picker-group">
            <button class="tool-tab-btn active" id="btn-tool-pen" title="画笔工具 (快捷键: P)">
              <span class="tool-btn-icon">✏️</span>
              <span class="tool-btn-label">画笔</span>
              <kbd class="tool-btn-kbd">P</kbd>
            </button>
            <button class="tool-tab-btn" id="btn-tool-eraser" title="橡皮擦 / 原生透明删除 (快捷键: E)">
              <span class="tool-btn-icon">🧼</span>
              <span class="tool-btn-label">橡皮</span>
              <kbd class="tool-btn-kbd">E</kbd>
            </button>
            <button class="tool-tab-btn" id="btn-tool-bucket" title="油漆桶工具 (快捷键: B / F，单点填充同色相邻区域)">
              <span class="tool-btn-icon">🪣</span>
              <span class="tool-btn-label">油漆桶</span>
              <kbd class="tool-btn-kbd">B</kbd>
            </button>
            <button class="tool-tab-btn btn-span-half" id="btn-tool-eyedropper" title="吸管取色 (快捷键: I，画布 Alt+点击)">
              <span class="tool-btn-icon">🧪</span>
              <span class="tool-btn-label">吸管</span>
              <kbd class="tool-btn-kbd">I</kbd>
            </button>
            <button class="tool-tab-btn btn-span-half" id="btn-tool-select" title="矩形选区 (快捷键: M / S，框选平移，Ctrl 复制)">
              <span class="tool-btn-icon">⬚</span>
              <span class="tool-btn-label">选区</span>
              <kbd class="tool-btn-kbd">M</kbd>
            </button>
          </div>

          <!-- 油漆桶邻域连通选项 (默认 8 邻居，可选 4 邻居) -->
          <div class="bucket-connectivity-panel" id="bucket-connectivity-panel" style="display: none;">
            <div class="connectivity-header">
              <span class="connectivity-title">🪣 油漆桶连通邻域:</span>
              <span class="connectivity-tip" id="connectivity-tip">8 邻居 (含对角线)</span>
            </div>
            <div class="connectivity-pills">
              <button class="connectivity-pill-btn active" id="btn-conn-8" title="8 邻居连通 (默认：横、竖、对角线全部连通，适合二次元大块发色填充)">
                <span class="pill-dot">●</span> 8 邻居 (默认)
              </button>
              <button class="connectivity-pill-btn" id="btn-conn-4" title="4 邻居连通 (仅十字四向，不会穿透对角单像素描边)">
                <span class="pill-dot">●</span> 4 邻居 (十字)
              </button>
            </div>
          </div>

          <!-- 前景色与背景色展示区 (Aseprite 规范：左键前景色、右键背景色、X 键交换) -->
          <div class="palette-header-fgbg">
            <div class="fgbg-container">
              <div class="color-slot fg-slot" id="fg-color-slot" title="前景色 (鼠标左键绘制 / 色块左键选用 / Alt+左键吸取)">
                <span class="color-slot-preview" id="fg-color-preview" style="background-color: #000000;"></span>
                <div class="color-slot-info">
                  <span class="slot-title">前景色 (左键)</span>
                  <span class="slot-hex" id="fg-color-hex">#000000 [#0]</span>
                </div>
              </div>

              <button class="btn-swap-fgbg" id="btn-swap-fgbg" title="交换前景色与背景色 (快捷键: X)">⇄</button>

              <div class="color-slot bg-slot" id="bg-color-slot" title="背景色 (鼠标右键绘制 / 色块右键选用 / Alt+右键吸取)">
                <span class="color-slot-preview" id="bg-color-preview" style="background-color: #FFFFFF;"></span>
                <div class="color-slot-info">
                  <span class="slot-title">背景色 (右键)</span>
                  <span class="slot-hex" id="bg-color-hex">#FFFFFF [#1]</span>
                </div>
              </div>
            </div>
            <input type="color" id="palette-color-picker" title="点击微调当前色块颜色" style="display:none;">
          </div>

          <!-- 💇 独立发色卡区 (Hair Color Ramp: 下拉选择 9 大发色系 + 5 阶颜色行) -->
          <div class="hair-ramp-section">
            <div class="hair-ramp-header">
              <div class="hair-ramp-title-group">
                <span class="hair-ramp-title">💇 发色卡</span>
                <span class="hair-ramp-tier-hint">(5色阶)</span>
              </div>
              <div class="hair-ramp-select-wrap">
                <select id="hair-ramp-select" class="hair-ramp-select" title="切换发色系列 (与右栏 9 色系对齐)">
                  ${rampOptions}
                </select>
              </div>
            </div>
            <div class="hair-ramp-chips" id="hair-ramp-chips">
              <!-- 5 个发色卡片动态注入 -->
            </div>
          </div>

          <!-- 全色板分界提示与操作按钮 (微调/还原/重置属于全色板操作) -->
          <div class="palette-section-divider">
            <span class="sub-label">🎨 全色板 (36色 按色系)</span>
          </div>

          <div class="palette-actions-row">
            <button class="btn-xs btn-outline" id="btn-edit-active-color" title="微调当前前景色 Hex 颜色">🎨 微调</button>
            <button class="btn-xs btn-outline" id="btn-reset-active-color" title="还原当前选中色块为默认值">↺ 还原色</button>
            <button class="btn-xs btn-outline" id="btn-reset-all-palette" title="重置全部 36 色板为默认值">恢复默认36色</button>
          </div>

          <!-- 36 色按色系分类栅格 (黑白基础双色独立首排，左键选前景色，右键选背景色) -->
          <div class="palette-families-container" id="palette-families-container">
            <!-- 各色系行动态注入 -->
          </div>
        </div>
      </aside>
    `;

    this.setupEvents();
  }

  private setupEvents(): void {
    // 画笔
    const penBtn = this.container.querySelector('#btn-tool-pen');
    penBtn?.addEventListener('click', () => {
      this.callbacks.onActivate();
      this.callbacks.onSelectTool('pen');
    });

    // 橡皮擦
    const eraserBtn = this.container.querySelector('#btn-tool-eraser');
    eraserBtn?.addEventListener('click', () => {
      this.callbacks.onActivate();
      this.callbacks.onSelectTool('eraser');
    });

    // 油漆桶
    const bucketBtn = this.container.querySelector('#btn-tool-bucket');
    bucketBtn?.addEventListener('click', () => {
      this.callbacks.onActivate();
      this.callbacks.onSelectTool('bucket');
    });

    // 油漆桶邻域连通性切换
    const conn8Btn = this.container.querySelector('#btn-conn-8');
    conn8Btn?.addEventListener('click', () => {
      this.callbacks.onSetBucketConnectivity(8);
    });

    const conn4Btn = this.container.querySelector('#btn-conn-4');
    conn4Btn?.addEventListener('click', () => {
      this.callbacks.onSetBucketConnectivity(4);
    });

    // 交换前景色与背景色
    const swapBtn = this.container.querySelector('#btn-swap-fgbg');
    swapBtn?.addEventListener('click', () => {
      this.callbacks.onSwapFgBg();
    });

    // 吸管
    const eyeBtn = this.container.querySelector('#btn-tool-eyedropper');
    eyeBtn?.addEventListener('click', () => {
      this.callbacks.onActivate();
      this.callbacks.onSelectTool('eyedropper');
    });

    // 矩形选区工具
    const selectBtn = this.container.querySelector('#btn-tool-select');
    selectBtn?.addEventListener('click', () => {
      this.callbacks.onActivate();
      this.callbacks.onSelectTool('select');
    });

    // 撤销 / 重做
    this.container.querySelector('#btn-undo')?.addEventListener('click', () => this.callbacks.onUndo());
    this.container.querySelector('#btn-redo')?.addEventListener('click', () => this.callbacks.onRedo());

    // 颜色微调
    const colorPickerInput = this.container.querySelector('#palette-color-picker') as HTMLInputElement;
    const editColorBtn = this.container.querySelector('#btn-edit-active-color');
    let isAdjustingColor = false;

    editColorBtn?.addEventListener('click', () => {
      if (!this.currentState) return;
      if (this.currentState.activePaletteIndex === TRANSPARENT_INDEX) return;
      colorPickerInput.value = this.currentState.palette[this.currentState.activePaletteIndex] || '#000000';
      isAdjustingColor = false;
      colorPickerInput.click();
    });

    colorPickerInput?.addEventListener('input', (e) => {
      if (!this.currentState) return;
      if (this.currentState.activePaletteIndex === TRANSPARENT_INDEX) return;
      if (!isAdjustingColor) {
        isAdjustingColor = true;
        this.callbacks.onBeforePaletteModify?.();
      }
      const val = (e.target as HTMLInputElement).value.toUpperCase();
      this.callbacks.onModifyPaletteColor(this.currentState.activePaletteIndex, val);
    });

    colorPickerInput?.addEventListener('change', () => {
      isAdjustingColor = false;
    });

    this.container.querySelector('#btn-reset-active-color')?.addEventListener('click', () => {
      this.callbacks.onResetActiveColor();
    });

    this.container.querySelector('#btn-reset-all-palette')?.addEventListener('click', () => {
      if (confirm('确定要将全部色板恢复为默认的 GBA 36 色板吗？')) {
        this.callbacks.onResetAllPalette();
      }
    });

    // 发色系下拉菜单切换 (与右侧 9 大发色系对齐)
    const hairRampSelect = this.container.querySelector('#hair-ramp-select') as HTMLSelectElement | null;
    hairRampSelect?.addEventListener('change', () => {
      this.selectedHairRampKey = hairRampSelect.value;
      this.callbacks.onSelectHairRamp?.(this.selectedHairRampKey);
      this.renderHairRampChips();
    });

    // 36 色色板悬停通用色彩探针高亮 (全画布高亮对应颜色)
    const familiesContainer = this.container.querySelector('#palette-families-container');
    familiesContainer?.addEventListener('mouseover', (e) => {
      const chip = (e.target as HTMLElement).closest('.palette-chip') as HTMLElement | null;
      if (chip) {
        const idxStr = chip.getAttribute('data-index');
        if (idxStr !== null) {
          const idx = parseInt(idxStr, 10);
          if (!isNaN(idx)) {
            this.callbacks.onHighlightPaletteColor?.(idx);
            return;
          }
        }
      }
      this.callbacks.onHighlightPaletteColor?.(null);
    });
    familiesContainer?.addEventListener('mouseleave', () => {
      this.callbacks.onHighlightPaletteColor?.(null);
    });

    // 独立发色卡 5 阶悬停通用色彩探针高亮
    const hairContainer = this.container.querySelector('#hair-ramp-chips');
    hairContainer?.addEventListener('mouseover', (e) => {
      const chip = (e.target as HTMLElement).closest('.hair-chip') as HTMLElement | null;
      if (chip) {
        const idxStr = chip.getAttribute('data-index');
        if (idxStr !== null) {
          const idx = parseInt(idxStr, 10);
          if (!isNaN(idx)) {
            this.callbacks.onHighlightPaletteColor?.(idx);
            return;
          }
        }
      }
      this.callbacks.onHighlightPaletteColor?.(null);
    });
    hairContainer?.addEventListener('mouseleave', () => {
      this.callbacks.onHighlightPaletteColor?.(null);
    });
  }

  public update(state: StudioState): void {
    this.currentState = state;

    // 1. 活跃状态指示徽章
    const isPixelActive = state.activeMode === 'pixel';
    const activeBadge = this.container.querySelector('#palette-active-badge') as HTMLElement;
    if (activeBadge) {
      activeBadge.style.display = isPixelActive ? 'inline-flex' : 'none';
    }

    const panelEl = this.container.querySelector('.palette-sidebar-inner') as HTMLElement;
    if (panelEl) {
      if (isPixelActive) {
        panelEl.classList.add('mode-active');
      } else {
        panelEl.classList.remove('mode-active');
      }
    }

    // 2. 工具选择按钮高亮 (区分 画笔 / 橡皮擦 / 油漆桶 / 吸管 / 矩形选区)
    const penBtn = this.container.querySelector('#btn-tool-pen');
    const eraserBtn = this.container.querySelector('#btn-tool-eraser');
    const bucketBtn = this.container.querySelector('#btn-tool-bucket');
    const eyeBtn = this.container.querySelector('#btn-tool-eyedropper');
    const selectBtn = this.container.querySelector('#btn-tool-select');

    penBtn?.classList.remove('active');
    eraserBtn?.classList.remove('active');
    bucketBtn?.classList.remove('active');
    eyeBtn?.classList.remove('active');
    selectBtn?.classList.remove('active');

    if (isPixelActive) {
      if (state.activeTool === 'select') {
        selectBtn?.classList.add('active');
      } else if (state.activeTool === 'bucket') {
        bucketBtn?.classList.add('active');
      } else if (state.activeTool === 'eyedropper') {
        eyeBtn?.classList.add('active');
      } else if (state.activeTool === 'eraser') {
        eraserBtn?.classList.add('active');
      } else if (state.activeTool === 'pen') {
        penBtn?.classList.add('active');
      }
    }

    // 油漆桶邻域连通性面板展示与状态
    const bucketPanel = this.container.querySelector('#bucket-connectivity-panel') as HTMLElement;
    const connTip = this.container.querySelector('#connectivity-tip') as HTMLElement;
    const btnConn8 = this.container.querySelector('#btn-conn-8');
    const btnConn4 = this.container.querySelector('#btn-conn-4');
    const conn = state.bucketConnectivity ?? 8;

    if (bucketPanel) {
      bucketPanel.style.display = (isPixelActive && state.activeTool === 'bucket') ? 'flex' : 'none';
    }
    if (connTip) {
      connTip.textContent = conn === 8 ? '8 邻居 (含对角线)' : '4 邻居 (十字四向)';
    }
    if (btnConn8) {
      btnConn8.classList.toggle('active', conn === 8);
    }
    if (btnConn4) {
      btnConn4.classList.toggle('active', conn === 4);
    }

    // 3. 撤销 / 重做按钮禁用态
    const undoBtn = this.container.querySelector('#btn-undo') as HTMLButtonElement;
    const redoBtn = this.container.querySelector('#btn-redo') as HTMLButtonElement;
    if (undoBtn) undoBtn.disabled = state.undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = state.redoStack.length === 0;

    // 4. 更新前景色与背景色预览和标签
    const fgIdx = state.activePaletteIndex;
    const bgIdx = state.bgPaletteIndex ?? TRANSPARENT_INDEX;
    const isFgTrans = fgIdx === TRANSPARENT_INDEX;
    const isBgTrans = bgIdx === TRANSPARENT_INDEX;
    const fgHex = isFgTrans ? '透明' : (state.palette[fgIdx] || '#000000');
    const bgHex = isBgTrans ? '透明' : (state.palette[bgIdx] || '#FFFFFF');

    const fgPreview = this.container.querySelector('#fg-color-preview') as HTMLElement;
    const fgHexLabel = this.container.querySelector('#fg-color-hex') as HTMLElement;
    const bgPreview = this.container.querySelector('#bg-color-preview') as HTMLElement;
    const bgHexLabel = this.container.querySelector('#bg-color-hex') as HTMLElement;

    if (fgPreview) {
      if (isFgTrans) {
        fgPreview.className = 'color-slot-preview slot-transparent';
        fgPreview.style.backgroundColor = '';
      } else {
        fgPreview.className = 'color-slot-preview';
        fgPreview.style.backgroundColor = fgHex;
      }
    }
    if (fgHexLabel) {
      fgHexLabel.textContent = isFgTrans ? '[透明/删除]' : `${fgHex} [#${fgIdx}]`;
    }

    if (bgPreview) {
      if (isBgTrans) {
        bgPreview.className = 'color-slot-preview slot-transparent';
        bgPreview.style.backgroundColor = '';
      } else {
        bgPreview.className = 'color-slot-preview';
        bgPreview.style.backgroundColor = bgHex;
      }
    }
    if (bgHexLabel) {
      bgHexLabel.textContent = isBgTrans ? '[透明/擦除]' : `${bgHex} [#${bgIdx}]`;
    }

    // 4.5. 同步发色卡下拉选择与渲染 5 阶发色行 (与右侧 9 大发色系对齐)
    if (state.currentHairPreset && RAMPS_INFO[state.currentHairPreset]) {
      this.selectedHairRampKey = state.currentHairPreset;
    }
    const hairRampSelect = this.container.querySelector('#hair-ramp-select') as HTMLSelectElement | null;
    if (hairRampSelect && hairRampSelect.value !== this.selectedHairRampKey) {
      hairRampSelect.value = this.selectedHairRampKey;
    }
    this.renderHairRampChips();

    // 5. 渲染按色系分组的色板行 (基础色行含纯黑、纯白与透明，左键选前景色，右键选背景色)
    const familiesContainer = this.container.querySelector('#palette-families-container');
    if (familiesContainer) {
      familiesContainer.innerHTML = '';

      PALETTE_FAMILIES.forEach((family) => {
        const row = document.createElement('div');
        row.className = `palette-family-row ${family.id === 'base' ? 'palette-family-row-base' : ''}`;
        row.setAttribute('data-family', family.id);

        const chipsWrap = document.createElement('div');
        chipsWrap.className = 'palette-family-chips';

        family.indices.forEach((index) => {
          const isTrans = index === TRANSPARENT_INDEX;
          const hex = isTrans ? '' : (state.palette[index] || '#000000');
          const chip = document.createElement('div');
          const isFg = index === fgIdx;
          const isBg = index === bgIdx;
          const isWhite = index === WHITE_PALETTE_INDEX;

          chip.className = `palette-chip ${isWhite ? 'chip-white' : ''} ${isTrans ? 'chip-transparent' : ''} ${isFg ? 'is-fg active' : ''} ${isBg ? 'is-bg' : ''}`;
          chip.setAttribute('data-index', String(index));
          if (!isTrans) {
            chip.style.backgroundColor = hex;
          }

          let roleDesc = '';
          if (index === 0) roleDesc = ' (纯黑/线稿)';
          if (index === 1) roleDesc = ' (纯白/高光/眼白)';
          if (isTrans) roleDesc = ' (原生透明/已删除)';

          const indexText = isTrans ? '透' : String(index);
          const tooltip = isTrans
            ? `透明色: 原生透明删除 (左键: 前景，右键: 背景)`
            : `#${index}: ${hex}${roleDesc} (左键: 前景，右键: 背景)`;

          chip.title = tooltip;
          chip.innerHTML = `
            <span class="chip-index">${indexText}</span>
            ${isBg ? '<span class="chip-bg-dot" title="当前背景色"></span>' : ''}
          `;

          // 左键：选择前景色
          chip.addEventListener('click', () => {
            this.callbacks.onActivate();
            this.callbacks.onSelectPaletteColor(index);
          });

          // 右键：选择背景色 (Aseprite 机制)
          chip.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.callbacks.onActivate();
            this.callbacks.onSelectBgColor(index);
          });

          chipsWrap.appendChild(chip);
        });

        row.appendChild(chipsWrap);
        familiesContainer.appendChild(row);
      });
    }
  }

  /**
   * 渲染独立发色卡 5 阶颜色行
   */
  private renderHairRampChips(): void {
    const container = this.container.querySelector('#hair-ramp-chips');
    if (!container || !this.currentState) return;

    const rampInfo = RAMPS_INFO[this.selectedHairRampKey];
    if (!rampInfo) return;

    const fgIdx = this.currentState.activePaletteIndex;
    const bgIdx = this.currentState.bgPaletteIndex ?? TRANSPARENT_INDEX;
    const palette = this.currentState.palette;

    container.innerHTML = '';
    const tierShortNames = ['暗', '深', '中', '主', '光'];

    rampInfo.hexes.forEach((hex, tierIdx) => {
      let paletteIdx = palette.findIndex((c) => c.toLowerCase() === hex.toLowerCase());
      if (paletteIdx === -1) {
        const nearest = findNearestColor(hex, palette);
        paletteIdx = palette.findIndex((c) => c.toLowerCase() === nearest.toLowerCase());
      }
      if (paletteIdx === -1) paletteIdx = 0;

      const actualHex = palette[paletteIdx] || hex;
      const isFg = paletteIdx === fgIdx;
      const isBg = paletteIdx === bgIdx;
      const tierName = TIER_NAMES[tierIdx] || `第${tierIdx + 1}阶`;
      const shortTier = tierShortNames[tierIdx] || `${tierIdx + 1}`;

      const chip = document.createElement('div');
      chip.className = `hair-chip ${isFg ? 'is-fg active' : ''} ${isBg ? 'is-bg' : ''}`;
      chip.setAttribute('data-index', String(paletteIdx));
      chip.style.backgroundColor = actualHex;

      chip.title = `【${rampInfo.name}】${tierName} (${actualHex}) [#${paletteIdx}]\n左键选为前景色，右键选为背景色`;

      chip.innerHTML = `
        <span class="hair-chip-tier">${shortTier}</span>
        <span class="hair-chip-index">${paletteIdx}</span>
        ${isBg ? '<span class="chip-bg-dot" title="当前背景色"></span>' : ''}
      `;

      chip.addEventListener('click', () => {
        this.callbacks.onActivate();
        this.callbacks.onSelectPaletteColor(paletteIdx);
      });

      chip.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.callbacks.onActivate();
        this.callbacks.onSelectBgColor(paletteIdx);
      });

      container.appendChild(chip);
    });
  }
}
