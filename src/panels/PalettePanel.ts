/**
 * 像素模式左栏：修图工具、前景/背景色、发色卡、按色系分组的 36 色色板与颜色微调
 */

import { PixelTool } from '../types';
import { PALETTE_FAMILIES, WHITE_PALETTE_INDEX, TRANSPARENT_INDEX, RAMPS_INFO, TIER_NAMES } from '../data/palette';
import { findNearestColor } from '../core/colorUtils';
import { ViewModel } from '../app/viewModel';
import { EditorContext } from '../app/editorContext';
import { Panel } from './Panel';
import { TOOL_ICONS } from './canvas/cursors';

export class PalettePanel extends Panel {
  private selectedHairRampKey: string = '01_black_黑';

  constructor(private readonly container: HTMLElement, vm: ViewModel, private readonly ctx: EditorContext) {
    super(vm);
    this.build();
    this.markDirty();
  }

  onContextChanged(): void {
    this.applyHighlightClasses(this.ctx.highlightedPaletteIndex);
  }
  onSessionChanged(): void {
    this.markDirty();
  }
  onPaletteChanged(): void {
    this.markDirty();
  }
  onHairPresetChanged(): void {
    this.markDirty();
  }
  onHistoryChanged(): void {
    this.markDirty();
  }
  onDocumentReplaced(): void {
    this.markDirty();
  }

  private build(): void {
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
            <button class="tool-tab-btn active" id="btn-tool-pen" data-tool="pen" title="画笔工具 (快捷键: P)">
              <span class="tool-btn-icon">${TOOL_ICONS.pen}</span>
              <span class="tool-btn-label">画笔</span>
              <kbd class="tool-btn-kbd">P</kbd>
            </button>
            <button class="tool-tab-btn" id="btn-tool-eraser" data-tool="eraser" title="橡皮擦 / 原生透明删除 (快捷键: E)">
              <span class="tool-btn-icon">${TOOL_ICONS.eraser}</span>
              <span class="tool-btn-label">橡皮</span>
              <kbd class="tool-btn-kbd">E</kbd>
            </button>
            <button class="tool-tab-btn" id="btn-tool-bucket" data-tool="bucket" title="油漆桶工具 (快捷键: B / F，单点填充同色相邻区域)">
              <span class="tool-btn-icon">${TOOL_ICONS.bucket}</span>
              <span class="tool-btn-label">油漆桶</span>
              <kbd class="tool-btn-kbd">B</kbd>
            </button>
            <button class="tool-tab-btn btn-span-half" id="btn-tool-eyedropper" data-tool="eyedropper" title="吸管取色 (快捷键: I，画布 Alt+点击)">
              <span class="tool-btn-icon">${TOOL_ICONS.eyedropper}</span>
              <span class="tool-btn-label">吸管</span>
              <kbd class="tool-btn-kbd">I</kbd>
            </button>
            <button class="tool-tab-btn btn-span-half" id="btn-tool-select" data-tool="select" title="矩形选区 (快捷键: M / S，框选平移，Ctrl 复制)">
              <span class="tool-btn-icon">${TOOL_ICONS.select}</span>
              <span class="tool-btn-label">选区</span>
              <kbd class="tool-btn-kbd">M</kbd>
            </button>
          </div>

          <!-- 油漆桶邻域连通选项 (默认 8 邻居，可选 4 邻居) -->
          <div class="bucket-connectivity-panel" id="bucket-connectivity-panel" style="display: none;">
            <div class="connectivity-header">
              <span class="connectivity-title">${TOOL_ICONS.bucket} 油漆桶连通邻域:</span>
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
    // 工具按钮
    this.container.querySelectorAll<HTMLElement>('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => this.vm.setActiveTool(btn.dataset.tool as PixelTool));
    });

    // 油漆桶邻域连通性切换
    const conn8Btn = this.container.querySelector('#btn-conn-8');
    conn8Btn?.addEventListener('click', () => {
      this.vm.setBucketConnectivity(8);
    });

    const conn4Btn = this.container.querySelector('#btn-conn-4');
    conn4Btn?.addEventListener('click', () => {
      this.vm.setBucketConnectivity(4);
    });

    // 交换前景色与背景色
    const swapBtn = this.container.querySelector('#btn-swap-fgbg');
    swapBtn?.addEventListener('click', () => {
      this.vm.swapFgBgColors();
    });

    // 撤销 / 重做
    this.container.querySelector('#btn-undo')?.addEventListener('click', () => this.vm.undo());
    this.container.querySelector('#btn-redo')?.addEventListener('click', () => this.vm.redo());

    // 颜色微调：一次打开取色器到 change 为一次拖动 (gesture)，其间的连续修改合并为一步撤销
    const colorPickerInput = this.container.querySelector('#palette-color-picker') as HTMLInputElement;
    const editColorBtn = this.container.querySelector('#btn-edit-active-color');
    let gesture = 0;
    let isAdjustingColor = false;

    editColorBtn?.addEventListener('click', () => {
      const { activePaletteIndex } = this.vm.session;
      if (activePaletteIndex === TRANSPARENT_INDEX) return;
      colorPickerInput.value = this.vm.doc.palette[activePaletteIndex] || '#000000';
      isAdjustingColor = false;
      colorPickerInput.click();
    });

    colorPickerInput?.addEventListener('input', (e) => {
      if (!isAdjustingColor) {
        isAdjustingColor = true;
        gesture++;
      }
      const val = (e.target as HTMLInputElement).value.toUpperCase();
      this.vm.setPaletteColor(this.vm.session.activePaletteIndex, val, gesture);
    });

    colorPickerInput?.addEventListener('change', () => {
      isAdjustingColor = false;
    });

    this.container.querySelector('#btn-reset-active-color')?.addEventListener('click', () => {
      this.vm.resetActiveColorToDefault();
    });

    this.container.querySelector('#btn-reset-all-palette')?.addEventListener('click', () => {
      this.vm.requestResetAllPalette();
    });

    // 发色系下拉菜单切换 (与右侧 9 大发色系对齐)
    const hairRampSelect = this.container.querySelector('#hair-ramp-select') as HTMLSelectElement | null;
    hairRampSelect?.addEventListener('change', () => {
      this.selectedHairRampKey = hairRampSelect.value;
      this.vm.setHairPreset(this.selectedHairRampKey);
      this.renderHairRampChips();
    });

    // 色块：左键选前景色、右键选背景色、悬停在画布上高亮该颜色 (36 色板与发色卡共用)
    for (const [containerId, chipClass] of [['#palette-families-container', '.palette-chip'], ['#hair-ramp-chips', '.hair-chip']]) {
      const container = this.container.querySelector(containerId);
      const chipIndex = (e: Event): number | null => {
        const chip = (e.target as HTMLElement).closest(chipClass);
        const idx = chip ? parseInt(chip.getAttribute('data-index') ?? '', 10) : NaN;
        return isNaN(idx) ? null : idx;
      };
      container?.addEventListener('click', (e) => {
        const idx = chipIndex(e);
        if (idx !== null) this.vm.selectPaletteIndex(idx);
      });
      container?.addEventListener('contextmenu', (e) => {
        const idx = chipIndex(e);
        if (idx === null) return;
        e.preventDefault();
        this.vm.selectBgPaletteIndex(idx);
      });
      container?.addEventListener('mouseover', (e) => this.ctx.setHighlightedPaletteIndex(chipIndex(e)));
      container?.addEventListener('mouseleave', () => this.ctx.setHighlightedPaletteIndex(null));
    }
  }

  render(): void {
    const state = { ...this.vm.session, ...this.vm.doc };

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

    // 2. 工具选择按钮高亮
    this.container.querySelectorAll<HTMLElement>('[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', isPixelActive && btn.dataset.tool === state.activeTool);
    });

    // 油漆桶邻域连通性面板展示与状态
    const bucketPanel = this.container.querySelector('#bucket-connectivity-panel') as HTMLElement;
    const connTip = this.container.querySelector('#connectivity-tip') as HTMLElement;
    const btnConn8 = this.container.querySelector('#btn-conn-8');
    const btnConn4 = this.container.querySelector('#btn-conn-4');
    const conn = state.bucketConnectivity;

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
    if (undoBtn) undoBtn.disabled = !this.vm.canUndo();
    if (redoBtn) redoBtn.disabled = !this.vm.canRedo();

    // 4. 更新前景色与背景色预览和标签
    const fgIdx = state.activePaletteIndex;
    const bgIdx = state.bgPaletteIndex;
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

          chipsWrap.appendChild(chip);
        });

        row.appendChild(chipsWrap);
        familiesContainer.appendChild(row);
      });
    }

    this.applyHighlightClasses(this.ctx.highlightedPaletteIndex);
  }

  /**
   * 渲染独立发色卡 5 阶颜色行
   */
  private renderHairRampChips(): void {
    const container = this.container.querySelector('#hair-ramp-chips');
    if (!container) return;

    const rampInfo = RAMPS_INFO[this.selectedHairRampKey];
    if (!rampInfo) return;

    const fgIdx = this.vm.session.activePaletteIndex;
    const bgIdx = this.vm.session.bgPaletteIndex;
    const palette = this.vm.doc.palette;

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

      container.appendChild(chip);
    });
  }

  /**
   * 探针联动：设置/清除左侧 36 色色板与独立发色卡中对应的高亮色块
   * @param index 调色板索引 (0~35 或 255 代表透明色)；传入 null 则清除高亮
   */
  private applyHighlightClasses(index: number | null): void {
    const familiesContainer = this.container.querySelector('#palette-families-container');
    const hairContainer = this.container.querySelector('#hair-ramp-chips');

    // 清除旧高亮
    this.container.querySelectorAll('.palette-chip.is-probed, .hair-chip.is-probed').forEach((el) => {
      el.classList.remove('is-probed');
    });

    if (index !== null) {
      familiesContainer?.classList.add('has-probed-color');
      hairContainer?.classList.add('has-probed-color');

      const matchingChips = this.container.querySelectorAll(
        `.palette-chip[data-index="${index}"], .hair-chip[data-index="${index}"]`
      );
      matchingChips.forEach((chip) => {
        chip.classList.add('is-probed');
      });
    } else {
      familiesContainer?.classList.remove('has-probed-color');
      hairContainer?.classList.remove('has-probed-color');
    }
  }
}
