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

/** 触发确认弹窗的场景，决定标题与引导语 */
export type PendingRecolorScene = 'exit' | 'export';

/** 一个区域的换色定义。新增区域（如眼睛）只需在 ZONE_RECOLORS 中补一项。 */
interface ZoneRecolorDef {
  name: string;
  icon: string;
  /** 已提交文档中该区域当前对应的源预设；与试色目标相同且像素无变化则不算待确认 */
  source(doc: StudioContext['doc']): HairPresetKey | null;
  targetName(target: HairPresetKey): string;
  recolor(
    pixels: Uint8Array,
    mask: Uint8Array,
    palette: string[],
    source: HairPresetKey | null,
    target: HairPresetKey
  ): Uint8Array;
}

const ZONE_RECOLORS: Partial<Record<SemanticZone, ZoneRecolorDef>> = {
  [SemanticZone.Hair]: {
    name: '发色',
    icon: '💇',
    source: (doc) => doc.currentHairPreset,
    targetName: (target) => RAMPS_INFO[target]?.name || '',
    recolor: recolorHair,
  },
};

type PendingRecolors = Map<SemanticZone, HairPresetKey>;

export class MaskViewModel implements SubViewModel {
  /** 本轮蒙版编辑中所有区域的待确认换色：区域 -> 目标预设。空表示没有待确认操作 */
  private pending: PendingRecolors = new Map();
  /** 待确认换色的撤销/重做栈，每项是一次变更后的完整集合快照（栈顶 = 当前状态） */
  private trialHistory: PendingRecolors[] = [];
  private trialRedoStack: PendingRecolors[] = [];

  constructor(private readonly ctx: StudioContext) {}

  // ===================== 试色状态与决策 =====================

  /** 某个区域的试色是否对已提交文档产生实际效果 */
  private isEntryEffective(zone: SemanticZone, target: HairPresetKey): boolean {
    const def = ZONE_RECOLORS[zone];
    if (!def) return false;
    const doc = this.ctx.doc;
    const source = def.source(doc);
    if (target !== source) return true;
    // 目标与源标记相同：源色阶之外的像素仍可能被改写，需看实际效果
    const result = def.recolor(doc.pixelIndices, doc.semanticMask, doc.palette, source, target);
    for (let i = 0; i < doc.pixelIndices.length; i++) {
      if (result[i] !== doc.pixelIndices[i]) return true;
    }
    return false;
  }

  /** 是否存在会改变画面的待确认换色（任一区域） */
  get hasPendingRecolors(): boolean {
    for (const [zone, target] of this.pending) {
      if (this.isEntryEffective(zone, target)) return true;
    }
    return false;
  }

  /** 某区域当前试色目标的显示名；无试色返回空串 */
  pendingTargetName(zone: SemanticZone): string {
    const target = this.pending.get(zone);
    const def = ZONE_RECOLORS[zone];
    return target && def ? def.targetName(target) : '';
  }

  getPendingRecolorDescriptions(): PendingRecolorDescription[] {
    const list: PendingRecolorDescription[] = [];
    for (const [zone, target] of this.pending) {
      const def = ZONE_RECOLORS[zone];
      if (!def || !this.isEntryEffective(zone, target)) continue;
      list.push({ zone, name: def.name, icon: def.icon, previewName: def.targetName(target) });
    }
    return list;
  }

  /** 退出蒙版模式与导出共用的确认弹窗文案 */
  describePendingRecolors(scene: PendingRecolorScene): { icon: string; title: string; message: string; subMessage: string } {
    const descriptions = this.getPendingRecolorDescriptions();
    const isSingleHair = descriptions.length === 1 && descriptions[0].zone === SemanticZone.Hair;
    const message = isSingleHair
      ? `当前正在试色新发色【${descriptions[0].previewName}】，尚未固化到画面。`
      : `当前正在试色新配色${descriptions.map((d) => `【${d.name}：${d.previewName}】`).join('、')}，尚未固化到画面。`;
    const subject = isSingleHair ? '此发色替换' : '这些换色替换';
    if (scene === 'export') {
      return {
        icon: '💾',
        title: '导出前换色确认',
        message,
        subMessage: `导出文件前，请选择是否将${subject}应用到画面中：`,
      };
    }
    return {
      icon: isSingleHair ? '💇' : '🎭',
      title: isSingleHair ? '切换至画板模式前发色确认' : '切换至画板模式前换色确认',
      message,
      subMessage: `切换到画板模式前，请选择是否将${subject}应用到画面中：`,
    };
  }

  canUndoTrial(): boolean {
    return this.trialHistory.length > 0;
  }

  canRedoTrial(): boolean {
    return this.trialRedoStack.length > 0;
  }

  undoTrial(): boolean {
    if (this.trialHistory.length === 0) return false;
    this.trialRedoStack.push(this.trialHistory.pop()!);
    const prev = this.trialHistory[this.trialHistory.length - 1];
    this.pending = prev ? new Map(prev) : new Map();
    this.ctx.notifyPreviewChanged();
    return true;
  }

  redoTrial(): boolean {
    if (this.trialRedoStack.length === 0) return false;
    const next = this.trialRedoStack.pop()!;
    this.trialHistory.push(next);
    this.pending = new Map(next);
    this.ctx.notifyPreviewChanged();
    return true;
  }

  /** 把一组待确认换色依次合成到 basePixels 上，返回新数组（不修改输入） */
  private composeRecolors(basePixels: Uint8Array, recolors: PendingRecolors): Uint8Array {
    const doc = this.ctx.doc;
    let result = basePixels;
    for (const [zone, target] of recolors) {
      const def = ZONE_RECOLORS[zone];
      if (!def) continue;
      result = def.recolor(result, doc.semanticMask, doc.palette, def.source(doc), target);
    }
    return result;
  }

  /** 画布与预览使用的显示像素：无待确认换色时直接返回已提交文档数组 */
  displayPixels(): Uint8Array {
    const doc = this.ctx.doc;
    if (this.pending.size === 0) return doc.pixelIndices;
    return this.composeRecolors(doc.pixelIndices, this.pending);
  }

  private clearPending(): void {
    this.pending = new Map();
    this.trialHistory = [];
    this.trialRedoStack = [];
  }

  /** 无条件作废待确认换色：用于文档替换/重新进入模式，不提示、不写入文档 */
  invalidateTrial(): void {
    this.clearPending();
  }

  /** 确认所有区域的换色：整轮合成为一条正式撤销记录，并清空待确认集合 */
  commitAllRecolors(): void {
    if (this.pending.size === 0) return;
    const doc = this.ctx.doc;
    const recolors = this.pending;
    const newPixels = this.composeRecolors(doc.pixelIndices, recolors);
    // 头发预设写回文档作为后续换色的源参考；其他区域接入后在此同步各自的标记
    const hairTarget = recolors.get(SemanticZone.Hair) ?? doc.currentHairPreset;
    this.clearPending();
    this.ctx.execute(new CommitHairRecolorCommand(newPixels, hairTarget));
    this.ctx.notifyPreviewChanged();
  }

  /** 取消所有区域的换色：只清除试色，已提交文档与期间的其他编辑原样保留 */
  discardAllRecolors(): void {
    const wasPending = this.pending.size > 0;
    this.clearPending();
    if (wasPending) {
      this.ctx.notifyPreviewChanged();
      this.ctx.notify('已放弃换色，恢复原样');
    }
  }

  // ===================== 生命周期与清理 =====================

  canExit(callback: (allowed: boolean) => void): void {
    if (!this.hasPendingRecolors) {
      callback(true);
      return;
    }

    this.ctx.confirm({
      ...this.describePendingRecolors('exit'),
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

    this.setZoneTrial(SemanticZone.Hair, presetKey);
    this.ctx.notify(`✓ 发色【${ramp.name}】(${ramp.icon})已切换！(切回绘图模式时可确认或放弃)`, 'success');
  }

  /** 更新某区域的待确认换色目标，并记入试色撤销栈；目标未变化则不重复记录 */
  private setZoneTrial(zone: SemanticZone, target: HairPresetKey): void {
    if (this.pending.get(zone) !== target) {
      this.pending.set(zone, target);
      this.trialHistory.push(new Map(this.pending));
      this.trialRedoStack = [];
    }
    this.ctx.notifyPreviewChanged();
  }

  setHairPreset(presetKey: HairPresetKey): void {
    if (this.ctx.isDisposed || !isHairPresetKey(presetKey)) return;
    this.ctx.execute(new SetHairPresetCommand(presetKey));
  }

  getHairPresetKey(): HairPresetKey {
    return this.pending.get(SemanticZone.Hair) || this.ctx.doc.currentHairPreset || (Object.keys(RAMPS_INFO)[0] as HairPresetKey);
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
