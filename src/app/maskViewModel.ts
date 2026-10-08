import { SemanticZone, RectSelection, MaskTool, BrushSize, HairPresetKey } from '../core/types';
import { EditorSession } from '../core/session';
import {
  ZONE_CONFIG,
  ALL_ZONES,
  MATCH_COLOR_PRESETS,
  ZONE_DEFAULT_MATCH_PRESET,
  RAMPS_INFO,
  isHairPresetKey,
  TRANSPARENT_INDEX,
} from '../core/constants';
import { recolorHair } from '../core/recolorEngine';
import { computeSemanticMask } from '../core/segmentation';
import { Rgb, hexToRgb, findNearestColor } from '../utils/colorUtils';
import { MaskBoxSelectCommand, AssignColorToZoneCommand, SetMaskCommand } from '../command/maskCommands';
import { CommitHairRecolorCommand, SetHairPresetCommand } from '../command/paletteCommands';
import { SubViewModel, StudioContext } from './subViewModel';

export class MaskViewModel implements SubViewModel {
  // 试色草稿状态追踪
  private initialPixels: Uint8Array | null = null;
  private initialHairPreset: HairPresetKey | null = null;
  private trialHairPreset: HairPresetKey | null = null;
  private hasHairTrial = false;

  constructor(private readonly ctx: StudioContext) {}

  // ===================== 试色状态与决策 =====================

  get hasPendingHairTrial(): boolean {
    if (!this.hasHairTrial || !this.trialHairPreset) return false;
    return this.ctx.doc.currentHairPreset !== this.initialHairPreset;
  }

  hasHairDraft(): boolean {
    return this.hasPendingHairTrial;
  }

  hairDraftName(): string {
    return this.trialHairPreset ? (RAMPS_INFO[this.trialHairPreset]?.name || '') : '';
  }

  private commitHairTrial(): void {
    this.hasHairTrial = false;
    this.initialPixels = null;
    this.initialHairPreset = null;
    this.trialHairPreset = null;
  }

  private revertHairTrial(): void {
    if (this.initialPixels) {
      this.ctx.execute(new CommitHairRecolorCommand(this.initialPixels, this.initialHairPreset));
    }
    this.hasHairTrial = false;
    this.initialPixels = null;
    this.initialHairPreset = null;
    this.trialHairPreset = null;
    this.ctx.notify('已放弃发色替换，恢复原样');
  }

  discardHairRecolor(): void {
    this.revertHairTrial();
  }

  openHairRecolorPrompt(): void {
    if (!this.hasPendingHairTrial) return;
    const draftName = this.hairDraftName();
    this.ctx.confirm({
      icon: '💇',
      title: '切换至画板模式前发色确认',
      message: `当前正在试色新发色【${draftName}】，尚未固化到画面。`,
      subMessage: '请选择是否将此发色替换应用到画面中：',
      buttons: [
        { label: '✓ 确认替换', className: 'btn-primary', onClick: () => this.commitHairTrial() },
        { label: '✕ 放弃替换', className: 'btn-danger', onClick: () => this.revertHairTrial() },
        { label: '继续试色', className: 'btn-ghost', onClick: () => {} },
      ],
    });
  }

  // ===================== 生命周期与清理 =====================

  canExit(callback: (allowed: boolean) => void): void {
    if (!this.hasPendingHairTrial) {
      callback(true);
      return;
    }

    const draftName = this.hairDraftName();
    this.ctx.confirm({
      icon: '💇',
      title: '切换至画板模式前发色确认',
      message: `当前正在试色新发色【${draftName}】，尚未固化到画面。`,
      subMessage: '切换到画板模式前，请选择是否将此发色替换应用到画面中：',
      buttons: [
        {
          label: '✓ 确认替换并切换',
          className: 'btn-primary',
          onClick: () => {
            this.commitHairTrial();
            callback(true);
          },
        },
        {
          label: '✕ 放弃替换并切换',
          className: 'btn-danger',
          onClick: () => {
            this.revertHairTrial();
            callback(true);
          },
        },
        {
          label: '继续试色',
          className: 'btn-ghost',
          onClick: () => {
            callback(false);
          },
        },
      ],
      onDismiss: () => {
        callback(false);
      },
    });
  }

  cleanup(): void {
    this.ctx.endStroke();
    // 强制清理：退出遮罩模式时必须关闭遮罩半透明覆盖层，将纯净像素画布留给绘图模式
    this.ctx.patchSession({
      showMaskOverlay: false,
    });
  }

  enter(): void {
    const changes: Partial<EditorSession> = {
      activeMode: 'mask',
      selection: null,
    };
    if (!this.ctx.session.maskMatchInitialized) {
      changes.maskMatchInitialized = true;
      if (!changes.visibleMaskZones) {
        changes.visibleMaskZones = [...ALL_ZONES];
      }
      changes.showMaskOverlay = changes.visibleMaskZones.length > 0;
      const targetZone = changes.activeZone ?? this.ctx.session.activeZone;
      if (targetZone !== null) {
        this.applyZoneDefaultMatchPreset(targetZone, changes);
      }
    } else {
      // 重新进入遮罩模式：恢复遮罩覆盖层显示
      changes.showMaskOverlay = this.ctx.session.visibleMaskZones.length > 0;
    }
    this.ctx.patchSession(changes);
    this.ctx.notify('🎭 已切换至【语义遮罩模式】(快捷键: W)');

    // 重新开启一次全新的遮罩试色基准
    this.hasHairTrial = false;
    this.initialPixels = null;
    this.initialHairPreset = this.ctx.doc.currentHairPreset;
    this.trialHairPreset = null;
  }

  private applyZoneDefaultMatchPreset(zone: SemanticZone, changes: Partial<EditorSession>): void {
    const presetId = ZONE_DEFAULT_MATCH_PRESET[zone] || 'all_colors';
    const preset = MATCH_COLOR_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    changes.maskMatchPresetKey = preset.id;
    changes.maskMatchColors = preset.getIndices(this.ctx.doc.palette, this.ctx.doc.currentHairPreset);
  }

  // ===================== 遮罩与分区 =====================

  setActiveZone(zone: SemanticZone, solo = true): void {
    const changes: Partial<EditorSession> = { activeZone: zone };
    if (solo) {
      changes.visibleMaskZones = [zone];
      changes.showMaskOverlay = true;
    } else if (!this.ctx.session.visibleMaskZones.includes(zone)) {
      changes.visibleMaskZones = [...this.ctx.session.visibleMaskZones, zone];
      changes.showMaskOverlay = true;
    }

    if (this.ctx.session.activeMode !== 'mask') {
      changes.activeMode = 'mask';
      changes.selection = null;
    }

    const currentPresetKey = this.ctx.session.maskMatchPresetKey;
    if (currentPresetKey && currentPresetKey !== 'custom') {
      const preset = MATCH_COLOR_PRESETS.find((p) => p.id === currentPresetKey);
      if (preset) {
        this.applyZoneDefaultMatchPreset(zone, changes);
      }
    }

    this.ctx.patchSession(changes);
    this.ctx.notify(`🎭 目标遮罩: 【${ZONE_CONFIG[zone].name}】 (快捷键: ${ZONE_CONFIG[zone].hotkey})`);
  }

  toggleZoneVisibility(zone: SemanticZone, visible: boolean): void {
    const current = new Set(this.ctx.session.visibleMaskZones);
    if (visible) current.add(zone);
    else current.delete(zone);
    const visibleMaskZones = ALL_ZONES.filter((z) => current.has(z));
    const showMaskOverlay = visibleMaskZones.length > 0;

    this.ctx.patchSession({ visibleMaskZones, showMaskOverlay });

    if (visibleMaskZones.length === 0 && this.ctx.session.activeMode === 'mask') {
      this.ctx.setMode('pixel');
    }
  }

  setAllZonesVisibility(visible: boolean): void {
    const visibleMaskZones = visible ? [...ALL_ZONES] : [];
    const showMaskOverlay = visible;

    this.ctx.patchSession({ visibleMaskZones, showMaskOverlay });
    if (!visible) {
      this.ctx.notify('已隐藏全部遮罩图层');
      if (this.ctx.session.activeMode === 'mask') {
        this.ctx.setMode('pixel');
      }
    } else {
      this.ctx.notify(`已显示全部 ${ALL_ZONES.length} 个遮罩图层`);
    }
  }

  toggleLockZone(zone: SemanticZone): void {
    const current = new Set(this.ctx.session.lockedMaskZones);
    if (current.has(zone)) {
      current.delete(zone);
      this.ctx.notify(`🔓 已解锁【${ZONE_CONFIG[zone].name}】遮罩`);
    } else {
      current.add(zone);
      this.ctx.notify(`🔒 已锁定【${ZONE_CONFIG[zone].name}】遮罩，受保护不被覆盖或右键擦除`);
    }
    this.ctx.patchSession({ lockedMaskZones: ALL_ZONES.filter((z) => current.has(z)) });
  }

  setMaskOpacity(opacity: number): void {
    this.ctx.patchSession({ maskOpacity: Math.max(0, Math.min(1, opacity)) });
  }

  setActiveMaskTool(tool: MaskTool): void {
    const changes: Partial<EditorSession> = { activeMaskTool: tool };
    if (this.ctx.session.activeMode !== 'mask') {
      changes.activeMode = 'mask';
      changes.selection = null;
    }
    this.ctx.patchSession(changes);
  }

  setMaskBrushSize(size: BrushSize): void {
    const clamped = Math.max(1, Math.min(10, Math.round(size))) as BrushSize;
    this.ctx.patchSession({ maskBrushSize: clamped });
    this.ctx.notify(`🖌️ 遮罩笔刷尺寸已设为: ${clamped} px`);
  }

  changeMaskBrushSize(delta: number): void {
    const next = (this.ctx.session.maskBrushSize + delta) as BrushSize;
    this.setMaskBrushSize(next);
  }

  setMaskMatchPreset(presetKey: string): void {
    const preset = MATCH_COLOR_PRESETS.find((p) => p.id === presetKey);
    if (!preset) return;
    const doc = this.ctx.doc;
    const colors = preset.getIndices(doc.palette, doc.currentHairPreset);
    this.ctx.patchSession({ maskMatchPresetKey: presetKey, maskMatchColors: colors });
    this.ctx.notify(`🎯 匹配色组已设为: 【${preset.name}】(${colors.length} 色)`);
  }

  setMaskMatchPresetKey(presetKey: string): void {
    this.setMaskMatchPreset(presetKey);
  }

  addMaskMatchColor(colorIdx: number): void {
    const current = this.ctx.session.maskMatchColors;
    if (current.includes(colorIdx)) return;
    this.ctx.patchSession({
      maskMatchPresetKey: 'custom',
      maskMatchColors: [...current, colorIdx].sort((a, b) => a - b),
    });
  }

  removeMaskMatchColor(colorIdx: number): void {
    const next = this.ctx.session.maskMatchColors.filter((i) => i !== colorIdx);
    this.ctx.patchSession({ maskMatchPresetKey: 'custom', maskMatchColors: next });
  }

  toggleMaskMatchColor(colorIdx: number): void {
    const current = new Set(this.ctx.session.maskMatchColors);
    if (current.has(colorIdx)) current.delete(colorIdx);
    else current.add(colorIdx);
    this.ctx.patchSession({
      maskMatchPresetKey: 'custom',
      maskMatchColors: Array.from(current).sort((a, b) => a - b),
    });
  }

  setCustomMaskMatchColors(indices: number[]): void {
    const unique = Array.from(new Set(indices)).sort((a, b) => a - b);
    this.ctx.patchSession({
      maskMatchPresetKey: 'custom',
      maskMatchColors: unique,
    });
  }

  maskBoxSelect(rect: RectSelection, action: 'add' | 'remove' | 'subtract' | 'clear'): void {
    if (this.ctx.isDisposed || !this.ctx.session.isLoaded) return;
    const s = this.ctx.session;
    const matchColors = new Set(s.maskMatchColors);
    const target = s.activeZone;
    const targetMeta = ZONE_CONFIG[target];

    if (action !== 'clear' && matchColors.size === 0) {
      this.ctx.notify('⚠️ 匹配色组为空，请先在左侧选择颜色组或挑选颜色', 'warning');
      return;
    }

    const cmd = new MaskBoxSelectCommand(
      rect,
      action,
      matchColors,
      target,
      s.lockedMaskZones
    );
    this.ctx.execute(cmd);

    if (cmd.count === 0) {
      this.ctx.notify('框选范围内未找到符合条件的像素点', 'info');
      return;
    }

    if (action === 'clear') {
      this.ctx.notify(`🧹 已从【${targetMeta.name}】中清空 ${cmd.count} 个像素 (右键去所有颜色)`, 'success');
    } else if (action === 'subtract') {
      this.ctx.notify(`⚡ 去杂色完成：已将框内 ${cmd.count} 个非匹配色像素从【${targetMeta.name}】剔除`, 'success');
    } else if (action === 'remove') {
      this.ctx.notify(`✂️ 去匹配色完成：已将框内 ${cmd.count} 个匹配色像素从【${targetMeta.name}】剔除`, 'success');
    } else {
      this.ctx.notify(`✓ 智能划入完成：已将框内 ${cmd.count} 个匹配色像素划入【${targetMeta.name}】`, 'success');
    }
  }

  boxSelectMask(action: 'add' | 'remove' | 'subtract' | 'clear', rect: RectSelection): void {
    this.maskBoxSelect(rect, action);
  }

  assignColorToZone(colorIdx: number): void {
    if (this.ctx.isDisposed) return;
    const target = this.ctx.session.activeZone;
    if (colorIdx === TRANSPARENT_INDEX) {
      this.ctx.notify('透明像素不参与遮罩', 'error');
      return;
    }
    const targetMeta = ZONE_CONFIG[target];
    const hex = this.ctx.doc.palette[colorIdx] || `#${colorIdx}`;

    const cmd = new AssignColorToZoneCommand(colorIdx, target, this.ctx.session.lockedMaskZones);
    this.ctx.execute(cmd);

    if (cmd.count > 0) {
      this.ctx.notify(`✨ 已将全图 ${cmd.count} 个颜色 ${hex} 像素一键划入【${targetMeta.name}】！`, 'success');
    } else {
      this.ctx.notify('未找到可划入的有效未锁定像素', 'info');
    }
  }

  recomputeSemanticMask(): void {
    if (this.ctx.isDisposed || !this.ctx.session.isLoaded) return;
    try {
      const paletteRgb = this.ctx.doc.palette.map(hexToRgb);
      const pixels: Rgb[] = Array.from(this.ctx.doc.pixelIndices, (idx) =>
        idx === TRANSPARENT_INDEX ? [255, 255, 255] : paletteRgb[idx] || [0, 0, 0]
      );
      const mask = computeSemanticMask(pixels);
      for (let i = 0; i < this.ctx.doc.pixelIndices.length; i++) {
        if (this.ctx.doc.pixelIndices[i] === TRANSPARENT_INDEX) mask[i] = SemanticZone.None;
      }
      this.ctx.execute(new SetMaskCommand(mask));
      this.ctx.notify('✨ 4 分区语义遮罩已基于当前画布像素重新提取完成！', 'success');
    } catch (err) {
      console.error('Recompute mask failed:', err);
      this.ctx.notify('重新识别遮罩失败，请检查控制台错误日志', 'error');
    }
  }

  // ===================== 发色与预设 =====================

  applyHairPreset(presetKey: HairPresetKey): void {
    if (this.ctx.isDisposed || !this.ctx.session.isLoaded) return;
    if (!isHairPresetKey(presetKey)) return;
    const ramp = RAMPS_INFO[presetKey];
    if (!ramp) return;
    const doc = this.ctx.doc;
    if (!doc.semanticMask.includes(SemanticZone.Hair)) {
      this.ctx.notify('当前遮罩中未标记任何头发 (Hair) 区域，请先涂抹遮罩', 'warning');
      return;
    }

    // 若尚未开启试色，捕获基准状态以便放弃时可完美回滚
    if (!this.hasHairTrial) {
      this.hasHairTrial = true;
      this.initialHairPreset = doc.currentHairPreset;
      this.initialPixels = new Uint8Array(doc.pixelIndices);
    }
    this.trialHairPreset = presetKey;

    const { pixelIndices, semanticMask, palette, currentHairPreset } = doc;
    const newPixels = recolorHair(pixelIndices, semanticMask, palette, currentHairPreset, presetKey);
    this.ctx.execute(new CommitHairRecolorCommand(newPixels, presetKey));

    if (this.ctx.session.maskMatchPresetKey === 'current_hair') {
      const preset = MATCH_COLOR_PRESETS.find((p) => p.id === 'current_hair');
      if (preset) {
        this.ctx.patchSession({ maskMatchColors: preset.getIndices(doc.palette, doc.currentHairPreset) });
      }
    }
    this.ctx.notify(`✓ 发色【${ramp.name}】(${ramp.icon})已切换！(切回绘图模式时可确认或放弃)`, 'success');
  }

  setHairPreset(presetKey: HairPresetKey): void {
    if (this.ctx.isDisposed || !isHairPresetKey(presetKey)) return;
    this.ctx.execute(new SetHairPresetCommand(presetKey));
    if (this.ctx.session.maskMatchPresetKey === 'current_hair') {
      const preset = MATCH_COLOR_PRESETS.find((p) => p.id === 'current_hair');
      if (preset) {
        this.ctx.patchSession({ maskMatchColors: preset.getIndices(this.ctx.doc.palette, this.ctx.doc.currentHairPreset) });
      }
    }
  }

  getHairPresetKey(): HairPresetKey {
    return this.ctx.doc.currentHairPreset || (Object.keys(RAMPS_INFO)[0] as HairPresetKey);
  }

  getHairRampIndices(presetKey?: HairPresetKey): number[] {
    const key = presetKey || this.getHairPresetKey();
    if (!isHairPresetKey(key)) return [];
    const rampInfo = RAMPS_INFO[key];
    if (!rampInfo) return [];
    const palette = this.ctx.doc.palette;
    const indices: number[] = [];
    rampInfo.hexes.forEach((hex: string) => {
      let idx = palette.findIndex((c) => c.toLowerCase() === hex.toLowerCase());
      if (idx === -1) {
        const nearest = findNearestColor(hex, palette);
        idx = palette.findIndex((c) => c.toLowerCase() === nearest.toLowerCase());
      }
      if (idx >= 0 && !indices.includes(idx)) indices.push(idx);
    });
    return indices;
  }
}
