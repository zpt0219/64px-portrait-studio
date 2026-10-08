import type { PortraitDocument } from '../core/document';
import type { EditorSession } from '../core/session';
import type { Command } from '../command/command';
import type { ToastLevel } from '../command/events';
import type { PromptOptions } from './ports';
import type { EditorMode } from '../core/types';

export interface SubViewModel {
  /**
   * 退出当前模式前的守卫与拦截：
   * 传入回调 callback(allowed: boolean)。
   * 如果允许退出，调用 callback(true)；如果中止/取消退出，调用 callback(false)。
   */
  canExit(callback: (allowed: boolean) => void): void;

  /**
   * 退出当前模式时的强制清理流程 (Clean up)：
   * 隐藏专有图层覆盖、结算未完成手势、清除探针与临时高亮。
   */
  cleanup(): void;

  /**
   * 进入该模式时的初始化流程 (Setup)：
   * 激活该模式专属状态与视图。
   */
  enter(): void;
}

export interface StudioContext {
  readonly doc: PortraitDocument;
  readonly session: EditorSession;
  readonly isDisposed: boolean;
  getDocumentGeneration(): number;
  execute(cmd: Command): boolean;
  patchSession(changes: Partial<EditorSession>): void;
  notify(message: string, level?: ToastLevel): void;
  confirm(options: PromptOptions): void;
  endStroke(): void;
  setMode(mode: EditorMode, onProceed?: () => void): void;
}
