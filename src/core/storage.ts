/**
 * ImageGem 本地持久化缓存模块 (LocalStorage)
 * 提供 300ms 防抖自动静默存盘与异常关闭恢复功能
 * 数据模型与工程 PNG 内嵌 tEXt 结构完全统一
 */

import { ImageGemProjectData, StudioState } from '../types';
import { uint8ArrayToBase64, base64ToUint8Array, validateProjectData } from './pngMetadata';

const STORAGE_KEY = 'imagegem_project_autosave_v2';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 将当前 StudioState 序列化为 ImageGemProjectData
 */
export function stateToProjectData(state: StudioState): ImageGemProjectData {
  return {
    v: 1,
    palette: [...state.palette],
    pixels: uint8ArrayToBase64(state.pixelIndices),
    mask: uint8ArrayToBase64(state.semanticMask),
    hairPreset: state.currentHairPreset,
    ts: Math.floor(Date.now() / 1000),
  };
}

/**
 * 将 ImageGemProjectData 反序列化并导入状态字段
 */
export function projectDataToStatePatch(data: ImageGemProjectData): {
  palette: string[];
  pixelIndices: Uint8Array;
  semanticMask: Uint8Array;
  currentHairPreset: string | null;
} {
  return {
    palette: [...data.palette],
    pixelIndices: base64ToUint8Array(data.pixels),
    semanticMask: base64ToUint8Array(data.mask),
    currentHairPreset: data.hairPreset,
  };
}

/**
 * 立即保存当前进度至 LocalStorage
 */
export function saveProjectImmediate(state: StudioState): void {
  if (!state.isLoaded) return;
  try {
    const data = stateToProjectData(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('ImageGem LocalStorage save failed:', err);
  }
}

/**
 * 300ms 防抖静默保存当前进度
 */
export function saveProjectDebounced(state: StudioState, onSaved?: () => void): void {
  if (!state.isLoaded) return;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    saveProjectImmediate(state);
    if (onSaved) onSaved();
  }, 300);
}

/**
 * 检查是否存在已保存的工程缓存
 */
export function hasSavedProject(): boolean {
  try {
    const item = localStorage.getItem(STORAGE_KEY);
    return item !== null && item.length > 50;
  } catch {
    return false;
  }
}

/**
 * 从 LocalStorage 读取已保存的工程并严格校验
 */
export function loadProjectFromStorage(): ImageGemProjectData | null {
  try {
    const item = localStorage.getItem(STORAGE_KEY);
    if (!item) return null;
    const raw = JSON.parse(item);
    const validation = validateProjectData(raw);
    if (validation.valid && validation.data) {
      return validation.data;
    } else {
      console.warn('LocalStorage data failed validation:', validation.error);
    }
  } catch (err) {
    console.warn('ImageGem LocalStorage load failed:', err);
  }
  return null;
}

/**
 * 清除 LocalStorage 中的缓存
 */
export function clearProjectStorage(): void {
  try {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('ImageGem LocalStorage clear failed:', err);
  }
}
