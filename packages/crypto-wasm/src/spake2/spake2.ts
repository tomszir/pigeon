// core's Pake over the Rust crate's SPAKE2 session (crate/src/pake.rs), built to WebAssembly.
//
// The module loads on the first start (see ../module.ts). After every call that handled a
// secret the wrapper wipes the module's stack, and a session is freed (which wipes its heap) as
// soon as it finishes or is abandoned.
import type { Pake, PakeStart } from '@pigeon/core'
import { type Glue, isBytes, type ModuleSource, moduleLoader } from '../module.ts'

/** Bytes in either side's message: a side byte and a compressed Ed25519 point. */
const MESSAGE_BYTES = 33

/**
 * `source` gives the module's bytes, or where to fetch them; left out, the glue fetches the
 * `.wasm` file beside it, which is what a bundler emits it as, and the page's one instance is
 * shared. A `source` given after the module has loaded isn't used.
 */
export function createSpake2Pake(source?: ModuleSource): Pake {
  const load = moduleLoader(source)

  return {
    async start(role, password, idA, idB) {
      // The glue would turn anything else (a string, say) into no bytes at all.
      if (![password, idA, idB].every(isBytes)) throw new TypeError('PAKE inputs must be bytes')
      const glue = await load()
      const side = role === 'a' ? glue.Side.A : glue.Side.B
      let session: InstanceType<Glue['Spake2Session']> | undefined
      try {
        session = new glue.Spake2Session(side, password, idA, idB)
      } finally {
        glue.scrubStack()
      }
      const live = session
      let finished = false
      const end = () => {
        finished = true
        live.free()
        glue.scrubStack()
      }
      const start: PakeStart = {
        message: live.message,
        async finish(peer) {
          if (finished) throw new Error('PakeStart.finish called after the exchange ended')
          if (!isBytes(peer)) throw new TypeError('a PAKE message must be bytes')
          try {
            // Refused before it is copied in, so a huge one can't grow the module's memory.
            if (peer.length !== MESSAGE_BYTES) return undefined
            return live.finish(peer)
          } finally {
            end()
          }
        },
        abandon() {
          if (!finished) end()
        },
      }
      return start
    },
  }
}
