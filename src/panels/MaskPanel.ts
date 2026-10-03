/**
 * 右栏：5 分区遮罩列表 (显隐 / 锁定 / 像素统计)、遮罩透明度、重新识别、9 大发色预设置换
 */

import { SemanticZone, ZONE_CONFIG, ALL_ZONES } from '../types';
import { RAMPS_INFO } from '../data/palette';
import { PIXEL_COUNT } from '../core/pixelGrid';
import { ViewModel } from '../app/viewModel';
import { Panel } from './Panel';

export class MaskPanel extends Panel {
  // Cached DOM elements
  private activeBadge!: HTMLElement | null;
  private panelEl!: HTMLElement | null;
  private opacitySlider!: HTMLInputElement | null;
  private opacityText!: HTMLElement | null;
  private actionBox!: HTMLElement | null;
  private zoneListEl!: HTMLElement | null;
  private hairGridEl!: HTMLElement | null;

  // Cached cards
  private zoneCardElements = new Map<
    SemanticZone,
    {
      card: HTMLElement;
      checkbox: HTMLInputElement;
      checkmark: HTMLElement;
      checkSvg: HTMLElement;
      countEl: HTMLElement;
      lockBtn: HTMLButtonElement | null;
      checkColor: string;
      metaColor: string;
      metaName: string;
    }
  >();

  private hairPresetCardElements = new Map<
    string,
    {
      card: HTMLElement;
      badgeWrap: HTMLElement;
      name: string;
    }
  >();
  private hairSectionEl: HTMLElement | null = null;

  constructor(private readonly container: HTMLElement, vm: ViewModel) {
    super(vm);
    this.build();
    this.markDirty();
  }

  onSessionChanged(): void {
    this.markDirty();
  }
  onMaskChanged(): void {
    this.markDirty();
  }
  onHairPresetChanged(): void {
    this.markDirty();
  }
  onDocumentReplaced(): void {
    this.markDirty();
  }

  private build(): void {
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
            <!-- 5 分区项在 buildStaticCards 中初始化 -->
          </div>

          <!-- 语义智能重识别 -->
          <div class="recompute-box">
            <button class="btn btn-outline btn-block" id="btn-recompute-mask" title="基于当前画布像素重新运行几何门禁与语义识别">
              <span>✨ 重新识别语义遮罩</span>
            </button>
            <div class="help-text">在像素修图后，可点击一键重新提取 5 分区语义遮罩（不影响画面已有像素）</div>
          </div>

          <!-- 9 大经典二次元发色预设置换 (默认隐藏，仅当选了头发mask时显示) -->
          <div class="hair-recolor-section" id="hair-recolor-section" style="display: none;">
            <div class="panel-divider"></div>

            <div class="section-header">
              <span class="section-title">💇 头发 9 大预设发色置换</span>
            </div>
            <div class="help-text">仅针对 Hair 分区像素，根据相对明暗保留立体光影与褶皱高光。</div>

            <div class="hair-presets-grid" id="hair-presets-grid">
              <!-- 9 发色卡片在 buildStaticCards 中初始化 -->
            </div>

            <!-- 发色预览操作入口：有未固化试色预览时显示，点击唤起居中弹窗确认 -->
            <div class="hair-action-box" id="hair-action-box" style="margin-top: 10px; display: none;">
              <button class="btn btn-primary btn-block" id="btn-hair-open-modal" title="弹出窗口固化或还原发色">
                ✨ 固化 / 还原当前发色...
              </button>
            </div>
          </div>
        </div>
      </aside>
    `;

    this.cacheDomReferences();
    this.buildStaticCards();
    this.setupEvents();
  }

  private cacheDomReferences(): void {
    const q = <T extends HTMLElement>(sel: string) => this.container.querySelector<T>(sel);
    this.activeBadge = q('#mask-active-badge');
    this.panelEl = q('.mask-sidebar-inner');
    this.opacitySlider = q<HTMLInputElement>('#slider-mask-opacity');
    this.opacityText = q('#mask-opacity-text');
    this.actionBox = q('#hair-action-box');
    this.zoneListEl = q('#zone-list');
    this.hairGridEl = q('#hair-presets-grid');
    this.hairSectionEl = q('#hair-recolor-section');
  }

  private buildStaticCards(): void {
    // 1. 初始化 5 分区静态卡片
    if (this.zoneListEl) {
      this.zoneListEl.innerHTML = '';
      this.zoneCardElements.clear();

      ALL_ZONES.forEach((zone) => {
        const meta = ZONE_CONFIG[zone];
        const isLightZone = zone === SemanticZone.Clothes || zone === SemanticZone.Hair;
        const checkColor = isLightZone ? '#000000' : '#FFFFFF';

        const card = document.createElement('div');
        card.className = 'zone-card';
        card.dataset.zone = String(zone);
        card.style.borderLeftColor = meta.color;

        card.innerHTML = `
          <label class="zone-checkbox-wrap" title="多选：勾选以在画布上显示此遮罩">
            <input type="checkbox" class="zone-checkbox" checked />
            <span class="zone-checkmark">
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="${checkColor}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
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
            <span class="zone-stat"><b class="zone-count-val">0</b> px</span>
            ${zone !== SemanticZone.Background ? `
            <button class="zone-action-btn zone-lock-btn">
              🔓
            </button>` : ''}
          </div>
        `;

        this.zoneListEl!.appendChild(card);

        const checkbox = card.querySelector<HTMLInputElement>('.zone-checkbox')!;
        const checkmark = card.querySelector<HTMLElement>('.zone-checkmark')!;
        const checkSvg = card.querySelector<HTMLElement>('svg')!;
        const countEl = card.querySelector<HTMLElement>('.zone-count-val')!;
        const lockBtn = card.querySelector<HTMLButtonElement>('.zone-lock-btn');

        this.zoneCardElements.set(zone, {
          card,
          checkbox,
          checkmark,
          checkSvg,
          countEl,
          lockBtn,
          checkColor,
          metaColor: meta.color,
          metaName: meta.name,
        });
      });
    }

    // 2. 初始化 9 大发色预设卡片
    if (this.hairGridEl) {
      this.hairGridEl.innerHTML = '';
      this.hairPresetCardElements.clear();

      Object.entries(RAMPS_INFO).forEach(([key, info]) => {
        const card = document.createElement('div');
        card.className = 'hair-preset-card';
        card.dataset.preset = key;

        const rampChips = info.hexes
          .map((h) => `<span class="ramp-chip" style="background-color: ${h};"></span>`)
          .join('');

        card.innerHTML = `
          <div class="preset-header">
            <span class="preset-icon">${info.icon}</span>
            <span class="preset-name">${info.name}</span>
            <span class="preset-badge-wrap"></span>
          </div>
          <div class="preset-ramp-row">
            ${rampChips}
          </div>
        `;

        this.hairGridEl!.appendChild(card);

        const badgeWrap = card.querySelector<HTMLElement>('.preset-badge-wrap')!;
        this.hairPresetCardElements.set(key, {
          card,
          badgeWrap,
          name: info.name,
        });
      });
    }
  }

  private setupEvents(): void {
    // 遮罩透明度滑杆
    this.opacitySlider?.addEventListener('input', (e) => {
      const val = parseInt((e.target as HTMLInputElement).value, 10);
      if (this.opacityText) this.opacityText.textContent = `${val}%`;
      this.vm.setMaskOpacity(val / 100);
    });
    this.opacitySlider?.addEventListener('change', () => {
      this.opacitySlider?.blur();
    });

    // 全选 / 清空遮罩显隐
    this.container.querySelector('#btn-mask-select-all')?.addEventListener('click', () => {
      this.vm.setAllZonesVisibility(true);
    });

    this.container.querySelector('#btn-mask-select-none')?.addEventListener('click', () => {
      this.vm.setAllZonesVisibility(false);
    });

    // 重新识别语义遮罩
    this.container.querySelector('#btn-recompute-mask')?.addEventListener('click', () => {
      this.vm.recomputeSemanticMask();
    });

    // 分区卡片：勾选框控制显隐，锁按钮切换锁定，点击卡片其余部分选择画刷
    const zoneList = this.zoneListEl;
    const cardZone = (e: Event) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.zone-card');
      return card ? (Number(card.dataset.zone) as SemanticZone) : null;
    };
    zoneList?.addEventListener('change', (e) => {
      const zone = cardZone(e);
      const checkbox = e.target as HTMLInputElement;
      if (zone !== null && checkbox.classList.contains('zone-checkbox')) {
        this.vm.toggleZoneVisibility(zone, checkbox.checked);
        if (checkbox.checked) {
          this.vm.setActiveZone(zone);
        }
      }
    });
    zoneList?.addEventListener('click', (e) => {
      const zone = cardZone(e);
      const target = e.target as HTMLElement;
      if (zone === null || target.closest('.zone-checkbox-wrap')) return;
      if (target.closest('.zone-lock-btn')) {
        this.vm.toggleLockZone(zone);
      } else {
        this.vm.setActiveZone(zone);
      }
    });

    // 发色预设卡片：点击预览；点击正在预览的卡片则打开固化/还原弹窗
    this.hairGridEl?.addEventListener('click', (e) => {
      const key = (e.target as HTMLElement).closest<HTMLElement>('.hair-preset-card')?.dataset.preset;
      if (!key) return;
      if (key === this.vm.session.hairDraftPreset) this.vm.openHairRecolorPrompt();
      else this.vm.applyHairPreset(key);
    });

    // 发色草稿：点击打开居中确认弹窗
    this.container.querySelector('#btn-hair-open-modal')?.addEventListener('click', () => {
      this.vm.openHairRecolorPrompt();
    });
  }

  render(): void {
    const state = { ...this.vm.session, ...this.vm.doc };
    const draftHairPreset = state.hairDraftPreset;

    // 1. 活跃状态指示徽章
    const isMaskActive = state.activeMode === 'mask';
    if (this.activeBadge) {
      this.activeBadge.style.display = isMaskActive ? 'inline-flex' : 'none';
    }

    if (this.panelEl) {
      this.panelEl.classList.toggle('mode-active', isMaskActive);
    }

    // 3. 更新透明度滑杆显示
    const opacityPct = Math.round(state.maskOpacity * 100);
    if (this.opacitySlider && parseInt(this.opacitySlider.value, 10) !== opacityPct) {
      this.opacitySlider.value = opacityPct.toString();
    }
    if (this.opacityText) {
      this.opacityText.textContent = `${opacityPct}%`;
    }

    // 4. 计算 5 分区像素统计
    const zoneCounts: Record<number, number> = {
      [SemanticZone.Background]: 0,
      [SemanticZone.Hair]: 0,
      [SemanticZone.Skin]: 0,
      [SemanticZone.Eyes]: 0,
      [SemanticZone.Clothes]: 0,
    };

    for (let i = 0; i < PIXEL_COUNT; i++) {
      const z = state.semanticMask[i];
      if (zoneCounts[z] !== undefined) {
        zoneCounts[z]++;
      }
    }

    // 5. 原地修补 5 分区画刷选择、上锁与统计 (零 innerHTML 重建)
    const visibleSet = new Set(state.visibleMaskZones);
    const lockedSet = new Set(state.lockedMaskZones);

    this.zoneCardElements.forEach((cached, zone) => {
      const count = zoneCounts[zone] || 0;
      const isActive = isMaskActive && state.activeZone === zone;
      const isChecked = visibleSet.has(zone);
      const isLocked = lockedSet.has(zone);

      cached.card.className = `zone-card ${isActive ? 'active' : ''} ${isLocked ? 'is-locked' : ''}`;
      cached.card.title = isLocked
        ? `【已锁定】${cached.metaName} 遮罩受保护，不可被涂抹或右键擦除 (点击可切换选中)`
        : `点击选择 ${cached.metaName} 画刷 (🖱️ 左键涂抹 · 🖱️ 右键逐点删除)`;

      cached.checkbox.checked = isChecked;
      cached.checkmark.style.backgroundColor = isChecked ? cached.metaColor : 'transparent';
      cached.checkmark.style.borderColor = isChecked ? cached.metaColor : 'rgba(255, 255, 255, 0.3)';
      cached.checkSvg.style.display = isChecked ? 'block' : 'none';

      cached.countEl.textContent = String(count);

      if (cached.lockBtn) {
        cached.lockBtn.className = `zone-action-btn zone-lock-btn ${isLocked ? 'locked' : ''}`;
        cached.lockBtn.textContent = isLocked ? '🔒' : '🔓';
        cached.lockBtn.title = isLocked
          ? '已锁定：此分区受保护，不可被其他遮罩涂抹或右键擦除 (点击解锁)'
          : '未锁定：点击锁定此分区以防被误改或右键擦除';
      }
    });

    // 5.4 9 大预设发色显隐：默认不显示，只有选了头发 (Hair) 遮罩时才显示
    const isHairMaskSelected = isMaskActive && state.activeZone === SemanticZone.Hair && visibleSet.has(SemanticZone.Hair);
    if (this.hairSectionEl) {
      this.hairSectionEl.style.display = isHairMaskSelected ? 'block' : 'none';
    }

    // 5.5 更新发色操作入口显隐
    if (this.actionBox) {
      this.actionBox.style.display = draftHairPreset ? 'block' : 'none';
    }

    // 6. 原地修补 9 大发色预设卡片 (零 innerHTML 重建)
    this.hairPresetCardElements.forEach((cached, key) => {
      const isCommitted = state.currentHairPreset === key;
      const isDraft = draftHairPreset === key;
      const isActive = isDraft || (isCommitted && !draftHairPreset);

      cached.card.className = `hair-preset-card ${isActive ? 'active' : ''} ${isDraft ? 'previewing' : ''}`;
      cached.card.title = isDraft
        ? `当前正在预览: ${cached.name} (点击可打开固化/还原弹窗)`
        : (isCommitted ? `已固化发色: ${cached.name}` : `置换发色为: ${cached.name}`);

      if (isDraft) {
        cached.badgeWrap.innerHTML = '<span class="preset-badge badge-preview">预览中</span>';
      } else if (isCommitted) {
        cached.badgeWrap.innerHTML = '<span class="preset-badge">已固化</span>';
      } else {
        cached.badgeWrap.innerHTML = '';
      }
    });
  }
}


