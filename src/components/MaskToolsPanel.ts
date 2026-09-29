/**
 * ImageGem MaskToolsPanel Component (遮罩模式专用左栏工具箱)
 * 包含：
 * 1. 顶部标题与当前分区指示 (头发/皮肤/衣服/眼睛/背景)
 * 2. 遮罩工具选择 (画笔 P / 橡皮 E / 油漆桶 B)
 * 3. 笔刷尺寸切换 (1×1, 2×2, 3×3, 4×4，支持快捷键 [ / ])
 * 4. 方案 A：画面颜色一键转遮罩 (Color-to-Mask Magic)
 *    - 扫描画面实际出现的有效颜色
 *    - 实时显示各颜色当前在目标分区的占比进度条
 *    - 一键批量将该颜色像素赋予当前分区 (严格遵守图层锁定保护)
 */

import { StudioState, ZONE_CONFIG } from '../types';
import { TRANSPARENT_INDEX, MATCH_COLOR_PRESETS } from '../data/palette';

interface MaskToolsPanelCallbacks {
  onSelectMaskTool: (tool: 'pen' | 'eraser' | 'bucket' | 'box_select') => void;
  onSelectBrushSize: (size: 1 | 2 | 3 | 4) => void;
  onSetMatchPreset: (presetKey: string) => void;
  onAddMatchColor: (colorIdx: number) => void;
  onRemoveMatchColor: (colorIdx: number) => void;
  onAssignColorToZone: (colorIdx: number) => void;
  onUndo: () => void;
  onRedo: () => void;
}

export class MaskToolsPanel {
  private container: HTMLElement;
  private callbacks: MaskToolsPanelCallbacks;
  private currentState: StudioState | null = null;
  private isAddPopoverOpen = false;

  constructor(container: HTMLElement, callbacks: MaskToolsPanelCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
  }

  private render(): void {
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

          <!-- 工具选择 (画笔 / 橡皮 / 油漆桶 / 框选) -->
          <div class="tool-picker-group mask-tool-grid">
            <button class="tool-tab-btn active" id="btn-mask-tool-pen" data-tool="pen" title="遮罩画笔 (快捷键: P)">
              <span class="tool-btn-icon">✏️</span>
              <span class="tool-btn-label">画笔</span>
              <kbd class="tool-btn-kbd">P</kbd>
            </button>
            <button class="tool-tab-btn" id="btn-mask-tool-eraser" data-tool="eraser" title="遮罩橡皮 (快捷键: E，擦除为背景 0)">
              <span class="tool-btn-icon">🧼</span>
              <span class="tool-btn-label">橡皮</span>
              <kbd class="tool-btn-kbd">E</kbd>
            </button>
            <button class="tool-tab-btn" id="btn-mask-tool-bucket" data-tool="bucket" title="遮罩油漆桶 (快捷键: B，泛洪填充相邻同分区)">
              <span class="tool-btn-icon">🪣</span>
              <span class="tool-btn-label">油漆桶</span>
              <kbd class="tool-btn-kbd">B</kbd>
            </button>
            <button class="tool-tab-btn" id="btn-mask-tool-select" data-tool="box_select" title="智能框选 (快捷键: S，框选匹配色组快速划入/剔除遮罩)">
              <span class="tool-btn-icon">🔲</span>
              <span class="tool-btn-label">框选</span>
              <kbd class="tool-btn-kbd">S</kbd>
            </button>
          </div>

          <!-- 笔刷尺寸选择 (1px ~ 4px 方形印章) -->
          <div class="brush-size-section" id="brush-size-section">
            <div class="brush-size-header">
              <span class="sub-label">笔刷尺寸</span>
              <span class="sub-hint">快捷键: <kbd>[</kbd> / <kbd>]</kbd></span>
            </div>
            <div class="brush-size-pills" id="brush-size-pills">
              <button class="brush-size-pill active" data-size="1" title="1×1 像素单点精细修边">1×1</button>
              <button class="brush-size-pill" data-size="2" title="2×2 像素发丝与细轮廓">2×2</button>
              <button class="brush-size-pill" data-size="3" title="3×3 像素块面快速铺底">3×3</button>
              <button class="brush-size-pill" data-size="4" title="4×4 像素大面积涂抹">4×4</button>
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
              <div class="match-tip-line">🖱️ <b>左键框选</b>：将框内匹配色划入当前遮罩</div>
              <div class="match-tip-line">🖱️ <b>右键框选</b>：将框内匹配色从遮罩剔除</div>
              <div class="match-sub-tip">💡 在色板点击颜色亦可快速追加，悬停色块点 ✕ 剔除</div>
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

    this.bindEvents();
  }

  private bindEvents(): void {
    // 撤销 / 重做
    const btnUndo = this.container.querySelector('#btn-mask-undo');
    const btnRedo = this.container.querySelector('#btn-mask-redo');
    btnUndo?.addEventListener('click', () => this.callbacks.onUndo());
    btnRedo?.addEventListener('click', () => this.callbacks.onRedo());

    // 工具按钮点击
    const toolBtns = this.container.querySelectorAll<HTMLButtonElement>('.tool-tab-btn[data-tool]');
    toolBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tool = btn.getAttribute('data-tool') as 'pen' | 'eraser' | 'bucket' | 'box_select';
        if (tool) {
          this.callbacks.onSelectMaskTool(tool);
        }
      });
    });

    // 预制色板组下拉切换
    const presetSelect = this.container.querySelector('#select-match-preset') as HTMLSelectElement | null;
    presetSelect?.addEventListener('change', () => {
      if (presetSelect.value !== 'custom') {
        this.callbacks.onSetMatchPreset(presetSelect.value);
      }
    });

    // 关闭添加颜色浮层
    this.container.querySelector('#btn-close-color-picker')?.addEventListener('click', () => {
      this.toggleAddColorPopover(false);
    });

    // 笔刷尺寸药丸点击
    const pillBtns = this.container.querySelectorAll<HTMLButtonElement>('.brush-size-pill[data-size]');
    pillBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const size = parseInt(btn.getAttribute('data-size') || '1', 10) as 1 | 2 | 3 | 4;
        if (size >= 1 && size <= 4) {
          this.callbacks.onSelectBrushSize(size);
        }
      });
    });

    // 颜色卡片点击委托 (画面颜色一键转遮罩)
    const listEl = this.container.querySelector('#color-to-mask-list');
    listEl?.addEventListener('click', (e) => {
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
          this.callbacks.onAssignColorToZone(colorIdx);
        }
      }
    });
  }

  public update(state: StudioState): void {
    this.currentState = state;

    // 1. 更新顶部当前分区指示
    const zoneBadge = this.container.querySelector('#mask-tools-zone-badge') as HTMLElement | null;
    const zoneTag = this.container.querySelector('#color-to-mask-zone-tag') as HTMLElement | null;
    const zoneMeta = ZONE_CONFIG[state.activeZone];

    if (zoneBadge && zoneMeta) {
      zoneBadge.textContent = `● ${zoneMeta.name.split(' ')[0]}`;
      zoneBadge.style.color = zoneMeta.color;
      zoneBadge.style.borderColor = `${zoneMeta.color}66`;
      zoneBadge.style.background = `${zoneMeta.color}18`;
    }

    if (zoneTag && zoneMeta) {
      zoneTag.textContent = `目标: ${zoneMeta.name.split(' ')[0]}`;
      zoneTag.style.color = zoneMeta.color;
      zoneTag.style.borderColor = `${zoneMeta.color}66`;
    }

    // 2. 更新撤销/重做按钮状态
    const btnUndo = this.container.querySelector('#btn-mask-undo') as HTMLButtonElement | null;
    const btnRedo = this.container.querySelector('#btn-mask-redo') as HTMLButtonElement | null;
    if (btnUndo) btnUndo.disabled = state.undoStack.length === 0;
    if (btnRedo) btnRedo.disabled = state.redoStack.length === 0;

    // 3. 更新工具激活高亮
    const activeTool = state.activeMaskTool || 'pen';
    const toolBtns = this.container.querySelectorAll<HTMLButtonElement>('.tool-tab-btn[data-tool]');
    toolBtns.forEach((btn) => {
      const tool = btn.getAttribute('data-tool');
      if (tool === activeTool) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // 4. 智能框选激活时高亮控制卡片
    const boxSelectCard = this.container.querySelector('#mask-box-select-card') as HTMLElement | null;
    if (boxSelectCard) {
      if (activeTool === 'box_select') {
        boxSelectCard.classList.add('tool-active');
      } else {
        boxSelectCard.classList.remove('tool-active');
      }
    }

    // 5. 更新笔刷尺寸激活高亮
    const activeSize = state.maskBrushSize || 1;
    const pillBtns = this.container.querySelectorAll<HTMLButtonElement>('.brush-size-pill[data-size]');
    pillBtns.forEach((btn) => {
      const size = parseInt(btn.getAttribute('data-size') || '1', 10);
      if (size === activeSize) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // 6. 更新预制色板组下拉与匹配色色块
    const presetSelect = this.container.querySelector('#select-match-preset') as HTMLSelectElement | null;
    if (presetSelect && state.maskMatchPresetKey) {
      presetSelect.value = state.maskMatchPresetKey;
    }

    const countTag = this.container.querySelector('#match-color-count-tag') as HTMLElement | null;
    const matchColors = state.maskMatchColors || [];
    if (countTag) {
      countTag.textContent = `${matchColors.length} 色`;
    }

    this.renderMatchChips();
    if (this.isAddPopoverOpen) {
      this.renderAddColorGrid();
    }

    // 7. 更新画面颜色一键转遮罩列表
    this.renderColorList();
  }

  private renderMatchChips(): void {
    const chipsRow = this.container.querySelector('#match-chips-row');
    if (!chipsRow || !this.currentState) return;

    chipsRow.innerHTML = '';
    const matchColors = this.currentState.maskMatchColors || [];
    const palette = this.currentState.palette;

    matchColors.forEach((idx) => {
      const hex = palette[idx] || (idx === 255 ? 'transparent' : '#000000');
      const isWhite = hex.toUpperCase() === '#FFFFFF';
      const isTransparent = idx === 255;
      const chip = document.createElement('div');
      chip.className = `match-color-chip ${isTransparent ? 'chip-transparent' : ''} ${isWhite ? 'chip-white' : ''}`;
      chip.style.backgroundColor = isTransparent ? '' : hex;
      chip.title = `#${idx === 255 ? '透' : idx} ${hex} (点击 ✕ 移除)`;

      chip.innerHTML = `
        <span class="match-chip-index">${idx === 255 ? '透' : idx}</span>
        <button class="match-chip-del-btn" data-color-idx="${idx}" title="从匹配组移除">✕</button>
      `;

      chip.querySelector('.match-chip-del-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onRemoveMatchColor(idx);
      });

      chipsRow.appendChild(chip);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'match-chip-add-btn';
    addBtn.id = 'btn-open-add-color';
    addBtn.type = 'button';
    addBtn.innerHTML = '➕ 添加';
    addBtn.title = '展开色板挑选颜色追加进匹配组';
    addBtn.addEventListener('click', () => {
      this.toggleAddColorPopover();
    });
    chipsRow.appendChild(addBtn);
  }

  private toggleAddColorPopover(show?: boolean): void {
    const popover = this.container.querySelector('#add-color-picker-popover') as HTMLElement | null;
    if (!popover) return;
    this.isAddPopoverOpen = show !== undefined ? show : !this.isAddPopoverOpen;
    popover.style.display = this.isAddPopoverOpen ? 'block' : 'none';
    if (this.isAddPopoverOpen) {
      this.renderAddColorGrid();
    }
  }

  private renderAddColorGrid(): void {
    const grid = this.container.querySelector('#add-color-grid');
    if (!grid || !this.currentState) return;

    grid.innerHTML = '';
    const currentColors = new Set(this.currentState.maskMatchColors || []);

    const allIndices = [...Array.from({ length: 36 }, (_, i) => i), TRANSPARENT_INDEX];
    allIndices.forEach((idx) => {
      const hex = this.currentState!.palette[idx] || (idx === 255 ? 'transparent' : '#000000');
      const isAlreadyIn = currentColors.has(idx);
      const isWhite = hex.toUpperCase() === '#FFFFFF';
      const isTransparent = idx === 255;

      const swatch = document.createElement('div');
      swatch.className = `add-swatch-item ${isAlreadyIn ? 'is-selected' : ''} ${isTransparent ? 'chip-transparent' : ''} ${isWhite ? 'chip-white' : ''}`;
      swatch.style.backgroundColor = isTransparent ? '' : hex;
      swatch.title = `#${idx === 255 ? '透' : idx} ${hex} ${isAlreadyIn ? '(已在组中，点击移除)' : '(点击加入)'}`;

      swatch.innerHTML = `
        <span class="swatch-idx">${idx === 255 ? '透' : idx}</span>
        ${isAlreadyIn ? '<span class="swatch-check">✓</span>' : ''}
      `;

      swatch.addEventListener('click', () => {
        if (isAlreadyIn) {
          this.callbacks.onRemoveMatchColor(idx);
        } else {
          this.callbacks.onAddMatchColor(idx);
        }
      });

      grid.appendChild(swatch);
    });
  }

  private renderColorList(): void {
    const listEl = this.container.querySelector('#color-to-mask-list');
    if (!listEl) return;

    if (!this.currentState || !this.currentState.isLoaded) {
      listEl.innerHTML = `<div class="empty-color-hint">请先载入图片以提取画面颜色</div>`;
      return;
    }

    const { pixelIndices, semanticMask, palette, activeZone, lockedMaskZones = [] } = this.currentState;
    const zoneMeta = ZONE_CONFIG[activeZone];

    // 统计当前 64×64 画面中实际出现的有效色板索引 (0~35，过滤 255 透明)
    const counts = new Map<number, { total: number; inActiveZone: number; locked: number }>();
    for (let i = 0; i < 4096; i++) {
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
      listEl.innerHTML = `<div class="empty-color-hint">画面中无有效不透明颜色</div>`;
      return;
    }

    // 按该颜色在全图中的像素数量从多到少排序
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1].total - a[1].total);

    let html = '';
    for (const [colorIdx, stat] of sorted) {
      const hex = palette[colorIdx] || '#000000';
      const pct = Math.round((stat.inActiveZone / stat.total) * 100);
      const isFull = stat.inActiveZone === stat.total;
      // 若尚未归入该分区的像素全部受到图层锁定保护，则标记为 all-locked
      const unassignedCount = stat.total - stat.inActiveZone;
      const allLocked = !isFull && (stat.locked >= unassignedCount);

      let cardClass = 'color-mask-card';
      if (isFull) cardClass += ' fully-assigned';
      if (allLocked) cardClass += ' all-locked';

      html += `
        <div class="${cardClass}" data-color-idx="${colorIdx}" title="点击将 ${stat.total - stat.inActiveZone} 个像素划入【${zoneMeta.name}】">
          <div class="color-mask-card-left">
            <div class="color-swatch-box" style="background-color: ${hex};" title="色板 #${colorIdx} (${hex})"></div>
            <div class="color-meta-info">
              <span class="color-hex-text">${hex}</span>
              <span class="color-pixel-count">${stat.total} px</span>
            </div>
          </div>

          <div class="color-mask-card-mid">
            <div class="zone-pct-bar-wrap" title="${stat.inActiveZone}/${stat.total} 像素已在当前【${zoneMeta.name}】">
              <div class="zone-pct-bar-fill" style="width: ${pct}%; background-color: ${zoneMeta.color};"></div>
            </div>
            <span class="zone-pct-label">${pct}% ${zoneMeta.name.split(' ')[0]}</span>
          </div>

          <div class="color-mask-card-right">
            ${isFull
              ? `<span class="badge-fully-assigned">✓ 已全归入</span>`
              : allLocked
                ? `<span class="badge-locked" title="未划入的像素均位于已锁定分区">🔒 已锁定</span>`
                : `<button class="btn-assign-zone" data-color-idx="${colorIdx}" title="划入【${zoneMeta.name}】">+ 划入</button>`
            }
          </div>
        </div>
      `;
    }

    listEl.innerHTML = html;
  }
}
