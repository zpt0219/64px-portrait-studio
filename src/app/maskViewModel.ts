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

export interface PendingRecolorDescription {
  zone: SemanticZone;
  name: string;
  icon: string;
  previewName: string;
}

export class MaskViewModel implements SubViewModel {
  // 试色草稿状态追踪
  private trialHairPreset: HairPresetKey | null = null;
  private hasHairTrial = false;
  private trialHistory: HairPresetKey[] = [];
  private trialRedoStack: HairPresetKey[] = [];

  constructor(private readonly ctx: StudioContext) {}

  // ===================== 试色状态与决策 =====================

  get hasPendingHairTrial(): boolean {
    if (!this.hasHairTrial || !this.trialHairPreset) return false;
    if (this.trialHairPreset !== this.ctx.doc.currentHairPreset) return true;
    const doc = this.ctx.doc;
    const testPixels = recolorHair(doc.pixelIndices, doc.semanticMask, doc.palette, doc.currentHairPreset, this.trialHairPreset);
    for (let i = 0; i < doc.pixelIndices.length; i++) {
      if (testPixels[i] !== doc.pixelIndices[i]) return true;
    }
    return false;
  }

  get hasPendingTrial(): boolean {
    return this.hasPendingHairTrial;
  }

  hasHairDraft(): boolean {
    return this.hasPendingHairTrial;
  }

  hairDraftName(): string {
    return this.trialHairPreset ? (RAMPS_INFO[this.trialHairPreset]?.name || '') : '';
  }

  getPendingRecolorDescriptions(): PendingRecolorDescription[] {
    const list: PendingRecolorDescription[] = [];
    if (this.hasPendingHairTrial) {
      list.push({
        zone: SemanticZone.Hair,
        name: '发色',
        icon: '💇',
        previewName: this.hairDraftName(),
      });
    }
    return list;
  }

  canUndoTrial(): boolean {
    return this.trialHistory.length > 0;
  }

  canRedoTrial(): boolean {
    return this.trialRedoStack.length > 0;
  }

  undoTrial(): boolean {
    if (this.trialHistory.length === 0) return false;
    const current = this.trialHistory.pop()!;
    this.trialRedoStack.push(current);

    if (this.trialHistory.length > 0) {
      const prev = this.trialHistory[this.trialHistory.length - 1];
      this.trialHairPreset = prev;
      this.hasHairTrial = true;
    } else {
      this.trialHairPreset = null;
      this.hasHairTrial = false;
    }
    this.ctx.notifyPreviewChanged();
    return true;
  }

  redoTrial(): boolean {
    if (this.trialRedoStack.length === 0) return false;
    const next = this.trialRedoStack.pop()!;
    this.trialHistory.push(next);
    this.trialHairPreset = next;
    this.hasHairTrial = true;
    this.ctx.notifyPreviewChanged();
    return true;
  }

  getDisplayPixels(
    basePixels: Uint8Array,
    mask: Uint8Array,
    palette: string[],
    currentHairPreset: HairPresetKey | null
  ): Uint8Array {
    if (!this.hasPendingHairTrial || !this.trialHairPreset) {
      return basePixels;
    }
    return recolorHair(basePixels, mask, palette, currentHairPreset, this.trialHairPreset);
  }

  invalidateTrial(): void {
    this.hasHairTrial = false;
    this.trialHairPreset = null;
    this.trialHistory = [];
    this.trialRedoStack = [];
  }

  commitHairTrial(): void {
    if (this.hasHairTrial && this.trialHairPreset) {
      const doc = this.ctx.doc;
      const targetPreset = this.trialHairPreset;
      const newPixels = recolorHair(doc.pixelIndices, doc.semanticMask, doc.palette, doc.currentHairPreset, targetPreset);
      this.hasHairTrial = false;
      this.trialHairPreset = null;
      this.trialHistory = [];
      this.trialRedoStack = [];
      this.ctx.execute(new CommitHairRecolorCommand(newPixels, targetPreset));
      this.ctx.notifyPreviewChanged();
    } else {
      this.hasHairTrial = false;
      this.trialHairPreset = null;
      this.trialHistory = [];
      this.trialRedoStack = [];
    }
  }

  commitAllRecolors(): void {
    this.commitHairTrial();
  }

  private revertHairTrial(): void {
    const wasPending = this.hasHairTrial;
    this.hasHairTrial = false;
    this.trialHairPreset = null;
    this.trialHistory = [];
    this.trialRedoStack = [];
    if (wasPending) {
      this.ctx.notifyPreviewChanged();
      this.ctx.notify('已放弃发色替换，恢复原样');
    }
  }

  discardHairRecolor(): void {
    this.revertHairTrial();
  }

  discardAllRecolors(): void {
    this.discardHairRecolor();
  }

  // ===================== 生命周期与清理 =====================

  canExit(callback: (allowed: boolean) => void): void {
    if (!this.hasPendingTrial) {
      callback(true);
      return;
    }

    const descriptions = this.getPendingRecolorDescriptions();
    const isSingleHair = descriptions.length === 1 && descriptions[0].zone === SemanticZone.Hair;
    const title = isSingleHair ? '切换至画板模式前发色确认' : '切换至画板模式前换色确认';
    const message = isSingleHair
      ? `当前正在试色新发色【${descriptions[0].previewName}】，尚未固化到画面。`
      : `当前正在试色新配色${descriptions.map((d) => `【${d.name}：${d.previewName}】`).join('、')}，尚未固化到画面。`;
    const subMessage = isSingleHair
      ? '切换到画板模式前，请选择是否将此发色替换应用到画面中：'
      : '切换到画板模式前，请选择是否将这些换色替换应用到画面中：';

    this.ctx.confirm({
      icon: isSingleHair ? '💇' : '🎭',
      title,
      message,
      subMessage,
      buttons: [
        {
          label: '✓ 确认替换并切换',
          className: 'btn-primary',
          onClick: () => {
            this.commitAllRecolors();
            callback(true);
          },
        },
        {
          label: '✕ 放弃替换并切换',
          className: 'btn-danger',
          onClick: () => {
            this.discardAllRecolors();
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
      // 重新进入遮罩模式：恢复遮罩覆盖层显示；若可见图层为空则恢复全部可见
      if (this.ctx.session.visibleMaskZones.length === 0) {
        changes.visibleMaskZones = [...ALL_ZONES];
        changes.showMaskOverlay = true;
      } else {
        changes.showMaskOverlay = true;
      }
    }
    this.ctx.patchSession(changes);
    this.ctx.notify('🎭 已切换至【语义遮罩模式】(快捷键: W)');

    // 重新开启一次全新的遮罩试色基准
    this.invalidateTrial();
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
    if (this.ctx.session.activeMode !== 'mask') {
      this.ctx.setMode('mask', () => {
        this.doSetActiveZone(zone, solo);
      });
      return;
    }
    this.doSetActiveZone(zone, solo);
  }

  private doSetActiveZone(zone: SemanticZone, solo: boolean): void {
    const changes: Partial<EditorSession> = { activeZone: zone };
    if (solo) {
      changes.visibleMaskZones = [zone];
      changes.showMaskOverlay = true;
    } else if (!this.ctx.session.visibleMaskZones.includes(zone)) {
      changes.visibleMaskZones = [...this.ctx.session.visibleMaskZones, zone];
      changes.showMaskOverlay = true;
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

    if (visibleMaskZones.length === 0 && this.ctx.session.activeMode === 'mask') {
      this.ctx.setMode('pixel', () => {
        this.ctx.patchSession({ visibleMaskZones, showMaskOverlay: false });
      });
      return;
    }

    this.ctx.patchSession({ visibleMaskZones, showMaskOverlay });
  }

  setAllZonesVisibility(visible: boolean): void {
    const visibleMaskZones = visible ? [...ALL_ZONES] : [];
    const showMaskOverlay = visible;

    if (!visible) {
      if (this.ctx.session.activeMode === 'mask') {
        this.ctx.setMode('pixel', () => {
          this.ctx.patchSession({ visibleMaskZones, showMaskOverlay: false });
          this.ctx.notify('已隐藏全部遮罩图层');
        });
        return;
      }
      this.ctx.patchSession({ visibleMaskZones, showMaskOverlay: false });
      this.ctx.notify('已隐藏全部遮罩图层');
    } else {
      this.ctx.patchSession({ visibleMaskZones, showMaskOverlay });
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
    if (this.ctx.session.activeMode !== 'mask') {
      this.ctx.setMode('mask', () => {
        this.ctx.patchSession({ activeMaskTool: tool });
      });
      return;
    }
    this.ctx.patchSession({ activeMaskTool: tool });
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

  /** 遮罩筛选读取已提交像素；只有正式发色或色板改变时才刷新源色组。 */
  refreshHairMatchColors(): void {
    if (this.ctx.isDisposed || this.ctx.session.maskMatchPresetKey !== 'current_hair') return;
    const preset = MATCH_COLOR_PRESETS.find((p) => p.id === 'current_hair');
    if (!preset) return;
    const colors = preset.getIndices(this.ctx.doc.palette, this.ctx.doc.currentHairPreset);
    const current = this.ctx.session.maskMatchColors;
    if (colors.length === current.length && colors.every((color, index) => color === current[index])) return;
    this.ctx.patchSession({ maskMatchColors: colors });
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

    if (this.trialHairPreset !== presetKey) {
      this.trialHistory.push(presetKey);
      this.trialRedoStack = [];
    }
    this.hasHairTrial = true;
    this.trialHairPreset = presetKey;

    this.ctx.notifyPreviewChanged();
    this.ctx.notify(`✓ 发色【${ramp.name}】(${ramp.icon})已切换！(切回绘图模式时可确认或放弃)`, 'success');
  }

  setHairPreset(presetKey: HairPresetKey): void {
    if (this.ctx.isDisposed || !isHairPresetKey(presetKey)) return;
    this.ctx.execute(new SetHairPresetCommand(presetKey));
  }

  getHairPresetKey(): HairPresetKey {
    return this.trialHairPreset || this.ctx.doc.currentHairPreset || (Object.keys(RAMPS_INFO)[0] as HairPresetKey);
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
