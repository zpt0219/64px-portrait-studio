import type { KeyValueStore } from '../services/AutosaveService';

/** Acquire storage lazily so restricted origins can still initialize the App. */
export function createBrowserStorage(getStorage: () => Storage = () => window.localStorage): KeyValueStore {
  return {
    getItem: key => getStorage().getItem(key),
    setItem: (key, value) => getStorage().setItem(key, value),
    removeItem: key => getStorage().removeItem(key),
  };
}
