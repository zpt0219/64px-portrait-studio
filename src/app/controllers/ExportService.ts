import { exportProjectPng, exportProjectZip, exportMaskPng } from '../../core/zipExporter';
import { PortraitDocument } from '../../model/document';
import { ToastLevel } from '../../types';

export interface ExportPorts {
  isLoaded(): boolean;
  hasHairDraft(): boolean;
  hairDraftName(): string;
  confirmHairDraft(options: {
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
  }): void;
  getDocumentGeneration?(): number;
  captureDocument(): PortraitDocument;
  notify(message: string, level?: ToastLevel): void;
}

export class ExportService {
  constructor(private readonly ports: ExportPorts) {}

  async exportPng(): Promise<void> {
    if (!this.ports.isLoaded()) return;
    const initialGen = this.ports.getDocumentGeneration?.();
    await new Promise<void>((resolve) => {
      this.exportWithHairDraftCheck({
        onProceed: async () => {
          if (initialGen !== undefined && this.ports.getDocumentGeneration?.() !== initialGen) {
            resolve();
            return;
          }
          if (!this.ports.isLoaded()) {
            resolve();
            return;
          }
          try {
            await exportProjectPng(this.ports.captureDocument());
            this.ports.notify('🎉 PNG 导出成功！', 'success');
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('Export PNG failed:', err);
            this.ports.notify(`PNG 导出失败: ${message}`, 'error');
          } finally {
            resolve();
          }
        },
        onCancel: () => resolve(),
      });
    });
  }

  async exportMaskPng(scale = 1): Promise<void> {
    if (!this.ports.isLoaded()) return;
    try {
      await exportMaskPng(this.ports.captureDocument(), scale);
      this.ports.notify('🎉 PNG 导出成功！', 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Export Mask PNG failed:', err);
      this.ports.notify(`PNG 导出失败: ${message}`, 'error');
    }
  }

  async exportZip(): Promise<void> {
    if (!this.ports.isLoaded()) return;
    const initialGen = this.ports.getDocumentGeneration?.();
    await new Promise<void>((resolve) => {
      this.exportWithHairDraftCheck({
        onProceed: async () => {
          if (initialGen !== undefined && this.ports.getDocumentGeneration?.() !== initialGen) {
            resolve();
            return;
          }
          if (!this.ports.isLoaded()) {
            resolve();
            return;
          }
          try {
            this.ports.notify('正在打包工程 ZIP...', 'info');
            await exportProjectZip(this.ports.captureDocument());
            this.ports.notify('🎉 成功导出完整工程 ZIP 包！', 'success');
          } catch (err) {
            console.error('Export zip failed:', err);
            this.ports.notify('导出工程 ZIP 失败，请重试', 'error');
          } finally {
            resolve();
          }
        },
        onCancel: () => resolve(),
      });
    });
  }

  /**
   * 导出前检查是否有未固化的发色预览：
   * 若有，弹窗提示用户先应用发色再导出、按原图导出或取消。
   */
  private exportWithHairDraftCheck(o: { onProceed: () => void | Promise<void>; onCancel?: () => void }): void {
    if (!this.ports.hasHairDraft()) {
      void o.onProceed();
      return;
    }

    const name = this.ports.hairDraftName();
    this.ports.confirmHairDraft({
      icon: '📦',
      title: '导出前发色确认',
      message: `当前正在预览【${name}】发色，尚未固化到画面中。`,
      subMessage: '是否将此发色固化后再导出？',
      applyLabel: `✓ 应用【${name}】后导出`,
      onApplied: () => void o.onProceed(),
      otherLabel: '✕ 按原发色导出',
      onOther: () => void o.onProceed(),
      cancelLabel: '取消导出',
      onCancel: () => o.onCancel?.(),
    });
  }
}
