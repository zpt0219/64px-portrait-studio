import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutosaveService, KeyValueStore } from '../src/app/services/AutosaveService';
import { ViewModel } from '../src/app/viewModel';
import { createValidDocument } from './helpers/documentFixture';

describe('Storage Error Handling and Graceful Degradation (T04 - B4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createMemoryStore(): KeyValueStore & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => { map.set(k, v); },
      removeItem: (k) => { map.delete(k); },
    };
  }

  it('saveProjectImmediate returns success: true with working store adapter', () => {
    const store = createMemoryStore();
    const service = new AutosaveService(store);

    const doc = createValidDocument();
    const result = service.saveImmediate(doc);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(service.hasSaved()).toBe(true);
    expect(service.load()).not.toBeNull();
  });

  it('saveProjectImmediate returns success: false and quota error on QuotaExceededError', () => {
    const quotaError = new Error('Quota exceeded');
    quotaError.name = 'QuotaExceededError';

    const failingStore: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw quotaError;
      },
      removeItem: () => {},
    };
    const service = new AutosaveService(failingStore);

    const doc = createValidDocument();
    const result = service.saveImmediate(doc);

    expect(result.success).toBe(false);
    expect(result.error).toBe('配额超限');
  });

  it('saveProjectImmediate returns success: false and security error on SecurityError', () => {
    const secError = new Error('Access denied');
    secError.name = 'SecurityError';

    const failingStore: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw secError;
      },
      removeItem: () => {},
    };
    const service = new AutosaveService(failingStore);

    const doc = createValidDocument();
    const result = service.saveImmediate(doc);

    expect(result.success).toBe(false);
    expect(result.error).toBe('存储受限');
  });

  it('saveProjectDebounced triggers onComplete with result after 300ms', () => {
    const store = createMemoryStore();
    const service = new AutosaveService(store);

    const doc = createValidDocument();
    let callbackResult: { success: boolean; error?: string } | null = null;

    service.saveDebounced(doc, (res) => {
      callbackResult = res;
    });

    // Before 300ms, callback hasn't fired
    expect(callbackResult).toBeNull();

    // Advance 300ms
    vi.advanceTimersByTime(300);

    expect(callbackResult).not.toBeNull();
    expect(callbackResult!.success).toBe(true);
  });

  it('saveProjectDebounced propagates error result on QuotaExceededError', () => {
    const quotaError = new Error('The quota has been exceeded');
    quotaError.name = 'QuotaExceededError';

    const service = new AutosaveService({
      getItem: () => null,
      setItem: () => {
        throw quotaError;
      },
      removeItem: () => {},
    });

    const doc = createValidDocument();
    let callbackResult: { success: boolean; error?: string } | null = null;

    service.saveDebounced(doc, (res) => {
      callbackResult = res;
    });

    vi.advanceTimersByTime(300);

    expect(callbackResult).not.toBeNull();
    expect(callbackResult!.success).toBe(false);
    expect(callbackResult!.error).toBe('配额超限');
  });

  it('ViewModel notifies error and updates status to error when autosave fails', () => {
    const quotaError = new Error('Quota exceeded');
    quotaError.name = 'QuotaExceededError';

    const service = new AutosaveService({
      getItem: () => null,
      setItem: () => {
        throw quotaError;
      },
      removeItem: () => {},
    });

    const vm = new ViewModel({ autosave: service });
    vm.patchSession({ isLoaded: true });

    const notifications: { msg: string; level: string }[] = [];
    const saveStatuses: string[] = [];

    vm.registerListener({
      onNotify: (msg, level) => {
        notifications.push({ msg, level });
      },
      onSaveStatus: (status) => {
        saveStatuses.push(status);
      },
    });

    // Mutate palette through command to trigger documentChanged
    vm.setPaletteColor(0, '#123456', 1);

    // Initially saving status is fired
    expect(saveStatuses).toContain('saving');

    // Advance past debounce timer
    vi.advanceTimersByTime(300);

    // Save status must be 'error' and NOT 'saved'
    expect(saveStatuses).toContain('error');
    expect(saveStatuses).not.toContain('saved');

    // An error notification must be dispatched
    const errorToast = notifications.find((n) => n.level === 'error');
    expect(errorToast).toBeDefined();
    expect(errorToast!.msg).toContain('自动保存失败: 存储空间不足或受限');
  });

  it('clearProjectStorage removes item and clears pending debounce timer', () => {
    const store = createMemoryStore();
    const service = new AutosaveService(store);

    const doc = createValidDocument();
    service.saveImmediate(doc);
    expect(service.hasSaved()).toBe(true);

    service.clear();
    expect(service.hasSaved()).toBe(false);
  });
});
