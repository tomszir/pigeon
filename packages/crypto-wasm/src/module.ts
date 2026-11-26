// Loading the WebAssembly module, shared by everything built on it.
//
// Nothing loads until something needs it: then the glue wasm-bindgen wrote is imported and the
// module instantiated. Without a `source` the module is instantiated once per page and shared,
// so SPAKE2 and Argon2id use one memory. A failed load is forgotten, so the next call tries
// again.
import type { InitInput } from '../pkg/pigeon_crypto.js'

export type Glue = typeof import('../pkg/pigeon_crypto.js')

/** Where the module's bytes come from, or where to fetch them. */
export type ModuleSource = () => InitInput | Promise<InitInput>

/** A loader for one module. With no `source`, the glue fetches the `.wasm` file beside it. */
function loaderFor(source?: ModuleSource): () => Promise<Glue> {
  let loading: Promise<Glue> | undefined
  return () => {
    loading ??= (async () => {
      const glue = await import('../pkg/pigeon_crypto.js')
      await glue.default(source === undefined ? undefined : { module_or_path: source() })
      return glue
    })().catch((error: unknown) => {
      loading = undefined
      throw error
    })
    return loading
  }
}

const page = loaderFor()

/**
 * The loader for a module made from `source`, or for the page's shared one when there is none.
 * The module is instantiated once per loader, so a `source` given after it has loaded isn't
 * used.
 */
export function moduleLoader(source?: ModuleSource): () => Promise<Glue> {
  return source === undefined ? page : loaderFor(source)
}

export const isBytes = (value: unknown): value is Uint8Array => value instanceof Uint8Array
