import { exportProjectPng, exportProjectZip } from '../../core/zipExporter';
import type { ViewModel } from '../viewModel';

export class ExportService {
  constructor(private readonly vm: ViewModel) {}

  exportPng(): void {
    if (!this.vm.session.isLoaded) return;
    this.exportWithHairDraftCheck({
      onProceed: () => {
        exportProjectPng(this.vm.doc);
        this.vm.notify('💾 已导出纯净 8-bit 索引 PNG 头像');
      },
    });
  }

  exportZip(): void {
    if (!this.vm.session.isLoaded) return;
    this.exportWithHairDraftCheck({
      onProceed: async () => {
        try {
          this.vm.notify('正在打包工程 ZIP...', 'info');
          await exportProjectZip(this.vm.doc);
          this.vm.notify('🎉 成功导出完整工程 ZIP 包！', 'success');
        } catch (err) {
          console.error('Export zip failed:', err);
          this.vm.notify('导出工程 ZIP 失败，请重试', 'error');
        }
      },
    });
  }

  /**
   * 导出前检查是否有未固化的发色预览：
   * 若有，弹窗提示用户先应用发色再导出、按原图导出或取消。
   */
  private exportWithHairDraftCheck(o: { onProceed: () => void }): void {
    if (!this.vm.hasHairDraft()) {
      o.onProceed();
      return;
    }

    const name = this.vm.hairDraftName();
    this.vm.confirmHairDraft({
      icon: '📦',
      title: '导出前发色确认',
      message: `当前正在预览【${name}】发色，尚未固化到画面中。`,
      subMessage: '是否将此发色固化后再导出？',
      applyLabel: `✓ 应用【${name}】后导出`,
      onApplied: () => o.onProceed(),
      otherLabel: '✕ 按原发色导出',
      onOther: () => o.onProceed(),
      cancelLabel: '取消导出',
    });
  }
}
