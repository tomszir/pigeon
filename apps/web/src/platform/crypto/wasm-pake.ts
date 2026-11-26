// core's Pake in the browser: SPAKE2 from packages/crypto-wasm. Wherever this is used, Vite
// emits the WebAssembly and the glue that loads it as files of their own, fetched the first time
// an exchange starts rather than with the page.
import type { Pake } from '@pigeon/core'
import { createSpake2Pake } from '@pigeon/crypto-wasm'

export function createWasmPake(): Pake {
  return createSpake2Pake()
}
