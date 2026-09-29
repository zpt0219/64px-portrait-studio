/**
 * 编辑器事件接口 (对应 tile_map_editor_imgui 的 TileMapCommandCallbacks)。
 * 命令与 ViewModel 发出事件，ViewModel 是唯一接收者并扇出给所有已注册的监听者；
 * 监听者只实现自己关心的方法。
 */

import { EditorSession } from '../model/session';

export type ToastLevel = 'info' | 'success' | 'warning' | 'error';
export type SaveStatus = 'saving' | 'saved';

export interface StudioEvents {
  /** 导入图片 / 工程、恢复存档、清空画布：整份文档被替换，撤销历史已清空 */
  onDocumentReplaced?(): void;
  onPixelsChanged?(): void;
  onMaskChanged?(): void;
  onPaletteChanged?(): void;
  onHairPresetChanged?(): void;
  onSessionChanged?(keys: (keyof EditorSession)[]): void;
  onHistoryChanged?(): void;
  /** EditorContext (跨面板的纯界面状态) 变化 */
  onContextChanged?(): void;
  onNotify?(message: string, level: ToastLevel): void;
  onSaveStatus?(status: SaveStatus): void;
}
