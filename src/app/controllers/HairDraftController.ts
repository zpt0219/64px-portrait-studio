import { SemanticZone } from '../../types';
import { RAMPS_INFO, MATCH_COLOR_PRESETS } from '../../data/palette';
import { findNearestColor } from '../../core/colorUtils';
import { recolorHair } from '../../core/recolorEngine';
import { EditorSession } from '../../model/session';
import { SetHairPresetCommand, CommitHairRecolorCommand } from '../../command/paletteCommands';
import type { ViewModel } from '../viewModel';

export class HairDraftController {
  /** 发色预览像素缓存；文档或草稿变化时置空，下次读取时重算 */
  private hairPreview: Uint8Array | null = null;

  constructor(private readonly vm: ViewModel) {}

  invalidatePreview(): void {
    this.hairPreview = null;
  }

  hasHairDraft(): boolean {
    return this.vm.session.hairDraftPreset !== null;
  }

  hairDraftName(): string {
    return RAMPS_INFO[this.vm.session.hairDraftPreset!]?.name || '新发色';
  }

  /** 画布显示用的像素：有发色草稿时为基于当前文档实时计算的预览，否则为文档像素 */
  displayPixels(): Uint8Array {
    const draft = this.vm.session.hairDraftPreset;
    if (!draft) return this.vm.doc.pixelIndices;
    if (!this.hairPreview) {
      const { pixelIndices, semanticMask, palette, currentHairPreset } = this.vm.doc;
      this.hairPreview = recolorHair(pixelIndices, semanticMask, palette, currentHairPreset, draft);
    }
    return this.hairPreview;
  }

  /** 非破坏性预览 9 大发色预设之一 (不修改文档，可反复切换) */
  applyHairPreset(presetKey: string): void {
    if (!this.vm.session.isLoaded) return;
    const ramp = RAMPS_INFO[presetKey];
    if (!ramp) return;
    if (!this.vm.doc.semanticMask.includes(SemanticZone.Hair)) {
      this.vm.notify('当前遮罩中未标记任何头发 (Hair) 区域，请先涂抹遮罩', 'warning');
      return;
    }
    if (this.vm.session.activeMode !== 'mask') {
      this.vm.setMode('mask');
    }
    this.vm.setActiveZone(SemanticZone.Hair);
    this.vm.patchSession({ hairDraftPreset: presetKey });
    this.vm.notify(`🎨 正在预览发色: ${ramp.name} (${ramp.icon})，离开蒙版模式前可自由试色`);
  }

  /** 固化发色预览到文档 */
  commitHairRecolor(): void {
    if (!this.hasHairDraft()) return;
    const name = this.hairDraftName();
    this.vm.commandHandler.execute(
      new CommitHairRecolorCommand(new Uint8Array(this.displayPixels()), this.vm.session.hairDraftPreset!)
    );
    const changes: Partial<EditorSession> = { hairDraftPreset: null };
    if (this.vm.session.maskMatchPresetKey === 'current_hair') {
      const preset = MATCH_COLOR_PRESETS.find((p) => p.id === 'current_hair');
      if (preset) {
        changes.maskMatchColors = preset.getIndices(this.vm.doc.palette, this.vm.doc.currentHairPreset);
      }
    }
    this.vm.patchSession(changes);
    this.vm.notify(`✓ 发色【${name}】已成功应用并固化到画布！`, 'success');
  }

  discardHairRecolor(): void {
    if (!this.hasHairDraft()) return;
    this.vm.patchSession({ hairDraftPreset: null });
    this.vm.notify('已放弃发色预览，恢复为原图', 'info');
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
  setHairPreset(presetKey: string): void {
    this.vm.commandHandler.execute(new SetHairPresetCommand(presetKey));
    if (this.vm.session.maskMatchPresetKey === 'current_hair') {
      const preset = MATCH_COLOR_PRESETS.find((p) => p.id === 'current_hair');
      if (preset) {
        this.vm.patchSession({ maskMatchColors: preset.getIndices(this.vm.doc.palette, this.vm.doc.currentHairPreset) });
      }
    }
  }

  /** 获取当前文档的发色预设 key (若无则取首个默认预设) */
  getHairPresetKey(): string {
    return this.vm.doc.currentHairPreset || Object.keys(RAMPS_INFO)[0];
  }

  /** 获取指定或当前发色预设的 5 阶颜色在色板中的索引列表 */
  getHairRampIndices(presetKey?: string): number[] {
    const key = presetKey || this.getHairPresetKey();
    const rampInfo = RAMPS_INFO[key];
    if (!rampInfo) return [];
    const palette = this.vm.doc.palette;
    const indices: number[] = [];
    rampInfo.hexes.forEach((hex) => {
      let idx = palette.findIndex((c) => c.toLowerCase() === hex.toLowerCase());
      if (idx === -1) {
        const nearest = findNearestColor(hex, palette);
        idx = palette.findIndex((c) => c.toLowerCase() === nearest.toLowerCase());
      }
      if (idx >= 0 && !indices.includes(idx)) indices.push(idx);
    });
    return indices;
  }

  /** 未固化发色预览的三选一对话框：第一个按钮先固化再执行 onApplied，第三个按钮什么都不做 */
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
  }): void {
    this.vm.studioPrompts.confirm({
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
        { label: o.cancelLabel, className: 'btn-ghost', onClick: () => {} },
      ],
    });
  }
}
