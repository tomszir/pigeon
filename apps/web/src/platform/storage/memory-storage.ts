// A store that forgets on reload: what tests use, and what the browser falls back to when it
// refuses IndexedDB. It implements `Store`, so apps/ and shell/ take one from app/ instead.
import type { Store } from './storage.ts'

/** A store that forgets on reload, for tests and for browsers that refuse IndexedDB. */
export function createMemoryStore(initial: Readonly<Record<string, unknown>> = {}): Store {
  const values = new Map<string, unknown>(Object.entries(initial))
  return {
    get: async (key) => {
      const value = values.get(key)
      return value === undefined ? undefined : structuredClone(value)
    },
    // Copied as IndexedDB copies them, so what it can't keep (a reactive store's proxy, a
    // function) fails here as it would there, and later changes to the value don't leak in.
    set: async (key, value) => void values.set(key, structuredClone(value)),
    delete: async (key) => void values.delete(key),
    clear: async () => values.clear(),
  }
}
