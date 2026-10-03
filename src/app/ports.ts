import type { PortraitDocument } from '../model/document';

export interface PromptButton {
  label: string;
  className?: string;
  onClick(): void;
}

export interface PromptOptions {
  icon?: string;
  title: string;
  message: string;
  subMessage?: string;
  buttons: PromptButton[];
  onDismiss?(): void;
}

export interface StudioPrompts {
  confirm(options: PromptOptions): void;
  dismiss?(): void;
}

/** App supplies the browser implementation; controllers only see this port. */
export interface ExportBackend {
  exportPng(document: PortraitDocument): Promise<void>;
  exportZip(document: PortraitDocument): Promise<void>;
  exportMaskPng(document: PortraitDocument, scale: number): Promise<void>;
}

export const unavailableExports: ExportBackend = {
  exportPng: async () => { throw new Error('导出服务未配置'); },
  exportZip: async () => { throw new Error('导出服务未配置'); },
  exportMaskPng: async () => { throw new Error('导出服务未配置'); },
};
