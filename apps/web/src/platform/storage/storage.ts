// Where Pigeon keeps things between visits: a small key-value store. Values come back as
// `unknown` and every reader checks their shape, since storage outlives the code that wrote it.

export interface Store {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  /** Forgets everything, the identity too: a copied profile made into a new device. */
  clear(): Promise<void>
}

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
