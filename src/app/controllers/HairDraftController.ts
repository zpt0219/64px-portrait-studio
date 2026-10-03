import { SemanticZone, HairPresetKey, ToastLevel } from '../../types';
import { RAMPS_INFO, MATCH_COLOR_PRESETS, isHairPresetKey } from '../../data/palette';
import { findNearestColor } from '../../core/colorUtils';
import { recolorHair } from '../../core/recolorEngine';
import { PortraitDocument } from '../../model/document';
import { EditorSession } from '../../model/session';
import { Command } from '../../command/command';
import { SetHairPresetCommand, CommitHairRecolorCommand } from '../../command/paletteCommands';
import type { PromptOptions } from '../viewModel';

export interface HairDraftHost {
  getDoc(): PortraitDocument;
  getSession(): EditorSession;
  patchSession(patch: Partial<EditorSession>): void;
  setMode(mode: 'pixel' | 'mask'): void;
  setActiveZone(zone: SemanticZone): void;
  executeCommand(cmd: Command): boolean;
  notify(message: string, level?: ToastLevel): void;
  confirm(options: PromptOptions): void;
}

export class HairDraftController {
  /** 发色预览像素缓存；文档或草稿变化时置空，下次读取时重算 */
  private hairPreview: Uint8Array | null = null;

  constructor(private readonly host: HairDraftHost) {}

  invalidatePreview(): void {
    this.hairPreview = null;
  }

  hasHairDraft(): boolean {
    return this.host.getSession().hairDraftPreset !== null;
  }

  hairDraftName(): string {
    const preset = this.host.getSession().hairDraftPreset;
    return (preset && RAMPS_INFO[preset]?.name) || '新发色';
  }

  /** 画布显示用的像素：有发色草稿时为基于当前文档实时计算的预览，否则为文档像素 */
  displayPixels(): Uint8Array {
    const draft = this.host.getSession().hairDraftPreset;
    const doc = this.host.getDoc();
    if (!draft) return doc.pixelIndices;
    if (!this.hairPreview) {
      const { pixelIndices, semanticMask, palette, currentHairPreset } = doc;
      this.hairPreview = recolorHair(pixelIndices, semanticMask, palette, currentHairPreset, draft);
    }
    return this.hairPreview;
  }

  /** 非破坏性预览 9 大发色预设之一 (不修改文档，可反复切换) */
  applyHairPreset(presetKey: HairPresetKey): void {
    const session = this.host.getSession();
    if (!session.isLoaded) return;
    if (!isHairPresetKey(presetKey)) return;
    const ramp = RAMPS_INFO[presetKey];
    if (!ramp) return;
    const doc = this.host.getDoc();
    if (!doc.semanticMask.includes(SemanticZone.Hair)) {
      this.host.notify('当前遮罩中未标记任何头发 (Hair) 区域，请先涂抹遮罩', 'warning');
      return;
    }
    if (session.activeMode !== 'mask') {
      this.host.setMode('mask');
    }
    this.host.setActiveZone(SemanticZone.Hair);
    this.host.patchSession({ hairDraftPreset: presetKey });
    this.host.notify(`🎨 正在预览发色: ${ramp.name} (${ramp.icon})，离开蒙版模式前可自由试色`);
  }

  /** 固化发色预览到文档 */
  commitHairRecolor(): void {
    if (!this.hasHairDraft()) return;
    const name = this.hairDraftName();
    const session = this.host.getSession();
    const doc = this.host.getDoc();
    this.host.executeCommand(
      new CommitHairRecolorCommand(new Uint8Array(this.displayPixels()), session.hairDraftPreset!)
    );
    const changes: Partial<EditorSession> = { hairDraftPreset: null };
    if (session.maskMatchPresetKey === 'current_hair') {
      const preset = MATCH_COLOR_PRESETS.find((p) => p.id === 'current_hair');
      if (preset) {
        changes.maskMatchColors = preset.getIndices(doc.palette, doc.currentHairPreset);
      }
    }
    this.host.patchSession(changes);
    this.host.notify(`✓ 发色【${name}】已成功应用并固化到画布！`, 'success');
  }

  discardHairRecolor(): void {
    if (!this.hasHairDraft()) return;
    this.host.patchSession({ hairDraftPreset: null });
    this.host.notify('已放弃发色预览，恢复为原图', 'info');
  }

  openHairRecolorPrompt(): void {
    if (!this.hasHairDraft()) return;
    this.confirmHairDraft({
      icon: '💇',
      title: '固化或还原发色',
      message: `当前正在预览发色【${this.hairDraftName()}】。`,
      subMessage: '请选择是否将此发色固化应用到画面中，或放弃并还原：',
      applyLabel: '✓ 确认应用并固化',
      onApplied: () => {},
      otherLabel: '✕ 放弃修改并还原',
      onOther: () => this.discardHairRecolor(),
      cancelLabel: '继续试色',
    });
  }

  /** 发色卡下拉框：设定当前发色预设 */
  setHairPreset(presetKey: HairPresetKey): void {
    if (!isHairPresetKey(presetKey)) return;
    this.host.executeCommand(new SetHairPresetCommand(presetKey));
    const session = this.host.getSession();
    const doc = this.host.getDoc();
    if (session.maskMatchPresetKey === 'current_hair') {
      const preset = MATCH_COLOR_PRESETS.find((p) => p.id === 'current_hair');
      if (preset) {
        this.host.patchSession({ maskMatchColors: preset.getIndices(doc.palette, doc.currentHairPreset) });
      }
    }
  }

  /** 获取当前文档的发色预设 key (若无则取首个默认预设) */
  getHairPresetKey(): HairPresetKey {
    return this.host.getDoc().currentHairPreset || (Object.keys(RAMPS_INFO)[0] as HairPresetKey);
  }

  /** 获取指定或当前发色预设的 5 阶颜色在色板中的索引列表 */
  getHairRampIndices(presetKey?: HairPresetKey): number[] {
    const key = presetKey || this.getHairPresetKey();
    if (!isHairPresetKey(key)) return [];
    const rampInfo = RAMPS_INFO[key];
    if (!rampInfo) return [];
    const palette = this.host.getDoc().palette;
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

  /** 未固化发色预览的三选一对话框：第一个按钮先固化再执行 onApplied，第三个按钮取消操作 */
  confirmHairDraft(o: {
    icon: string;
    title: string;
    message: string;
    subMessage: string;
    applyLabel: string;
    onApplied: () => void;
    otherLabel: string;
    onOther: () => void;
    cancelLabel: string;
    onCancel?: () => void;
  }): void {
    this.host.confirm({
      icon: o.icon,
      title: o.title,
      message: o.message,
      subMessage: o.subMessage,
      buttons: [
        {
          label: o.applyLabel,
          className: 'btn-primary',
          onClick: () => {
            this.commitHairRecolor();
            o.onApplied();
          },
        },
        { label: o.otherLabel, className: 'btn-outline', onClick: o.onOther },
        { label: o.cancelLabel, className: 'btn-ghost', onClick: () => o.onCancel?.() },
      ],
      onDismiss: () => o.onCancel?.(),
    });
  }
}
