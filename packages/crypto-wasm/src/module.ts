// Loading the WebAssembly module, shared by everything built on it.
//
// Nothing loads until something needs it: then the glue wasm-bindgen wrote is imported and the
// module instantiated. The glue keeps one instance for the whole page (its init returns early
// once there is one), so SPAKE2 and Argon2id share one memory, and whichever `source` loads it
// first is the one used. A later loader with the same `source` joins it without calling the
// source again, and one with a different `source` is refused rather than silently given that
// instance; loaders with none share the page's. A failed load is forgotten, so the next call
// tries again.
import type { InitInput } from '../pkg/pigeon_crypto.js'

export type Glue = typeof import('../pkg/pigeon_crypto.js')

/** Where the module's bytes come from, or where to fetch them. */
export type ModuleSource = () => InitInput | Promise<InitInput>

/** The page's one instance, once a load has started, and the `source` that started it. */
let instance: Promise<Glue> | undefined
let claim: { source: ModuleSource | undefined } | undefined

/**
 * The loader for `source`, or the page's shared one when there is none. Every loader gives the
 * same instance, from whichever source started the load first, and joins a load in flight
 * without calling its own source; a loader with another source then fails. Only a failed load
 * is forgotten, and then for everyone, since nothing is loaded.
 */
export function moduleLoader(source?: ModuleSource): () => Promise<Glue> {
  return () => {
    if (instance !== undefined) {
      if (claim?.source !== source)
        return Promise.reject(
          new Error('the WebAssembly module is already loading from a different source'),
        )
      return instance
    }
    claim = { source }
    const loading = (async () => {
      const glue = await import('../pkg/pigeon_crypto.js')
      await glue.default(source === undefined ? undefined : { module_or_path: source() })
      return glue
    })().catch((error: unknown) => {
      instance = undefined
      claim = undefined
      throw error
    })
    instance = loading
    return loading
  }
}

export const isBytes = (value: unknown): value is Uint8Array => value instanceof Uint8Array
