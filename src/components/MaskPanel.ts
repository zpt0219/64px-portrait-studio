/**
 * ImageGem MaskPanel Component (右列：遮罩微调与发色置换)
 * 专注 5 分区遮罩画刷选择与像素统计、遮罩覆盖层透明度与显隐控制、9 大经典二次元发色预设置换
 */

import { StudioState, SemanticZone, ZONE_CONFIG } from '../types';
import { RAMPS_INFO } from '../data/palette';

export interface MaskPanelCallbacks {
  onSelectZone: (zone: SemanticZone, solo?: boolean) => void;
  onToggleZoneVisibility: (zone: SemanticZone, visible: boolean) => void;
  onSetAllZonesVisibility: (visible: boolean) => void;
  onToggleLockZone: (zone: SemanticZone) => void;
  onMaskOpacityChange: (opacity: number) => void;
  onToggleMaskVisibility?: (show: boolean) => void;
  onApplyHairPreset: (presetKey: string) => void;
  onOpenHairModal?: () => void;
  onRecomputeSemanticMask: () => void;
  onActivate: () => void;
}

export class MaskPanel {
  private container: HTMLElement;
  private callbacks: MaskPanelCallbacks;
  private draftHairPreset: string | null = null;
  private lastState: StudioState | null = null;

  constructor(container: HTMLElement, callbacks: MaskPanelCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
  }

  private render(): void {
    this.container.innerHTML = `
      <aside class="column-sidebar mask-sidebar-inner">
        <div class="panel-section">
          <!-- 标题与状态反馈 -->
          <div class="section-header">
            <div class="section-title-group">
              <span class="section-title">🎭 5 分区语义遮罩</span>
              <span class="panel-active-badge" id="mask-active-badge">● 绘制中</span>
            </div>
          </div>

          <!-- 遮罩半透明度与操作提示 -->
          <div class="mask-display-card">
            <div class="mask-shortcuts-tip">
              <span class="tip-badge">🖱️ <b>左键</b> 涂抹遮罩</span>
              <span class="tip-divider">·</span>
              <span class="tip-badge">🖱️ <b>右键</b> 逐点删除</span>
            </div>

            <div class="slider-control-group">
              <div class="slider-label-row">
                <span class="sub-label">遮罩半透明度:</span>
                <span class="slider-value-text" id="mask-opacity-text">50%</span>
              </div>
              <input type="range" id="slider-mask-opacity" min="0" max="100" value="50" step="5">
            </div>
          </div>

          <!-- 5 分区笔刷选择与统计 -->
          <div class="section-sub-header">
            <span class="sub-label">遮罩显隐多选与笔刷 (快捷键 0~4)</span>
            <div class="zone-quick-actions">
              <button class="btn-xs-link" id="btn-mask-select-all" title="显示全部 5 个遮罩图层">全选</button>
              <button class="btn-xs-link" id="btn-mask-select-none" title="隐藏全部遮罩图层">清空</button>
            </div>
          </div>
          <div class="zone-selector-list" id="zone-list">
            <!-- 5 分区项动态注入 -->
          </div>

          <!-- 语义智能重识别 -->
          <div class="recompute-box">
            <button class="btn btn-outline btn-block" id="btn-recompute-mask" title="基于当前画布像素重新运行几何门禁与语义识别">
              <span>✨ 重新识别语义遮罩</span>
            </button>
            <div class="help-text">在像素修图后，可点击一键重新提取 5 分区语义遮罩（不影响画面已有像素）</div>
          </div>

          <div class="panel-divider"></div>

          <!-- 9 大经典二次元发色预设置换 -->
          <div class="section-header">
            <span class="section-title">💇 头发 9 大预设发色置换</span>
          </div>
          <div class="help-text">仅针对 Hair 分区像素，根据相对明暗保留立体光影与褶皱高光。</div>

          <div class="hair-presets-grid" id="hair-presets-grid">
            <!-- 9 发色卡片动态注入 -->
          </div>

          <!-- 发色预览操作入口：有未固化试色预览时显示，点击唤起居中弹窗确认 -->
          <div class="hair-action-box" id="hair-action-box" style="margin-top: 10px; display: none;">
            <button class="btn btn-primary btn-block" id="btn-hair-open-modal" title="弹出窗口固化或还原发色">
              ✨ 固化 / 还原当前发色...
            </button>
          </div>
        </div>
      </aside>
    `;

    this.setupEvents();
  }

  private setupEvents(): void {
    // 遮罩透明度滑杆
    const opacitySlider = this.container.querySelector('#slider-mask-opacity') as HTMLInputElement;
    opacitySlider?.addEventListener('input', (e) => {
      const val = parseInt((e.target as HTMLInputElement).value, 10);
      const opacityText = this.container.querySelector('#mask-opacity-text');
      if (opacityText) opacityText.textContent = `${val}%`;
      this.callbacks.onMaskOpacityChange(val / 100);
    });
    opacitySlider?.addEventListener('change', () => {
      opacitySlider.blur();
    });

    // 全选 / 清空遮罩显隐
    const btnSelectAll = this.container.querySelector('#btn-mask-select-all');
    btnSelectAll?.addEventListener('click', () => {
      this.callbacks.onSetAllZonesVisibility(true);
    });

    const btnSelectNone = this.container.querySelector('#btn-mask-select-none');
    btnSelectNone?.addEventListener('click', () => {
      this.callbacks.onSetAllZonesVisibility(false);
    });

    // 重新识别语义遮罩
    this.container.querySelector('#btn-recompute-mask')?.addEventListener('click', () => {
      this.callbacks.onRecomputeSemanticMask();
    });

    // 发色草稿：点击打开居中确认弹窗
    this.container.querySelector('#btn-hair-open-modal')?.addEventListener('click', () => {
      this.callbacks.onOpenHairModal?.();
    });
  }

  public update(state: StudioState): void {
    this.lastState = state;

    // 1. 活跃状态指示徽章
    const isMaskActive = state.activeMode === 'mask';
    const activeBadge = this.container.querySelector('#mask-active-badge') as HTMLElement;
    if (activeBadge) {
      activeBadge.style.display = isMaskActive ? 'inline-flex' : 'none';
    }

    const panelEl = this.container.querySelector('.mask-sidebar-inner') as HTMLElement;
    if (panelEl) {
      if (isMaskActive) {
        panelEl.classList.add('mode-active');
      } else {
        panelEl.classList.remove('mode-active');
      }
    }

    // 3. 更新透明度滑杆显示
    const opacitySlider = this.container.querySelector('#slider-mask-opacity') as HTMLInputElement;
    const opacityText = this.container.querySelector('#mask-opacity-text');
    const opacityPct = Math.round(state.maskOpacity * 100);
    if (opacitySlider && parseInt(opacitySlider.value, 10) !== opacityPct) {
      opacitySlider.value = opacityPct.toString();
    }
    if (opacityText) {
      opacityText.textContent = `${opacityPct}%`;
    }

    // 4. 计算 5 分区像素统计
    const zoneCounts: Record<number, number> = {
      [SemanticZone.Background]: 0,
      [SemanticZone.Hair]: 0,
      [SemanticZone.Skin]: 0,
      [SemanticZone.Eyes]: 0,
      [SemanticZone.Clothes]: 0,
    };

    for (let i = 0; i < 4096; i++) {
      const z = state.semanticMask[i];
      if (zoneCounts[z] !== undefined) {
        zoneCounts[z]++;
      }
    }

    // 5. 渲染 5 分区画刷选择、上锁与删除列表
    const zoneList = this.container.querySelector('#zone-list');
    if (zoneList) {
      zoneList.innerHTML = '';
      const zones = [
        SemanticZone.Hair,
        SemanticZone.Skin,
        SemanticZone.Eyes,
        SemanticZone.Clothes,
        SemanticZone.Background,
      ];

      const visibleSet = new Set(state.visibleMaskZones ?? [SemanticZone.Hair]);
      const lockedSet = new Set(state.lockedMaskZones || []);

      zones.forEach((zone) => {
        const meta = ZONE_CONFIG[zone];
        const count = zoneCounts[zone] || 0;
        const isActive = isMaskActive && state.activeZone === zone;
        const isChecked = visibleSet.has(zone);
        const isLocked = lockedSet.has(zone);

        const card = document.createElement('div');
        card.className = `zone-card ${isActive ? 'active' : ''} ${isLocked ? 'is-locked' : ''}`;
        card.style.borderLeftColor = meta.color;
        card.title = isLocked
          ? `【已锁定】${meta.name} 遮罩受保护，不可被涂抹或右键擦除 (点击可切换选中)`
          : `点击选择 ${meta.name} 画刷 (🖱️ 左键涂抹 · 🖱️ 右键逐点删除)`;

        // 对于明度较高的高亮色（发色电光青 #00E5FF、衣服金黄 #FFD600），使用黑字对勾更清晰
        const isLightZone = zone === SemanticZone.Clothes || zone === SemanticZone.Hair;
        const checkColor = isLightZone ? '#000000' : '#FFFFFF';
        const checkBg = isChecked ? meta.color : 'transparent';
        const checkBorder = isChecked ? meta.color : 'rgba(255, 255, 255, 0.3)';

        card.innerHTML = `
          <label class="zone-checkbox-wrap" title="多选：勾选以在画布上显示此遮罩">
            <input type="checkbox" class="zone-checkbox" ${isChecked ? 'checked' : ''} />
            <span class="zone-checkmark" style="background-color: ${checkBg}; border-color: ${checkBorder};">
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="${checkColor}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="display: ${isChecked ? 'block' : 'none'};">
                <polyline points="3 8.5 6.5 12 13 4.5"></polyline>
              </svg>
            </span>
          </label>
          <div class="zone-card-main">
            <span class="zone-color-indicator" style="background-color: ${meta.color};"></span>
            <span class="zone-name">${meta.name}</span>
            <span class="zone-hotkey">[${meta.hotkey}]</span>
          </div>
          <div class="zone-card-right">
            <span class="zone-stat"><b>${count}</b> px</span>
            ${zone !== SemanticZone.Background ? `
            <button class="zone-action-btn zone-lock-btn ${isLocked ? 'locked' : ''}" title="${isLocked ? '已锁定：此分区受保护，不可被其他遮罩涂抹或右键擦除 (点击解锁)' : '未锁定：点击锁定此分区以防被误改或右键擦除'}">
              ${isLocked ? '🔒' : '🔓'}
            </button>` : ''}
          </div>
        `;

        // 阻止 checkbox-wrap 点击向卡片主体冒泡
        const checkboxWrap = card.querySelector('.zone-checkbox-wrap');
        checkboxWrap?.addEventListener('click', (e) => {
          e.stopPropagation();
        });

        const checkbox = card.querySelector('.zone-checkbox') as HTMLInputElement;
        checkbox?.addEventListener('change', (e) => {
          e.stopPropagation();
          this.callbacks.onToggleZoneVisibility(zone, checkbox.checked);
        });

        // 锁定按钮点击
        const lockBtn = card.querySelector('.zone-lock-btn');
        lockBtn?.addEventListener('click', (e) => {
          e.stopPropagation();
          this.callbacks.onToggleLockZone(zone);
        });

        // 卡片主体点击：激活画刷
        card.addEventListener('click', () => {
          this.callbacks.onActivate();
          this.callbacks.onSelectZone(zone);
        });

        zoneList.appendChild(card);
      });
    }

    // 5.5 更新发色操作入口显隐
    const actionBox = this.container.querySelector('#hair-action-box') as HTMLElement;
    if (actionBox) {
      actionBox.style.display = this.draftHairPreset ? 'block' : 'none';
    }

    // 6. 渲染 9 大发色预设卡片 (支持未固化预览态与固化状态区分)
    const hairGrid = this.container.querySelector('#hair-presets-grid');
    if (hairGrid) {
      hairGrid.innerHTML = '';
      Object.entries(RAMPS_INFO).forEach(([key, info]) => {
        const isCommitted = state.currentHairPreset === key;
        const isDraft = this.draftHairPreset === key;
        const isActive = isDraft || (isCommitted && !this.draftHairPreset);
        const card = document.createElement('div');
        card.className = `hair-preset-card ${isActive ? 'active' : ''} ${isDraft ? 'previewing' : ''}`;
        card.title = isDraft
          ? `当前正在预览: ${info.name} (点击可打开固化/还原弹窗)`
          : (isCommitted ? `已固化发色: ${info.name}` : `置换发色为: ${info.name}`);

        const rampChips = info.hexes
          .map((h) => `<span class="ramp-chip" style="background-color: ${h};"></span>`)
          .join('');

        let badgeHtml = '';
        if (isDraft) {
          badgeHtml = '<span class="preset-badge badge-preview">预览中</span>';
        } else if (isCommitted) {
          badgeHtml = '<span class="preset-badge">已固化</span>';
        }

        card.innerHTML = `
          <div class="preset-header">
            <span class="preset-icon">${info.icon}</span>
            <span class="preset-name">${info.name}</span>
            ${badgeHtml}
          </div>
          <div class="preset-ramp-row">
            ${rampChips}
          </div>
        `;

        card.addEventListener('click', () => {
          if (isDraft) {
            // 点击正在预览中的发色卡片，唤起居中弹窗确认固化或还原
            this.callbacks.onOpenHairModal?.();
          } else {
            this.callbacks.onApplyHairPreset(key);
          }
        });

        hairGrid.appendChild(card);
      });
    }
  }

  public setHairDraft(draftKey: string | null): void {
    this.draftHairPreset = draftKey;
    if (this.lastState) {
      this.update(this.lastState);
    }
  }
}

