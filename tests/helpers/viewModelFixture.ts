import { ViewModel } from '../../src/app/viewModel';
import { AutosaveService, KeyValueStore } from '../../src/app/services/AutosaveService';
import { ExportBackend } from '../../src/app/ports';

export function createMemoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: key => { map.delete(key); },
  };
}

export function createTestViewModel(options?: { autosave?: AutosaveService; exports?: ExportBackend }): ViewModel {
  return new ViewModel({ autosave: new AutosaveService(createMemoryStore()), ...options });
}
