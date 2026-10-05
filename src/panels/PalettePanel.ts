/**
 * 像素模式左栏：修图工具、前景/背景色、发色卡、按色系分组的 36 色色板与颜色微调
 */

import { PixelTool, HairPresetKey } from '../core/types';
import { PALETTE_FAMILIES, WHITE_PALETTE_INDEX, TRANSPARENT_INDEX, RAMPS_INFO, TIER_NAMES, isHairPresetKey } from '../core/constants';
import { findNearestColor } from '../utils/colorUtils';
import { ViewModel } from '../app/viewModel';
import { EditorContext } from '../app/editorContext';
import { Panel } from './Panel';
import { TOOL_ICONS } from './canvas/cursors';

export class PalettePanel extends Panel {
  private selectedHairRampKey: HairPresetKey = '01_black_黑';

  // Cached DOM elements
  private activeBadge!: HTMLElement | null;
  private panelEl!: HTMLElement | null;
  private toolButtons!: NodeListOf<HTMLElement>;
  private bucketPanel!: HTMLElement | null;
  private connTip!: HTMLElement | null;
  private btnConn8!: HTMLElement | null;
  private btnConn4!: HTMLElement | null;
  private undoBtn!: HTMLButtonElement | null;
  private redoBtn!: HTMLButtonElement | null;
  private fgPreview!: HTMLElement | null;
  private fgHexLabel!: HTMLElement | null;
  private bgPreview!: HTMLElement | null;
  private bgHexLabel!: HTMLElement | null;
  private hairRampSelect!: HTMLSelectElement | null;
  private btnHighlightHair!: HTMLButtonElement | null;
  private familiesContainer!: HTMLElement | null;
  private hairContainer!: HTMLElement | null;

  // Cached chip elements
  private paletteChipElements = new Map<number, { chip: HTMLElement; bgDot: HTMLElement }>();
  private hairChipElements: { chip: HTMLElement; tierSpan: HTMLElement; indexSpan: HTMLElement; bgDot: HTMLElement }[] = [];

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
            <button class="tool-tab-btn" id="btn-tool-bucket" data-tool="bucket" title="油漆桶工具 (快捷键: B，单点填充同色相邻区域)">
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

          <!-- 💇 独立发色卡区 (Hair Color Ramp: 下拉选择 9 大发色系 + 4 阶颜色行) -->
          <div class="hair-ramp-section">
            <div class="hair-ramp-header">
              <div class="hair-ramp-title-group">
                <span class="hair-ramp-title">💇 发色卡</span>
                <span class="hair-ramp-tier-hint">(4色阶)</span>
              </div>
              <div class="hair-ramp-actions">
                <button type="button" class="hair-highlight-btn" id="btn-highlight-hair-ramp" title="全发色高亮探针 (快捷键: F，按住预览或短按切换锁定，在画布上高亮所有当前发色)">
                  ✨ 发色高亮
                </button>
                <div class="hair-ramp-select-wrap">
                  <select id="hair-ramp-select" class="hair-ramp-select" title="切换发色系列 (与右栏 9 色系对齐)">
                    ${rampOptions}
                  </select>
                </div>
              </div>
            </div>
            <div class="hair-ramp-chips" id="hair-ramp-chips">
              <!-- 4 个发色卡片在 buildStaticChips 中初始化 -->
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
            <!-- 各色系行在 buildStaticChips 中初始化 -->
          </div>
        </div>
      </aside>
    `;

    this.cacheDomReferences();
    this.buildStaticChips();
    this.setupEvents();
  }

  private cacheDomReferences(): void {
    const q = <T extends HTMLElement>(sel: string) => this.container.querySelector<T>(sel);
    this.activeBadge = q('#palette-active-badge');
    this.panelEl = q('.palette-sidebar-inner');
    this.toolButtons = this.container.querySelectorAll<HTMLElement>('[data-tool]');
    this.bucketPanel = q('#bucket-connectivity-panel');
    this.connTip = q('#connectivity-tip');
    this.btnConn8 = q('#btn-conn-8');
    this.btnConn4 = q('#btn-conn-4');
    this.undoBtn = q('#btn-undo');
    this.redoBtn = q('#btn-redo');
    this.fgPreview = q('#fg-color-preview');
    this.fgHexLabel = q('#fg-color-hex');
    this.bgPreview = q('#bg-color-preview');
    this.bgHexLabel = q('#bg-color-hex');
    this.hairRampSelect = q('#hair-ramp-select');
    this.btnHighlightHair = q('#btn-highlight-hair-ramp');
    this.familiesContainer = q('#palette-families-container');
    this.hairContainer = q('#hair-ramp-chips');
  }

  private buildStaticChips(): void {
    // 1. 初始化 36 色 + 基础色板 DOM 树
    if (this.familiesContainer) {
      this.familiesContainer.innerHTML = '';
      this.paletteChipElements.clear();

      PALETTE_FAMILIES.forEach((family) => {
        const row = document.createElement('div');
        row.className = `palette-family-row ${family.id === 'base' ? 'palette-family-row-base' : ''}`;
        row.setAttribute('data-family', family.id);

        const chipsWrap = document.createElement('div');
        chipsWrap.className = 'palette-family-chips';

        family.indices.forEach((index) => {
          const isTrans = index === TRANSPARENT_INDEX;
          const isWhite = index === WHITE_PALETTE_INDEX;

          const chip = document.createElement('div');
          chip.className = `palette-chip ${isWhite ? 'chip-white' : ''} ${isTrans ? 'chip-transparent' : ''}`;
          chip.setAttribute('data-index', String(index));

          const indexSpan = document.createElement('span');
          indexSpan.className = 'chip-index';
          indexSpan.textContent = isTrans ? '透' : String(index);

          const bgDot = document.createElement('span');
          bgDot.className = 'chip-bg-dot';
          bgDot.title = '当前背景色';
          bgDot.style.display = 'none';

          chip.appendChild(indexSpan);
          chip.appendChild(bgDot);
          chipsWrap.appendChild(chip);

          this.paletteChipElements.set(index, { chip, bgDot });
        });

        row.appendChild(chipsWrap);
        this.familiesContainer!.appendChild(row);
      });
    }

    // 2. 初始化 4 阶独立发色卡 DOM 结构
    if (this.hairContainer) {
      this.hairContainer.innerHTML = '';
      this.hairChipElements = [];

      for (let i = 0; i < 4; i++) {
        const chip = document.createElement('div');
        chip.className = 'hair-chip';

        const tierSpan = document.createElement('span');
        tierSpan.className = 'hair-chip-tier';

        const indexSpan = document.createElement('span');
        indexSpan.className = 'hair-chip-index';

        const bgDot = document.createElement('span');
        bgDot.className = 'chip-bg-dot';
        bgDot.title = '当前背景色';
        bgDot.style.display = 'none';

        chip.appendChild(tierSpan);
        chip.appendChild(indexSpan);
        chip.appendChild(bgDot);
        this.hairContainer.appendChild(chip);

        this.hairChipElements.push({ chip, tierSpan, indexSpan, bgDot });
      }
    }
  }

  private setupEvents(): void {
    // 工具按钮
    this.toolButtons.forEach((btn) => {
      btn.addEventListener('click', () => this.vm.setActiveTool(btn.dataset.tool as PixelTool));
    });

    // 油漆桶邻域连通性切换
    this.btnConn8?.addEventListener('click', () => {
      this.vm.setBucketConnectivity(8);
    });
    this.btnConn4?.addEventListener('click', () => {
      this.vm.setBucketConnectivity(4);
    });

    // 交换前景色与背景色
    this.container.querySelector('#btn-swap-fgbg')?.addEventListener('click', () => {
      this.vm.swapFgBgColors();
    });

    // 撤销 / 重做
    this.undoBtn?.addEventListener('click', () => this.vm.undo());
    this.redoBtn?.addEventListener('click', () => this.vm.redo());

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
        gesture = this.vm.nextGestureId();
      }
      const val = (e.target as HTMLInputElement).value.toUpperCase();
      this.vm.setPaletteColor(this.vm.session.activePaletteIndex, val, gesture);
    });

    colorPickerInput?.addEventListener('change', () => {
      isAdjustingColor = false;
      gesture = 0;
    });

    this.container.querySelector('#btn-reset-active-color')?.addEventListener('click', () => {
      this.vm.resetActiveColorToDefault();
    });

    this.container.querySelector('#btn-reset-all-palette')?.addEventListener('click', () => {
      this.vm.requestResetAllPalette();
    });

    // 发色系下拉菜单切换 (与右侧 9 大发色系对齐)
    this.hairRampSelect?.addEventListener('change', () => {
      if (!this.hairRampSelect) return;
      const val = this.hairRampSelect.value;
      if (isHairPresetKey(val)) {
        this.selectedHairRampKey = val;
        this.vm.setHairPreset(this.selectedHairRampKey);
        this.renderHairRampChips();
        if (this.ctx.isHairHighlightPinned) {
          this.ctx.setHighlightedPaletteIndex(this.getHairRampIndices());
        }
      }
    });

    // 发色高亮按钮：鼠标移上全发色高亮，移开取消；点击可锁定高亮
    this.btnHighlightHair?.addEventListener('mouseenter', () => {
      this.ctx.setHighlightedPaletteIndex(this.getHairRampIndices());
    });
    this.btnHighlightHair?.addEventListener('mouseleave', () => {
      if (!this.ctx.isHairHighlightPinned) {
        this.ctx.setHighlightedPaletteIndex(null);
      }
    });
    this.btnHighlightHair?.addEventListener('click', () => {
      const willPin = !this.ctx.isHairHighlightPinned;
      this.ctx.setHairHighlightPinned(willPin);
      this.ctx.setHighlightedPaletteIndex(willPin ? this.getHairRampIndices() : null);
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
      container?.addEventListener('mouseover', (e) => {
        const idx = chipIndex(e);
        if (idx !== null) {
          if (this.ctx.isHairHighlightPinned) {
            this.ctx.setHairHighlightPinned(false);
          }
          this.ctx.setHighlightedPaletteIndex(idx);
        }
      });
      container?.addEventListener('mouseleave', () => {
        if (!this.ctx.isHairHighlightPinned) {
          this.ctx.setHighlightedPaletteIndex(null);
        }
      });
    }
  }

  render(): void {
    const state = { ...this.vm.session, ...this.vm.doc };

    // 1. 活跃状态指示徽章
    const isPixelActive = state.activeMode === 'pixel';
    if (this.activeBadge) {
      this.activeBadge.style.display = isPixelActive ? 'inline-flex' : 'none';
    }

    if (this.panelEl) {
      this.panelEl.classList.toggle('mode-active', isPixelActive);
    }

    // 2. 工具选择按钮高亮
    this.toolButtons.forEach((btn) => {
      btn.classList.toggle('active', isPixelActive && btn.dataset.tool === state.activeTool);
    });

    // 油漆桶邻域连通性面板展示与状态
    const conn = state.bucketConnectivity;
    if (this.bucketPanel) {
      this.bucketPanel.style.display = isPixelActive && state.activeTool === 'bucket' ? 'flex' : 'none';
    }
    if (this.connTip) {
      this.connTip.textContent = conn === 8 ? '8 邻居 (含对角线)' : '4 邻居 (十字四向)';
    }
    if (this.btnConn8) {
      this.btnConn8.classList.toggle('active', conn === 8);
    }
    if (this.btnConn4) {
      this.btnConn4.classList.toggle('active', conn === 4);
    }

    // 3. 撤销 / 重做按钮禁用态
    if (this.undoBtn) this.undoBtn.disabled = !this.vm.canUndo();
    if (this.redoBtn) this.redoBtn.disabled = !this.vm.canRedo();

    // 4. 更新前景色与背景色预览和标签
    const fgIdx = state.activePaletteIndex;
    const bgIdx = state.bgPaletteIndex;
    const isFgTrans = fgIdx === TRANSPARENT_INDEX;
    const isBgTrans = bgIdx === TRANSPARENT_INDEX;
    const fgHex = isFgTrans ? '透明' : state.palette[fgIdx] || '#000000';
    const bgHex = isBgTrans ? '透明' : state.palette[bgIdx] || '#FFFFFF';

    if (this.fgPreview) {
      if (isFgTrans) {
        this.fgPreview.className = 'color-slot-preview slot-transparent';
        this.fgPreview.style.backgroundColor = '';
      } else {
        this.fgPreview.className = 'color-slot-preview';
        this.fgPreview.style.backgroundColor = fgHex;
      }
    }
    if (this.fgHexLabel) {
      this.fgHexLabel.textContent = isFgTrans ? '[透明/删除]' : `${fgHex} [#${fgIdx}]`;
    }

    if (this.bgPreview) {
      if (isBgTrans) {
        this.bgPreview.className = 'color-slot-preview slot-transparent';
        this.bgPreview.style.backgroundColor = '';
      } else {
        this.bgPreview.className = 'color-slot-preview';
        this.bgPreview.style.backgroundColor = bgHex;
      }
    }
    if (this.bgHexLabel) {
      this.bgHexLabel.textContent = isBgTrans ? '[透明/擦除]' : `${bgHex} [#${bgIdx}]`;
    }

    // 4.5. 同步发色卡下拉选择与渲染 5 阶发色行 (与右侧 9 大发色系对齐)
    if (state.currentHairPreset && RAMPS_INFO[state.currentHairPreset]) {
      this.selectedHairRampKey = state.currentHairPreset;
    }
    if (this.hairRampSelect && this.hairRampSelect.value !== this.selectedHairRampKey) {
      this.hairRampSelect.value = this.selectedHairRampKey;
    }
    this.renderHairRampChips();

    // 5. 原地修补按色系分组的色板行 (复用 DOM 节点，零 innerHTML 重建)
    this.paletteChipElements.forEach(({ chip, bgDot }, index) => {
      const isTrans = index === TRANSPARENT_INDEX;
      const hex = isTrans ? '' : state.palette[index] || '#000000';
      const isFg = index === fgIdx;
      const isBg = index === bgIdx;

      chip.classList.toggle('is-fg', isFg);
      chip.classList.toggle('active', isFg);
      chip.classList.toggle('is-bg', isBg);
      bgDot.style.display = isBg ? 'block' : 'none';

      if (!isTrans) {
        chip.style.backgroundColor = hex;
      }

      let roleDesc = '';
      if (index === 0) roleDesc = ' (纯黑/线稿)';
      if (index === 1) roleDesc = ' (纯白/高光/眼白)';
      if (isTrans) roleDesc = ' (原生透明/已删除)';

      const tooltip = isTrans
        ? `透明色: 原生透明删除 (左键: 前景，右键: 背景)`
        : `#${index}: ${hex}${roleDesc} (左键: 前景，右键: 背景)`;
      chip.title = tooltip;
    });

    this.applyHighlightClasses(this.ctx.highlightedPaletteIndex);
  }

  /**
   * 获取当前选中发色卡的全部 4 阶颜色在色板中的索引列表
   */
  private getHairRampIndices(): number[] {
    return this.vm.getHairRampIndices(this.selectedHairRampKey);
  }

  /**
   * 原地修补独立发色卡 4 阶颜色行 (复用 DOM 节点)
   */
  private renderHairRampChips(): void {
    const rampInfo = RAMPS_INFO[this.selectedHairRampKey];
    if (!rampInfo || this.hairChipElements.length === 0) return;

    const fgIdx = this.vm.session.activePaletteIndex;
    const bgIdx = this.vm.session.bgPaletteIndex;
    const palette = this.vm.doc.palette;
    const tierShortNames = ['暗', '影', '主', '光'];

    rampInfo.hexes.forEach((hex, tierIdx) => {
      const cached = this.hairChipElements[tierIdx];
      if (!cached) return;

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

      cached.chip.className = `hair-chip ${isFg ? 'is-fg active' : ''} ${isBg ? 'is-bg' : ''}`;
      cached.chip.setAttribute('data-index', String(paletteIdx));
      cached.chip.style.backgroundColor = actualHex;
      cached.chip.title = `【${rampInfo.name}】${tierName} (${actualHex}) [#${paletteIdx}]\n左键选为前景色，右键选为背景色`;

      cached.tierSpan.textContent = shortTier;
      cached.indexSpan.textContent = String(paletteIdx);
      cached.bgDot.style.display = isBg ? 'block' : 'none';
    });
  }

  /**
   * 探针联动：设置/清除左侧 36 色色板与独立发色卡中对应的高亮色块
   * @param index 调色板索引 (0~35 或 255 代表透明色) 或索引列表；传入 null 则清除高亮
   */
  private applyHighlightClasses(index: number | number[] | null): void {
    if (typeof index === 'number') {
      this.ctx.setHairHighlightPinned(false);
    }

    // 清除旧高亮
    this.container.querySelectorAll('.palette-chip.is-probed, .hair-chip.is-probed').forEach((el) => {
      el.classList.remove('is-probed');
    });

    if (index !== null) {
      this.familiesContainer?.classList.add('has-probed-color');
      this.hairContainer?.classList.add('has-probed-color');

      const indices = Array.isArray(index) ? index : [index];
      indices.forEach((idx) => {
        const matchingChips = this.container.querySelectorAll(
          `.palette-chip[data-index="${idx}"], .hair-chip[data-index="${idx}"]`
        );
        matchingChips.forEach((chip) => {
          chip.classList.add('is-probed');
        });
      });
    } else {
      this.familiesContainer?.classList.remove('has-probed-color');
      this.hairContainer?.classList.remove('has-probed-color');
    }

    if (this.btnHighlightHair) {
      this.btnHighlightHair.classList.toggle('active', this.ctx.isHairHighlightPinned);
    }
  }

  protected onDispose(): void {
    this.container.innerHTML = '';
    this.paletteChipElements.clear();
    this.hairChipElements = [];
  }
}
