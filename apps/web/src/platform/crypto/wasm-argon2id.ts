// core's Argon2id in the browser: the argon2 crate from packages/crypto-wasm. Wherever this is
// used, Vite emits the WebAssembly and the glue that loads it as files of their own, fetched
// the first time a passphrase is stretched rather than with the page.
import type { Argon2id } from '@pigeon/core'
import { createArgon2id } from '@pigeon/crypto-wasm'

export function createWasmArgon2id(): Argon2id {
  return createArgon2id()
}
