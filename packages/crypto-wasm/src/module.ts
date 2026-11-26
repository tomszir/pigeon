// Loading the WebAssembly module, shared by everything built on it.
//
// Nothing loads until something needs it: then the glue wasm-bindgen wrote is imported and the
// module instantiated. The glue keeps one instance for the whole page (its init returns early
// once there is one), so SPAKE2 and Argon2id share one memory, and whichever `source` loads it
// first is the one used. A later loader with a different `source` is refused rather than
// silently given that instance; loaders with none share the page's. A failed load is forgotten,
// so the next call tries again.
import type { InitInput } from '../pkg/pigeon_crypto.js'

export type Glue = typeof import('../pkg/pigeon_crypto.js')

/** Where the module's bytes come from, or where to fetch them. */
export type ModuleSource = () => InitInput | Promise<InitInput>

/** Who has claimed the page's one instance: the `source` it is loading from, or none. */
let claim: { source: ModuleSource | undefined } | undefined

/** A loader for the module. With no `source`, the glue fetches the `.wasm` file beside it. */
function loaderFor(source?: ModuleSource): () => Promise<Glue> {
  let loading: Promise<Glue> | undefined
  return () => {
    if (loading === undefined) {
      if (claim !== undefined && claim.source !== source)
        return Promise.reject(
          new Error('the WebAssembly module is already loading from a different source'),
        )
      const mine = { source }
      claim = mine
      loading = (async () => {
        const glue = await import('../pkg/pigeon_crypto.js')
        await glue.default(source === undefined ? undefined : { module_or_path: source() })
        return glue
      })().catch((error: unknown) => {
        loading = undefined
        if (claim === mine) claim = undefined
        throw error
      })
    }
    return loading
  }
}

const page = loaderFor()

/**
 * The loader for `source`, or the page's shared one when there is none. Every loader gives the
 * same instance, from whichever source loaded it first; one with another source then fails.
 */
export function moduleLoader(source?: ModuleSource): () => Promise<Glue> {
  return source === undefined ? page : loaderFor(source)
}

export const isBytes = (value: unknown): value is Uint8Array => value instanceof Uint8Array
