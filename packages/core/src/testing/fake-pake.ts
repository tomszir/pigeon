// A fake PAKE for tests: it behaves like the real one (same password and identities, same key;
// otherwise different keys; malformed messages refused; only bytes taken, and copied at start; one finish per
// start, none after abandon) and protects nothing. Its message is a side byte, 28 bytes from a
// counter and a 4-byte check of them, so bytes it didn't make are refused as the real one
// refuses bytes that aren't a curve point. Its key is a hash of everything.
import { bytesEqual, concatBytes, utf8Encode } from '../encoding/bytes.ts'
import type { Pake, PakeRole, PakeStart } from '../pake/pake.ts'
import { fakeCrypto } from './testing.ts'

const SIDE_BYTE: Record<PakeRole, number> = { a: 0x41, b: 0x42 }
const BODY_BYTES = 28
const MESSAGE_BYTES = 1 + BODY_BYTES + 4

const isBytes = (value: unknown): value is Uint8Array => value instanceof Uint8Array

const check = async (body: Uint8Array) =>
  (await fakeCrypto.sha256(concatBytes(utf8Encode('fake-pake-check:'), body))).subarray(0, 4)

/** Each fakePake numbers its messages from `seed`, so tests repeat. */
export function fakePake(seed = 1): Pake {
  let counter = seed
  const lengthPrefixed = (bytes: Uint8Array) =>
    concatBytes(new Uint8Array([bytes.length >> 8, bytes.length & 255]), bytes)
  return {
    async start(role, password, idA, idB) {
      if (![password, idA, idB].every(isBytes)) throw new TypeError('PAKE inputs must be bytes')
      // Copied now, as the real one copies them into its session.
      const inputs = [password, idA, idB].map((bytes) => bytes.slice())
      counter += 1
      const body = (await fakeCrypto.sha256(utf8Encode(`fake-pake:${counter}`))).subarray(
        0,
        BODY_BYTES,
      )
      const message = concatBytes(new Uint8Array([SIDE_BYTE[role]]), body, await check(body))
      let finished = false
      const start: PakeStart = {
        message,
        async finish(peer) {
          if (finished) throw new Error('PakeStart.finish called after the exchange ended')
          if (!isBytes(peer)) throw new TypeError('a PAKE message must be bytes')
          finished = true
          const other = role === 'a' ? 'b' : 'a'
          if (peer.length !== MESSAGE_BYTES || peer[0] !== SIDE_BYTE[other]) return undefined
          const peerBody = peer.subarray(1, 1 + BODY_BYTES)
          if (!bytesEqual(peer.subarray(1 + BODY_BYTES), await check(peerBody))) return undefined
          const [messageA, messageB] = role === 'a' ? [message, peer] : [peer, message]
          return fakeCrypto.sha256(
            concatBytes(...[...inputs, messageA, messageB].map(lengthPrefixed)),
          )
        },
        abandon() {
          finished = true
        },
      }
      return start
    },
  }
}
