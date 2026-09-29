/**
 * localStorage 自动暂存 (300ms 防抖) 与恢复
 */

import { ProjectData, StudioState } from '../types';
import { uint8ArrayToBase64, base64ToUint8Array, validateProjectData } from './projectData';

const STORAGE_KEY = 'imagegem_project_autosave_v2';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 将当前 StudioState 序列化为 ProjectData
 */
export function stateToProjectData(state: StudioState): ProjectData {
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
 * 将 ProjectData 反序列化并导入状态字段
 */
export function projectDataToStatePatch(data: ProjectData): {
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
function saveProjectImmediate(state: StudioState): void {
  if (!state.isLoaded) return;
  try {
    const data = stateToProjectData(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('LocalStorage save failed:', err);
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
export function loadProjectFromStorage(): ProjectData | null {
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
    console.warn('LocalStorage load failed:', err);
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
    console.warn('LocalStorage clear failed:', err);
  }
}
