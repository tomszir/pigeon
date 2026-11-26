// core's Argon2id over the Rust crate's argon2id function (crate/src/argon2id.rs), built to
// WebAssembly.
//
// The module loads on the first derivation (see ../module.ts). The passphrase is copied into the
// module, which wipes its copy and the memory Argon2 filled when it frees them, and the wrapper
// wipes the module's stack afterwards. The call is synchronous inside the module, so it holds
// the thread for as long as the parameters take.
import type { Argon2id } from '@pigeon/core'
import { isBytes, type ModuleSource, moduleLoader } from '../module.ts'

/** The largest count the crate takes: they are 32-bit, and the glue would wrap anything more. */
const MAX_COUNT = 0xffff_ffff

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT

/**
 * `source` gives the module's bytes, or where to fetch them; left out, the glue fetches the
 * `.wasm` file beside it, which is what a bundler emits it as, and the page's one instance is
 * shared. A `source` given after the module has loaded isn't used.
 */
export function createArgon2id(source?: ModuleSource): Argon2id {
  const load = moduleLoader(source)

  return {
    async derive(passphrase, salt, params) {
      // The glue would turn anything else (a string, say) into no bytes at all, and a count
      // that doesn't fit 32 bits into another one.
      if (!isBytes(passphrase) || !isBytes(salt))
        throw new TypeError('Argon2id inputs must be bytes')
      const { memoryKiB, passes, lanes } = params
      if (![memoryKiB, passes, lanes].every(isCount))
        throw new RangeError('Argon2id parameters must be whole numbers that fit 32 bits')
      const glue = await load()
      let key: Uint8Array | undefined
      try {
        key = glue.argon2id(passphrase, salt, memoryKiB, passes, lanes)
      } finally {
        glue.scrubStack()
      }
      if (key === undefined)
        throw new RangeError(
          'Argon2id refused these parameters, or the device has no memory for them',
        )
      return key
    },
  }
}
