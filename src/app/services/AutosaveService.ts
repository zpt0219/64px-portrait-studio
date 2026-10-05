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
  private pendingOnComplete: ((result: StorageSaveResult) => void) | null = null;
  private _isDisposed = false;

  constructor(
    private readonly store: KeyValueStore = unavailableStore,
    private readonly storageKey: string = STORAGE_KEY
  ) {}

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
    }, 300);
  }

  public cancel(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingDoc = null;
    this.pendingOnComplete = null;
  }

  public flush(): StorageSaveResult | null {
    if (this.debounceTimer || this.pendingDoc) {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      const docToSave = this.pendingDoc;
      const callback = this.pendingOnComplete;
      this.pendingDoc = null;
      this.pendingOnComplete = null;
      if (docToSave) {
        const result = this.saveImmediate(docToSave);
        if (callback) callback(result);
        return result;
      }
    }
    return null;
  }

  public hasSaved(): boolean {
    return this.load() !== null;
  }

  public load(): ProjectData | null {
    if (this._isDisposed) return null;
    try {
      const item = this.store.getItem(this.storageKey);
      if (!item) return null;
      const raw = JSON.parse(item);
      const validation = validateProjectData(raw);
      if (validation.valid && validation.data) {
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
