/**
 * 通过注入的 KeyValueStore 自动暂存 (300ms 防抖) 与恢复
 */

import { ProjectData } from '../../types';
import { PortraitDocument } from '../../model/document';
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
