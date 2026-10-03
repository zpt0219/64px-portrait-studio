/**
 * localStorage 自动暂存 (300ms 防抖) 与恢复
 */

import { ProjectData, SemanticZone } from '../types';
import { PortraitDocument } from '../model/document';
import { TRANSPARENT_INDEX } from '../data/palette';
import { uint8ArrayToBase64, base64ToUint8Array, validateProjectData } from './projectData';

const STORAGE_KEY = 'imagegem_project_autosave_v2';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let activeStore: KeyValueStore = {
  getItem: (k) => (typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null),
  setItem: (k, v) => { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); },
  removeItem: (k) => { if (typeof localStorage !== 'undefined') localStorage.removeItem(k); },
};

export function setStorageAdapter(store: KeyValueStore): void {
  activeStore = store;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 将文档序列化为 ProjectData
 */
export function documentToProjectData(doc: PortraitDocument): ProjectData {
  return {
    v: 1,
    palette: [...doc.palette],
    pixels: uint8ArrayToBase64(doc.pixelIndices),
    mask: uint8ArrayToBase64(doc.semanticMask),
    hairPreset: doc.currentHairPreset,
    ts: Math.floor(Date.now() / 1000),
  };
}

/**
 * 将 ProjectData 反序列化为文档
 */
export function projectDataToDocument(data: ProjectData): PortraitDocument {
  const pixelIndices = base64ToUint8Array(data.pixels);
  const semanticMask = base64ToUint8Array(data.mask);
  // 系统级不变量保护：透明像素恒不入非背景蒙版
  for (let i = 0; i < pixelIndices.length; i++) {
    if (pixelIndices[i] === TRANSPARENT_INDEX) {
      semanticMask[i] = SemanticZone.Background;
    }
  }
  return {
    palette: data.palette.map((h) => h.toUpperCase()),
    pixelIndices,
    semanticMask,
    currentHairPreset: data.hairPreset,
  };
}

/**
 * 立即保存当前进度至 LocalStorage
 */
function saveProjectImmediate(doc: PortraitDocument): void {
  try {
    const data = documentToProjectData(doc);
    activeStore.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('LocalStorage save failed:', err);
  }
}

/**
 * 300ms 防抖静默保存当前进度
 */
export function saveProjectDebounced(doc: PortraitDocument, onSaved?: () => void): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    saveProjectImmediate(doc);
    if (onSaved) onSaved();
  }, 300);
}

/**
 * 检查是否存在已保存的工程缓存
 */
export function hasSavedProject(): boolean {
  try {
    const item = activeStore.getItem(STORAGE_KEY);
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
    const item = activeStore.getItem(STORAGE_KEY);
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
    activeStore.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('LocalStorage clear failed:', err);
  }
}
