import { ProjectData, DecodedImage, ToastLevel } from '../../types';
import { importProjectZip } from '../../core/zipExporter';
import { decodeImageFile } from '../imageDecode';

export interface ImportCoordinatorHost {
  loadProject(data: ProjectData): void;
  importImage(image: DecodedImage): void;
  notify(message: string, level?: ToastLevel): void;
}

export interface ImportLoaders {
  importProjectZip: (file: File) => Promise<ProjectData>;
  decodeImageFile: (file: File) => Promise<DecodedImage | null>;
}

export class ImportCoordinator {
  private currentRequestId = 0;

  constructor(
    private readonly host: ImportCoordinatorHost,
    private readonly loaders: ImportLoaders = { importProjectZip, decodeImageFile }
  ) {}

  cancelPending(): void {
    this.currentRequestId++;
  }

  getCurrentRequestId(): number {
    return this.currentRequestId;
  }

  async handleFile(file: File): Promise<void> {
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    const isZip = lowerName.endsWith('.zip') || file.type.includes('zip');
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/i.test(lowerName);

    if (!isZip && !isImage) {
      this.host.notify('仅支持工程 ZIP 包或图片格式文件 (PNG, JPG, WebP 等)', 'error');
      return;
    }

    const reqId = ++this.currentRequestId;

    if (isZip) {
      try {
        const projectData = await this.loaders.importProjectZip(file);
        if (this.currentRequestId !== reqId) return;
        this.host.loadProject(projectData);
        this.host.notify('🎉 成功载入工程 ZIP！已完整恢复画布、遮罩与色板', 'success');
      } catch (err) {
        if (this.currentRequestId !== reqId) return;
        console.error('Failed to import project zip:', err);
        this.host.notify(`导入工程 ZIP 失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
      return;
    }

    try {
      const image = await this.loaders.decodeImageFile(file);
      if (this.currentRequestId !== reqId) return;
      if (!image) {
        this.host.notify('无法读取有效图片尺寸，请重试', 'error');
        return;
      }
      this.host.importImage(image);
    } catch (err) {
      if (this.currentRequestId !== reqId) return;
      console.error('File load error:', err);
      this.host.notify('载入图片失败，请检查文件是否损坏', 'error');
    }
  }
}
