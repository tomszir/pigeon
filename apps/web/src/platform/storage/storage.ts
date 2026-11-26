// Where Pigeon keeps things between visits: a small key-value store. Values come back as
// `unknown` and every reader checks their shape, since storage outlives the code that wrote it.

export interface Store {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  /** Forgets everything, the identity too: a copied profile made into a new device. */
  clear(): Promise<void>
}
