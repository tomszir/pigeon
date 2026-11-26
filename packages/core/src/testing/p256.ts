// Real ECDSA P-256 for tests, on the runtime's WebCrypto, which takes both spellings of an ECDSA
// signature (s and n - s). Only tests import this; core itself never touches keys.
import { concatBytes } from '../encoding/bytes.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import { parsePeerId, peerIdFromPublicKey } from '../identity/identity.ts'
import { isCanonicalSignature } from '../identity/signature.ts'
import { fakeCrypto } from './testing.ts'

type Key = { readonly algorithm: { readonly name: string } }
interface Subtle {
  generateKey(
    algorithm: object,
    extractable: boolean,
    usages: string[],
  ): Promise<{ publicKey: Key; privateKey: Key }>
  exportKey(format: 'raw', key: Key): Promise<ArrayBuffer>
  importKey(
    format: 'raw',
    data: Uint8Array,
    algorithm: object,
    extractable: boolean,
    usages: string[],
  ): Promise<Key>
  sign(algorithm: object, key: Key, data: Uint8Array): Promise<ArrayBuffer>
  verify(algorithm: object, key: Key, signature: Uint8Array, data: Uint8Array): Promise<boolean>
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>
}

const subtle = (globalThis as unknown as { crypto: { subtle: Subtle } }).crypto.subtle
const P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const
const P256_SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const

/** The order of P-256's base point. */
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n

const toBig = (bytes: Uint8Array) => bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n)
const fromBig = (value: bigint) => {
  const out = new Uint8Array(32)
  for (let at = 31, rest = value; at >= 0; at -= 1, rest >>= 8n) out[at] = Number(rest & 255n)
  return out
}

/** The other spelling of a raw (r || s) P-256 signature: r || n - s. It verifies just the same. */
export const flipS = (signature: Uint8Array): Uint8Array =>
  concatBytes(signature.subarray(0, 32), fromBig(N - toBig(signature.subarray(32))))

/** Whether a raw P-256 signature is the high-S spelling. */
export const isHighS = (signature: Uint8Array): boolean => toBig(signature.subarray(32)) > N / 2n

/**
 * A P-256 signer as WebCrypto makes one. `spelling` forces which of the two spellings it hands
 * out, as a browser may give either: 'webcrypto' leaves it as WebCrypto made it.
 */
export async function p256Signer(
  spelling: 'high' | 'low' | 'webcrypto' = 'webcrypto',
): Promise<Signer> {
  const pair = await subtle.generateKey(P256, false, ['sign', 'verify'])
  const id = peerIdFromPublicKey(new Uint8Array(await subtle.exportKey('raw', pair.publicKey)))
  return {
    id,
    async sign(data) {
      const signature = new Uint8Array(await subtle.sign(P256_SIGN, pair.privateKey, data))
      if (spelling === 'webcrypto' || isHighS(signature) === (spelling === 'high')) return signature
      return flipS(signature)
    },
  }
}

/**
 * Core's Crypto for tests that mix keys: P-256 ids verify with real WebCrypto, refusing a high-S
 * spelling as every platform's Crypto does (or taking it, with `lenient`, as they did before);
 * anything else goes to `fakeCrypto`.
 */
export function p256Crypto({ lenient = false } = {}): Crypto {
  return {
    ...fakeCrypto,
    async verify(signer, signature, data) {
      const parsed = parsePeerId(signer)
      if (!parsed.ok || parsed.value.kind !== 'p256')
        return fakeCrypto.verify(signer, signature, data)
      if (!lenient && !isCanonicalSignature(signer, signature)) return false
      const key = await subtle.importKey('raw', parsed.value.bytes, P256, true, ['verify'])
      return subtle.verify(P256_SIGN, key, signature, data).catch(() => false)
    },
  }
}
