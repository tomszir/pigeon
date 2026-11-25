// Where Pigeon keeps things between visits: a small key-value store. Values come back as
// `unknown` and every reader checks their shape, since storage outlives the code that wrote it.

export interface Store {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  /** Forgets everything, the identity too: a copied profile made into a new device (0028). */
  clear(): Promise<void>
}

/** A store that forgets on reload, for tests and for browsers that refuse IndexedDB. */
export function createMemoryStore(initial: Readonly<Record<string, unknown>> = {}): Store {
  const values = new Map<string, unknown>(Object.entries(initial))
  return {
    get: async (key) => values.get(key),
    set: async (key, value) => void values.set(key, value),
    delete: async (key) => void values.delete(key),
    clear: async () => values.clear(),
  }
}
