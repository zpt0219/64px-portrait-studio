/**
 * 遮罩模式左栏工具箱：遮罩工具与笔刷尺寸、智能框选匹配色组、画面颜色一键转遮罩
 */

import { ZONE_CONFIG, MaskTool, BrushSize } from '../types';
import { TRANSPARENT_INDEX, MATCH_COLOR_PRESETS, paletteIndexLabel } from '../data/palette';
import { PIXEL_COUNT } from '../core/pixelGrid';
import { EditorSession } from '../model/session';
import { ViewModel } from '../app/viewModel';
import { Panel } from './Panel';
import { TOOL_ICONS } from './canvas/cursors';

interface ColorCardNodes {
  card: HTMLElement;
  swatch: HTMLElement;
  hexText: HTMLElement;
  countText: HTMLElement;
  pctWrap: HTMLElement;
  pctFill: HTMLElement;
  pctLabel: HTMLElement;
  right: HTMLElement;
  lastClass?: string;
  lastTitle?: string;
  lastHex?: string;
  lastTotal?: number;
  lastPct?: number;
  lastRightMode?: string;
}

export class MaskToolsPanel extends Panel {
  private isAddPopoverOpen = false;
  private colorListDirty = true;
  private cachedMatchColors: number[] | null = null;
  private cachedChipsPalette: string[] | null = null;
  private addSwatchNodes: HTMLElement[] = [];
  private cardMap: Map<number, ColorCardNodes> = new Map();

  // Cached DOM elements
  private zoneBadge!: HTMLElement | null;
  private zoneTag!: HTMLElement | null;
  private btnUndo!: HTMLButtonElement | null;
  private btnRedo!: HTMLButtonElement | null;
  private toolBtns!: NodeListOf<HTMLButtonElement>;
  private boxSelectCard!: HTMLElement | null;
  private brushSizeSection!: HTMLElement | null;
  private brushSlider!: HTMLInputElement | null;
  private brushSizeText!: HTMLElement | null;
  private presetSelect!: HTMLSelectElement | null;
  private countTag!: HTMLElement | null;
  private chipsRow!: HTMLElement | null;
  private popover!: HTMLElement | null;
  private addGrid!: HTMLElement | null;
  private listEl!: HTMLElement | null;

  constructor(private readonly container: HTMLElement, vm: ViewModel) {
    super(vm);
    this.build();
    this.markDirty();
  }

  onSessionChanged(keys: (keyof EditorSession)[]): void {
    if (keys.includes('activeZone') || keys.includes('lockedMaskZones') || keys.includes('isLoaded')) {
      this.colorListDirty = true;
    }
    this.markDirty();
  }
  onPixelsChanged(): void {
    this.colorListDirty = true;
    this.markDirty();
  }
  onMaskChanged(): void {
    this.colorListDirty = true;
    this.markDirty();
  }
  onPaletteChanged(): void {
    this.colorListDirty = true;
    this.markDirty();
  }
  onHistoryChanged(): void {
    this.markDirty();
  }
  onDocumentReplaced(): void {
    this.colorListDirty = true;
    this.markDirty();
  }

  private get state() {
    return { ...this.vm.session, ...this.vm.doc };
  }

  private build(): void {
    const presetOptionsHtml = MATCH_COLOR_PRESETS.map((p) =>
      `<option value="${p.id}">${p.icon} ${p.name}</option>`
    ).join('') + `<option value="custom">🎨 自定义色组...</option>`;

    this.container.innerHTML = `
      <aside class="column-sidebar mask-tools-sidebar-inner">
        <div class="panel-section">
          <!-- 标题与状态反馈 -->
          <div class="section-header">
            <div class="section-title-group">
              <span class="section-title">🎭 遮罩工具箱</span>
              <span class="panel-active-badge active-zone-badge" id="mask-tools-zone-badge">● 头发</span>
            </div>
            <div class="history-actions">
              <button class="btn-icon-sm" id="btn-mask-undo" title="撤销 (Ctrl+Z)">↩️</button>
              <button class="btn-icon-sm" id="btn-mask-redo" title="重做 (Ctrl+Y)">↪️</button>
            </div>
          </div>

          <!-- 切回像素修图模式快捷入口 -->
          <div class="mask-mode-switch-row" style="margin-bottom: 12px;">
            <button class="btn btn-outline btn-block btn-sm" id="btn-switch-to-pixel" type="button" title="退出遮罩编辑，切回 36 色板修图模式 (快捷键: Q)">
              <span>🎨 切回色板修图</span>
              <kbd class="tool-btn-kbd">Q</kbd>
            </button>
          </div>

          <!-- 工具选择 (画笔 / 橡皮 / 油漆桶 / 框选) -->
          <div class="tool-picker-group mask-tool-grid">
            <button class="tool-tab-btn active" id="btn-mask-tool-pen" data-tool="pen" title="遮罩画笔 (快捷键: P)">
              <span class="tool-btn-icon">${TOOL_ICONS.pen}</span>
              <span class="tool-btn-label">画笔</span>
              <kbd class="tool-btn-kbd">P</kbd>
            </button>
            <button class="tool-tab-btn" id="btn-mask-tool-eraser" data-tool="eraser" title="遮罩橡皮 (快捷键: E，擦除为背景 0)">
              <span class="tool-btn-icon">${TOOL_ICONS.eraser}</span>
              <span class="tool-btn-label">橡皮</span>
              <kbd class="tool-btn-kbd">E</kbd>
            </button>
            <button class="tool-tab-btn" id="btn-mask-tool-bucket" data-tool="bucket" title="遮罩油漆桶 (快捷键: B，BFS 扩展相邻同色像素；按住 Shift 全图同色进入遮罩)">
              <span class="tool-btn-icon">${TOOL_ICONS.bucket}</span>
              <span class="tool-btn-label">油漆桶</span>
              <kbd class="tool-btn-kbd">B</kbd>
            </button>
            <button class="tool-tab-btn" id="btn-mask-tool-select" data-tool="box_select" title="智能框选 (快捷键: S，左键加匹配色，Shift+左键去杂色，Alt+左键去匹配色，右键去所有颜色)">
              <span class="tool-btn-icon">${TOOL_ICONS.select}</span>
              <span class="tool-btn-label">框选</span>
              <kbd class="tool-btn-kbd">S</kbd>
            </button>
          </div>

          <!-- 画笔与橡皮共用尺寸选择 (1 ~ 10 滑块，类似缩放 slider，仅画笔/橡皮显示) -->
          <div class="brush-size-section" id="brush-size-section">
            <div class="brush-size-header">
              <div class="brush-size-title-group">
                <span class="sub-label">画笔 / 橡皮尺寸</span>
                <span class="badge-tag-sm brush-size-badge" id="brush-size-text">1×1</span>
              </div>
              <span class="sub-hint">快捷键: <kbd>[</kbd> / <kbd>]</kbd></span>
            </div>
            <div class="brush-size-slider-row">
              <span class="slider-tick-label">1</span>
              <input type="range" class="zoom-range-slider brush-range-slider" id="slider-mask-brush-size" min="1" max="10" step="1" value="1" title="画笔/橡皮尺寸 (1 ~ 10 像素)">
              <span class="slider-tick-label">10</span>
            </div>
          </div>

          <!-- 智能色组框选器 (Smart Color-Group Box Select) -->
          <div class="mask-box-select-card" id="mask-box-select-card">
            <div class="section-sub-header">
              <span class="sub-label">🔲 智能框选匹配色组</span>
              <span class="badge-tag-sm" id="match-color-count-tag">0 色</span>
            </div>

            <div class="box-select-dropdown-row">
              <select class="match-preset-select" id="select-match-preset" title="选择预制色板组">
                ${presetOptionsHtml}
              </select>
            </div>

            <div class="match-chips-row" id="match-chips-row">
              <!-- 动态匹配颜色色块 -->
            </div>

            <!-- 快速加色弹出浮层 -->
            <div class="add-color-picker-popover" id="add-color-picker-popover" style="display: none;">
              <div class="add-color-picker-header">
                <span class="popover-title">点击色块追加进匹配组:</span>
                <button class="btn-xs-close" id="btn-close-color-picker" type="button" title="关闭">✕</button>
              </div>
              <div class="add-color-grid" id="add-color-grid"></div>
            </div>

            <div class="match-tip-box">
              <div class="match-tip-line">🖱️ <b>左键框选</b>：将框内<b>匹配色</b>划入遮罩 (加法)</div>
              <div class="match-tip-line match-tip-highlight">⚡ <b>Shift + 左键</b>：<span class="subtract-tag">去杂色</span> 将框内<b>非匹配色</b>从遮罩删除</div>
              <div class="match-tip-line match-tip-highlight">✂️ <b>Alt + 左键</b>：<span class="subtract-tag">去匹配色</span> 将框内<b>当前匹配色</b>从遮罩删除</div>
              <div class="match-tip-line match-tip-highlight">🧹 <b>右键框选</b>：<span class="subtract-tag">去所有色</span> 直接清空框内<b>所有颜色</b>的遮罩</div>
              <div class="match-sub-tip">💡 点击「➕ 添加」可追加匹配颜色；右键框选可一键清除整块遮罩</div>
            </div>
          </div>

          <!-- 方案 A：颜色一键转遮罩 (Color-to-Mask Magic) -->
          <div class="color-to-mask-section">
            <div class="section-sub-header">
              <span class="sub-label">✨ 画面颜色一键转遮罩</span>
              <span class="badge-tag-sm" id="color-to-mask-zone-tag">目标: 头发</span>
            </div>
            <p class="panel-tip-text">
              点击下方色卡，将全图中所有该颜色的非锁定像素批量划入当前遮罩。
            </p>
            <div class="color-to-mask-list" id="color-to-mask-list">
              <!-- 动态填充画面中实际出现的颜色 -->
            </div>
          </div>
        </div>
      </aside>
    `;

    this.cacheDomReferences();
    this.bindEvents();
  }

  private cacheDomReferences(): void {
    const q = <T extends HTMLElement>(sel: string) => this.container.querySelector<T>(sel);
    this.zoneBadge = q('#mask-tools-zone-badge');
    this.zoneTag = q('#color-to-mask-zone-tag');
    this.btnUndo = q('#btn-mask-undo');
    this.btnRedo = q('#btn-mask-redo');
    this.toolBtns = this.container.querySelectorAll<HTMLButtonElement>('.tool-tab-btn[data-tool]');
    this.boxSelectCard = q('#mask-box-select-card');
    this.brushSizeSection = q('#brush-size-section');
    this.brushSlider = q('#slider-mask-brush-size');
    this.brushSizeText = q('#brush-size-text');
    this.presetSelect = q('#select-match-preset');
    this.countTag = q('#match-color-count-tag');
    this.chipsRow = q('#match-chips-row');
    this.popover = q('#add-color-picker-popover');
    this.addGrid = q('#add-color-grid');
    this.listEl = q('#color-to-mask-list');
  }

  private bindEvents(): void {
    // 撤销 / 重做
    this.btnUndo?.addEventListener('click', () => this.vm.undo());
    this.btnRedo?.addEventListener('click', () => this.vm.redo());

    // 切回像素修图模式
    this.container.querySelector('#btn-switch-to-pixel')?.addEventListener('click', () => {
      this.vm.setMode('pixel');
    });

    // 工具按钮点击
    this.toolBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tool = btn.getAttribute('data-tool') as MaskTool;
        if (tool) {
          this.vm.setActiveMaskTool(tool);
        }
      });
    });

    // 预制色板组下拉切换
    this.presetSelect?.addEventListener('change', () => {
      if (this.presetSelect && this.presetSelect.value !== 'custom') {
        this.vm.setMaskMatchPreset(this.presetSelect.value);
      }
    });

    // 关闭添加颜色浮层
    this.container.querySelector('#btn-close-color-picker')?.addEventListener('click', () => {
      this.toggleAddColorPopover(false);
    });

    // 画笔/橡皮尺寸滑块 (1 ~ 10)
    this.brushSlider?.addEventListener('input', () => {
      if (!this.brushSlider) return;
      const size = parseInt(this.brushSlider.value, 10) as BrushSize;
      if (size >= 1 && size <= 10) {
        this.vm.setMaskBrushSize(size);
      }
    });

    // 匹配色块：✕ 移除，➕ 展开加色浮层
    this.chipsRow?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const delBtn = target.closest<HTMLElement>('.match-chip-del-btn');
      if (delBtn) {
        this.vm.removeMaskMatchColor(Number(delBtn.dataset.colorIdx));
      } else if (target.closest('.match-chip-add-btn')) {
        this.toggleAddColorPopover();
      }
    });

    // 加色浮层：已在组中的颜色点击移除，否则加入
    this.addGrid?.addEventListener('click', (e) => {
      const swatch = (e.target as HTMLElement).closest<HTMLElement>('.add-swatch-item');
      if (!swatch) return;
      const idx = Number(swatch.dataset.index);
      if (swatch.classList.contains('is-selected')) this.vm.removeMaskMatchColor(idx);
      else this.vm.addMaskMatchColor(idx);
    });

    // 颜色卡片点击委托 (画面颜色一键转遮罩)
    this.listEl?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const card = target.closest<HTMLElement>('.color-mask-card');
      if (!card) return;

      if (card.classList.contains('fully-assigned') || card.classList.contains('all-locked')) {
        return;
      }

      const colorIdxStr = card.getAttribute('data-color-idx');
      if (colorIdxStr !== null) {
        const colorIdx = parseInt(colorIdxStr, 10);
        if (!isNaN(colorIdx)) {
          this.vm.assignColorToZone(colorIdx);
        }
      }
    });
  }

  render(): void {
    const state = this.state;

    // 1. 更新顶部当前分区指示
    const zoneMeta = ZONE_CONFIG[state.activeZone];

    if (this.zoneBadge && zoneMeta) {
      this.zoneBadge.textContent = `● ${zoneMeta.shortName}`;
      this.zoneBadge.style.color = zoneMeta.color;
      this.zoneBadge.style.borderColor = `${zoneMeta.color}66`;
      this.zoneBadge.style.background = `${zoneMeta.color}18`;
    }

    if (this.zoneTag && zoneMeta) {
      this.zoneTag.textContent = `目标: ${zoneMeta.shortName}`;
      this.zoneTag.style.color = zoneMeta.color;
      this.zoneTag.style.borderColor = `${zoneMeta.color}66`;
    }

    // 2. 更新撤销/重做按钮状态
    if (this.btnUndo) this.btnUndo.disabled = !this.vm.canUndo();
    if (this.btnRedo) this.btnRedo.disabled = !this.vm.canRedo();

    // 3. 更新工具激活高亮
    const activeTool = state.activeMaskTool;
    this.toolBtns.forEach((btn) => {
      const tool = btn.getAttribute('data-tool');
      btn.classList.toggle('active', tool === activeTool);
    });

    // 4. 智能框选激活时高亮控制卡片
    if (this.boxSelectCard) {
      this.boxSelectCard.classList.toggle('tool-active', activeTool === 'box_select');
    }

    // 5. 更新画笔与橡皮共用尺寸显隐与滑块数值 (仅画笔和橡皮显示该选项)
    const isPenOrEraser = activeTool === 'pen' || activeTool === 'eraser';
    if (this.brushSizeSection) {
      this.brushSizeSection.style.display = isPenOrEraser ? '' : 'none';
    }

    const activeSize = state.maskBrushSize;
    if (this.brushSlider && parseInt(this.brushSlider.value, 10) !== activeSize) {
      this.brushSlider.value = String(activeSize);
    }
    if (this.brushSizeText) {
      this.brushSizeText.textContent = `${activeSize}×${activeSize}`;
    }

    // 6. 更新预制色板组下拉与匹配色色块
    if (this.presetSelect && state.maskMatchPresetKey) {
      this.presetSelect.value = state.maskMatchPresetKey;
    }

    const matchColors = state.maskMatchColors;
    if (this.countTag) {
      this.countTag.textContent = `${matchColors.length} 色`;
    }

    this.renderMatchChips();
    if (this.isAddPopoverOpen) {
      this.renderAddColorGrid();
    }

    // 7. 更新画面颜色一键转遮罩列表 (仅在像素/遮罩/分区发生变化时重新扫描计算)
    if (this.colorListDirty) {
      this.colorListDirty = false;
      this.renderColorList();
    }
  }

  private renderMatchChips(): void {
    if (!this.chipsRow) return;

    const matchColors = this.vm.session.maskMatchColors;
    const palette = this.vm.doc.palette;

    const colorsChanged =
      !this.cachedMatchColors ||
      this.cachedMatchColors.length !== matchColors.length ||
      this.cachedMatchColors.some((c, i) => c !== matchColors[i]);
    const paletteChanged =
      !this.cachedChipsPalette ||
      this.cachedChipsPalette.length !== palette.length ||
      this.cachedChipsPalette.some((c, i) => c !== palette[i]);

    if (!colorsChanged && !paletteChanged) {
      return;
    }

    this.cachedMatchColors = [...matchColors];
    this.cachedChipsPalette = [...palette];
    this.chipsRow.innerHTML = '';

    matchColors.forEach((idx) => {
      const hex = palette[idx] || (idx === TRANSPARENT_INDEX ? 'transparent' : '#000000');
      const isWhite = hex.toUpperCase() === '#FFFFFF';
      const isTransparent = idx === TRANSPARENT_INDEX;
      const chip = document.createElement('div');
      chip.className = `match-color-chip ${isTransparent ? 'chip-transparent' : ''} ${isWhite ? 'chip-white' : ''}`;
      chip.style.backgroundColor = isTransparent ? '' : hex;
      chip.title = `#${paletteIndexLabel(idx)} ${hex} (点击 ✕ 移除)`;

      chip.innerHTML = `
        <span class="match-chip-index">${paletteIndexLabel(idx)}</span>
        <button class="match-chip-del-btn" data-color-idx="${idx}" title="从匹配组移除">✕</button>
      `;

      this.chipsRow!.appendChild(chip);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'match-chip-add-btn';
    addBtn.id = 'btn-open-add-color';
    addBtn.type = 'button';
    addBtn.innerHTML = '➕ 添加';
    addBtn.title = '展开色板挑选颜色追加进匹配组';
    this.chipsRow.appendChild(addBtn);
  }

  private toggleAddColorPopover(show?: boolean): void {
    if (!this.popover) return;
    this.isAddPopoverOpen = show !== undefined ? show : !this.isAddPopoverOpen;
    this.popover.style.display = this.isAddPopoverOpen ? 'block' : 'none';
    if (this.isAddPopoverOpen) {
      this.renderAddColorGrid();
    }
  }

  private renderAddColorGrid(): void {
    if (!this.addGrid) return;

    const currentColors = new Set(this.vm.session.maskMatchColors);
    const palette = this.vm.doc.palette;
    const count = Math.min(36, palette.length);

    // 仅在首次或色板长度异常时构建节点，避免后续渲染清空 DOM 导致正在交互/聚焦的色块丢失焦点
    if (this.addSwatchNodes.length !== count || this.addGrid.children.length !== count) {
      this.addGrid.innerHTML = '';
      this.addSwatchNodes = [];
      for (let idx = 0; idx < count; idx++) {
        const swatch = document.createElement('div');
        swatch.dataset.index = String(idx);
        this.addSwatchNodes.push(swatch);
        this.addGrid.appendChild(swatch);
      }
    }

    for (let idx = 0; idx < count; idx++) {
      const swatch = this.addSwatchNodes[idx];
      const hex = palette[idx] || '#000000';
      const isAlreadyIn = currentColors.has(idx);
      const isWhite = hex.toUpperCase() === '#FFFFFF';

      const newClassName = `add-swatch-item ${isAlreadyIn ? 'is-selected' : ''} ${isWhite ? 'chip-white' : ''}`;
      if (swatch.className !== newClassName) {
        swatch.className = newClassName;
      }
      if (swatch.style.backgroundColor !== hex) {
        swatch.style.backgroundColor = hex;
      }
      const title = `#${paletteIndexLabel(idx)} ${hex} ${isAlreadyIn ? '(已在组中，点击移除)' : '(点击加入)'}`;
      if (swatch.title !== title) {
        swatch.title = title;
      }
      const hasCheck = !!swatch.querySelector('.swatch-check');
      if (isAlreadyIn && !hasCheck) {
        swatch.innerHTML = `<span class="swatch-idx">${paletteIndexLabel(idx)}</span><span class="swatch-check">✓</span>`;
      } else if (!isAlreadyIn && hasCheck) {
        swatch.innerHTML = `<span class="swatch-idx">${paletteIndexLabel(idx)}</span>`;
      } else if (!swatch.hasChildNodes()) {
        swatch.innerHTML = `<span class="swatch-idx">${paletteIndexLabel(idx)}</span>${isAlreadyIn ? '<span class="swatch-check">✓</span>' : ''}`;
      }
    }
  }

  private renderColorList(): void {
    if (!this.listEl) return;

    if (!this.vm.session.isLoaded) {
      this.listEl.innerHTML = `<div class="empty-color-hint">请先载入图片以提取画面颜色</div>`;
      this.cardMap.clear();
      return;
    }

    const { pixelIndices, semanticMask, palette, activeZone, lockedMaskZones } = this.state;
    const zoneMeta = ZONE_CONFIG[activeZone];

    // 统计当前 64×64 画面中实际出现的有效色板索引 (0~35，过滤 255 透明)
    const counts = new Map<number, { total: number; inActiveZone: number; locked: number }>();
    for (let i = 0; i < PIXEL_COUNT; i++) {
      const colorIdx = pixelIndices[i];
      if (colorIdx === TRANSPARENT_INDEX || colorIdx < 0 || colorIdx >= palette.length) {
        continue;
      }

      let entry = counts.get(colorIdx);
      if (!entry) {
        entry = { total: 0, inActiveZone: 0, locked: 0 };
        counts.set(colorIdx, entry);
      }
      entry.total++;

      if (semanticMask[i] === activeZone) {
        entry.inActiveZone++;
      }
      if (lockedMaskZones.includes(semanticMask[i])) {
        entry.locked++;
      }
    }

    if (counts.size === 0) {
      this.listEl.innerHTML = `<div class="empty-color-hint">画面中无有效不透明颜色</div>`;
      this.cardMap.clear();
      return;
    }

    // 移除可能存在的空提示
    const hint = this.listEl.querySelector('.empty-color-hint');
    if (hint) {
      hint.remove();
    }

    // 按该颜色在全图中的像素数量从多到少排序
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1].total - a[1].total);

    // 复用卡片 DOM 节点 (最多 36 张)，避免每次整段拼接 innerHTML 导致垃圾回收与重排
    for (let i = 0; i < sorted.length; i++) {
      const [colorIdx, stat] = sorted[i];
      let nodes = this.cardMap.get(colorIdx);
      if (!nodes) {
        const card = document.createElement('div');
        card.className = 'color-mask-card';
        card.setAttribute('data-color-idx', String(colorIdx));
        card.innerHTML = `
          <div class="color-mask-card-left">
            <div class="color-swatch-box"></div>
            <div class="color-meta-info">
              <span class="color-hex-text"></span>
              <span class="color-pixel-count"></span>
            </div>
          </div>
          <div class="color-mask-card-mid">
            <div class="zone-pct-bar-wrap">
              <div class="zone-pct-bar-fill"></div>
            </div>
            <span class="zone-pct-label"></span>
          </div>
          <div class="color-mask-card-right"></div>
        `;
        nodes = {
          card,
          swatch: card.querySelector('.color-swatch-box') as HTMLElement,
          hexText: card.querySelector('.color-hex-text') as HTMLElement,
          countText: card.querySelector('.color-pixel-count') as HTMLElement,
          pctWrap: card.querySelector('.zone-pct-bar-wrap') as HTMLElement,
          pctFill: card.querySelector('.zone-pct-bar-fill') as HTMLElement,
          pctLabel: card.querySelector('.zone-pct-label') as HTMLElement,
          right: card.querySelector('.color-mask-card-right') as HTMLElement,
        };
        this.cardMap.set(colorIdx, nodes);
      }

      const hex = palette[colorIdx] || '#000000';
      const pct = Math.round((stat.inActiveZone / stat.total) * 100);
      const isFull = stat.inActiveZone === stat.total;
      const unassignedCount = stat.total - stat.inActiveZone;
      const allLocked = !isFull && stat.locked >= unassignedCount;

      let cardClass = 'color-mask-card';
      if (isFull) cardClass += ' fully-assigned';
      if (allLocked) cardClass += ' all-locked';
      if (nodes.lastClass !== cardClass) {
        nodes.card.className = cardClass;
        nodes.lastClass = cardClass;
      }

      const title = `点击将 ${unassignedCount} 个像素划入【${zoneMeta.name}】`;
      if (nodes.lastTitle !== title) {
        nodes.card.title = title;
        nodes.lastTitle = title;
      }

      if (nodes.lastHex !== hex) {
        nodes.swatch.style.backgroundColor = hex;
        nodes.swatch.title = `色板 #${colorIdx} (${hex})`;
        nodes.hexText.textContent = hex;
        nodes.lastHex = hex;
      }

      if (nodes.lastTotal !== stat.total) {
        nodes.countText.textContent = `${stat.total} px`;
        nodes.lastTotal = stat.total;
      }

      const pctWrapTitle = `${stat.inActiveZone}/${stat.total} 像素已在当前【${zoneMeta.name}】`;
      if (nodes.pctWrap.title !== pctWrapTitle) {
        nodes.pctWrap.title = pctWrapTitle;
      }
      nodes.pctFill.style.width = `${pct}%`;
      nodes.pctFill.style.backgroundColor = zoneMeta.color;
      nodes.pctLabel.textContent = `${pct}% ${zoneMeta.shortName}`;

      const rightMode = isFull ? 'full' : allLocked ? 'locked' : 'btn';
      if (nodes.lastRightMode !== rightMode) {
        nodes.lastRightMode = rightMode;
        if (isFull) {
          nodes.right.innerHTML = `<span class="badge-fully-assigned">✓ 已全归入</span>`;
        } else if (allLocked) {
          nodes.right.innerHTML = `<span class="badge-locked" title="未划入的像素均位于已锁定分区">🔒 已锁定</span>`;
        } else {
          nodes.right.innerHTML = `<button class="btn-assign-zone" data-color-idx="${colorIdx}" title="划入【${zoneMeta.name}】">+ 划入</button>`;
        }
      }

      // 按排序对齐子节点顺序
      if (this.listEl.children[i] !== nodes.card) {
        this.listEl.insertBefore(nodes.card, this.listEl.children[i] || null);
      }
    }

    // 清理超出当前画面色数的旧节点
    while (this.listEl.children.length > sorted.length) {
      this.listEl.removeChild(this.listEl.lastChild!);
    }
  }

  protected onDispose(): void {
    this.cachedMatchColors = null;
    this.cachedChipsPalette = null;
    this.addSwatchNodes = [];
    this.cardMap.clear();
    this.container.innerHTML = '';
  }
}
