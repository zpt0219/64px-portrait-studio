/**
 * ============================================================================
 * AutosaveService: 本地草稿自动暂存与灾备恢复服务
 * ============================================================================
 *
 * 【架构定位】
 * 运行时所有 ViewModel、绘图命令与文档像素数据 100% 在浏览器内存（RAM）中极速运行。
 * 本服务作为后台“防灾安全气囊”，负责跨会话持久化（应对 F5 刷新、标签页误关、浏览器崩溃）。
 *
 * 【核心设计考量】
 * 1. 为什么不用同步每次写入，而用 300ms 防抖 (Debounce)？
 *    - 浏览器的 localStorage.setItem 是同步阻塞型 API，且每次保存需要全量 JSON 序列化。
 *    - 高频绘制（如鼠标拖拽绘制 60fps）时若每笔都写磁盘，会导致主线程严重掉帧。
 *    - 采用“事件驱动防抖”：仅在文档真实变更后触发，运笔过程中不打断，停笔 300ms 后的空闲时间静默落盘。
 *
 * 2. 为什么不放在 Command Queue 里排队？
 *    - 职责隔离：领域 Command 专注内存模型状态变更与 Undo/Redo 历史栈，不应夹带外部 I/O 副作用。
 *    - 既然 ViewModel 内部的所有 Command 都是同步执行完毕的，内存中的 Document 永远是最新的，
 *      无需额外的异步队列来排队保证顺序。
 *
 * 3. 为什么需要关键时机强制同步 (Flush)？
 *    - 当用户触发导出（PNG/ZIP）、实例销毁或页面即将关闭（beforeunload/pagehide）时，
 *      浏览器的异步事件循环（Event Loop / setTimeout）随时会被直接截断杀死。
 *    - 此时必须通过 flush() 绕过防抖计时器，立刻以同步方式强行写入存储，确保最新改动绝不丢失。
 *
 * 4. 依赖倒置（DIP）与测试解耦：
 *    - 本服务仅依赖抽象的 KeyValueStore 窄接口，运行时由 BrowserStorage 适配注入，
 *      而在自动化测试（Vitest）中可随手注入纯内存 Map，实现隔离且毫秒级的无头单测。
 * ============================================================================
 */

import { ProjectData } from '../../core/types';
import { PortraitDocument } from '../../core/document';
import {
  validateProjectData,
  documentToProjectData,
} from '../../core/projectData';

export const STORAGE_KEY = 'imagegem_project_autosave_v2';
export const WORKSPACE_STORAGE_KEY = 'imagegem_workspace_autosave_v3';
export const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 300;

export interface SavedTabRecord {
  id: string;
  name: string;
  project: ProjectData;
}

export interface WorkspaceData {
  version: 3;
  activeId: string;
  tabs: SavedTabRecord[];
}

export interface WorkspacePayload {
  activeId: string;
  tabs: { id: string; name: string; doc: PortraitDocument }[];
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StorageSaveResult {
  success: boolean;
  error?: string;
}

const unavailableStore: KeyValueStore = {
  getItem: () => null,
  setItem: () => { throw new Error('存储服务未配置'); },
  removeItem: () => { throw new Error('存储服务未配置'); },
};

function storageFailure(err: unknown): StorageSaveResult {
  let error = '存储失败';
  if (err instanceof Error) {
    if (err.name === 'QuotaExceededError' || /quota/i.test(err.message)) error = '配额超限';
    else if (err.name === 'SecurityError') error = '存储受限';
    else error = err.message || error;
  } else if (typeof err === 'string') error = err;
  return { success: false, error };
}

/**
 * 实例级自动保存服务
 */
export class AutosaveService {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDoc: PortraitDocument | null = null;
  private pendingWorkspace: WorkspacePayload | null = null;
  private pendingOnComplete: ((result: StorageSaveResult) => void) | null = null;
  private _isDisposed = false;

  constructor(
    private readonly store: KeyValueStore = unavailableStore,
    private readonly storageKey: string = STORAGE_KEY,
    private readonly debounceMs: number = DEFAULT_AUTOSAVE_DEBOUNCE_MS,
    private readonly workspaceStorageKey: string = WORKSPACE_STORAGE_KEY
  ) {}

  public saveWorkspaceImmediate(payload: WorkspacePayload): StorageSaveResult {
    if (this._isDisposed) {
      return { success: false, error: 'AutosaveService已销毁' };
    }
    try {
      // 优先写入当前激活文档至 legacy 存储，保持对外部旧环境与自定义拦截器测试的最大兼容
      const activeTab = payload.tabs.find((t) => t.id === payload.activeId) ?? payload.tabs[0];
      const activeProject = activeTab ? documentToProjectData(activeTab.doc) : null;
      if (activeProject) {
        this.store.setItem(this.storageKey, JSON.stringify(activeProject));
      }

      const data: WorkspaceData & Partial<ProjectData> = {
        ...(activeProject ?? {}),
        version: 3,
        activeId: payload.activeId,
        tabs: payload.tabs.map((t) => ({
          id: t.id,
          name: t.name,
          project: documentToProjectData(t.doc),
        })),
      };
      this.store.setItem(this.workspaceStorageKey, JSON.stringify(data));
      return { success: true };
    } catch (err: unknown) {
      const result = storageFailure(err);
      console.warn('LocalStorage workspace save failed:', result.error, err);
      return result;
    }
  }

  public saveWorkspaceDebounced(
    payload: WorkspacePayload,
    onComplete?: (result: StorageSaveResult) => void
  ): void {
    if (this._isDisposed) return;
    this.pendingWorkspace = payload;
    this.pendingOnComplete = onComplete ?? null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const wsToSave = this.pendingWorkspace;
      const callback = this.pendingOnComplete;
      this.pendingWorkspace = null;
      this.pendingOnComplete = null;
      if (wsToSave) {
        const result = this.saveWorkspaceImmediate(wsToSave);
        if (callback) callback(result);
      }
    }, this.debounceMs);
  }

  public saveImmediate(doc: PortraitDocument): StorageSaveResult {
    if (this._isDisposed) {
      return { success: false, error: 'AutosaveService已销毁' };
    }
    try {
      const data = documentToProjectData(doc);
      this.store.setItem(this.storageKey, JSON.stringify(data));
      return { success: true };
    } catch (err: unknown) {
      const result = storageFailure(err);
      console.warn('LocalStorage save failed:', result.error, err);
      return result;
    }
  }

  public saveDebounced(
    doc: PortraitDocument,
    onComplete?: (result: StorageSaveResult) => void
  ): void {
    if (this._isDisposed) return;
    this.pendingDoc = doc;
    this.pendingOnComplete = onComplete ?? null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const docToSave = this.pendingDoc;
      const callback = this.pendingOnComplete;
      this.pendingDoc = null;
      this.pendingOnComplete = null;
      if (docToSave) {
        const result = this.saveImmediate(docToSave);
        if (callback) callback(result);
      }
    }, this.debounceMs);
  }

  public cancel(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingDoc = null;
    this.pendingWorkspace = null;
    this.pendingOnComplete = null;
  }

  public flush(): StorageSaveResult | null {
    if (this.debounceTimer || this.pendingDoc || this.pendingWorkspace) {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      const docToSave = this.pendingDoc;
      const wsToSave = this.pendingWorkspace;
      const callback = this.pendingOnComplete;
      this.pendingDoc = null;
      this.pendingWorkspace = null;
      this.pendingOnComplete = null;
      if (wsToSave) {
        const result = this.saveWorkspaceImmediate(wsToSave);
        if (callback) callback(result);
        return result;
      } else if (docToSave) {
        const result = this.saveImmediate(docToSave);
        if (callback) callback(result);
        return result;
      }
    }
    return null;
  }

  public hasSaved(): boolean {
    return this.loadWorkspace() !== null;
  }

  public loadWorkspace(): WorkspaceData | null {
    if (this._isDisposed) return null;
    try {
      const item = this.store.getItem(this.workspaceStorageKey);
      if (item) {
        const raw = JSON.parse(item);
        if (raw && raw.version === 3 && Array.isArray(raw.tabs) && raw.tabs.length > 0) {
          const validTabs: SavedTabRecord[] = [];
          for (const tab of raw.tabs) {
            const val = validateProjectData(tab.project);
            if (val.valid && val.data) {
              validTabs.push({ id: tab.id, name: tab.name, project: val.data });
            }
          }
          if (validTabs.length > 0) {
            return {
              version: 3,
              activeId: raw.activeId || validTabs[0].id,
              tabs: validTabs,
            };
          }
        }
      }
      // 降级与迁移：检查是否有 v2 单工程存储
      const legacyData = this.load();
      if (legacyData) {
        return {
          version: 3,
          activeId: 'tab_migrated',
          tabs: [
            {
              id: 'tab_migrated',
              name: '已恢复工程',
              project: legacyData,
            },
          ],
        };
      }
    } catch (err) {
      console.warn('LocalStorage workspace load failed:', err);
    }
    return null;
  }

  public load(): ProjectData | null {
    if (this._isDisposed) return null;
    try {
      const item = this.store.getItem(this.storageKey);
      if (!item) return null;
      const raw = JSON.parse(item);
      const validation = validateProjectData(raw);
      if (validation.valid) {
        return validation.data;
      } else {
        console.warn('LocalStorage data failed validation:', validation.error);
      }
    } catch (err) {
      console.warn('LocalStorage load failed:', err);
    }
    return null;
  }

  public clear(): StorageSaveResult {
    if (this._isDisposed) return { success: false, error: 'AutosaveService已销毁' };
    this.cancel();
    try {
      this.store.removeItem(this.workspaceStorageKey);
      this.store.removeItem(this.storageKey);
      return { success: true };
    } catch (err) {
      console.warn('LocalStorage clear failed:', err);
      return storageFailure(err);
    }
  }

  public dispose(): void {
    if (this._isDisposed) return;
    this.flush();
    this.cancel();
    this._isDisposed = true;
  }
}
