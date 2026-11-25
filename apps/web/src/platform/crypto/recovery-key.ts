// The recovery key in WebCrypto. Unlike a device's key, it's made extractable,
// once, so its seed can be shown as a code or sealed in a file; Pigeon never stores it. To use
// it, the seed is imported again for as long as one `recover` takes to sign.
import { peerIdFromPublicKey, RECOVERY_SEED_BYTES, type Signer } from '@pigeon/core'

const ED25519 = { name: 'Ed25519' } as const
/** PKCS #8 for an Ed25519 private key, up to the 32-byte seed (RFC 8410). */
const PKCS8_PREFIX = Uint8Array.of(
  0x30,
  0x2e,
  0x02,
  0x01,
  0x00,
  0x30,
  0x05,
  0x06,
  0x03,
  0x2b,
  0x65,
  0x70,
  0x04,
  0x22,
  0x04,
  0x20,
)

export interface NewRecoveryKey {
  /** The public half: what the device log commits to. */
  readonly id: string
  /** The private seed: shown once, never stored. */
  readonly seed: Uint8Array
}

/**
 * The seed in an exported PKCS #8 key: right after the OCTET STRING header that wraps it. A
 * browser may export the v2 form, with the public key after the seed, so it's never the tail.
 */
export function seedFromPkcs8(pkcs8: Uint8Array): Uint8Array | undefined {
  const header = PKCS8_PREFIX.subarray(PKCS8_PREFIX.length - 4)
  for (let at = 0; at + header.length + RECOVERY_SEED_BYTES <= pkcs8.length; at += 1)
    if (header.every((byte, index) => pkcs8[at + index] === byte))
      return pkcs8.slice(at + header.length, at + header.length + RECOVERY_SEED_BYTES)
  return undefined
}

/**
 * A fresh recovery key, or undefined in a browser without Ed25519, or one whose export can't be
 * read back: the seed is signed with again and must give the same key before anyone sees it.
 */
export async function generateRecoveryKey(
  subtle = crypto.subtle,
): Promise<NewRecoveryKey | undefined> {
  let pair: CryptoKeyPair
  try {
    pair = (await subtle.generateKey(ED25519, true, ['sign', 'verify'])) as CryptoKeyPair
  } catch {
    return undefined
  }
  const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey))
  const publicKey = new Uint8Array(await subtle.exportKey('raw', pair.publicKey))
  const seed = seedFromPkcs8(pkcs8)
  pkcs8.fill(0)
  if (seed === undefined) return undefined
  const id = peerIdFromPublicKey(publicKey)
  try {
    if ((await recoverySigner(seed, subtle)).id !== id) return undefined
  } catch {
    return undefined
  }
  return { id, seed }
}

/** Signs with the recovery key whose seed this is. Its id is the key's public half. */
export async function recoverySigner(seed: Uint8Array, subtle = crypto.subtle): Promise<Signer> {
  const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + seed.length)
  pkcs8.set(PKCS8_PREFIX)
  pkcs8.set(seed, PKCS8_PREFIX.length)
  const key = await subtle.importKey('pkcs8', pkcs8, ED25519, true, ['sign'])
  const jwk = await subtle.exportKey('jwk', key)
  const x = (jwk.x ?? '').replaceAll('-', '+').replaceAll('_', '/')
  const publicKey = Uint8Array.from(atob(x + '='.repeat((4 - (x.length % 4)) % 4)), (char) =>
    char.charCodeAt(0),
  )
  return {
    id: peerIdFromPublicKey(publicKey),
    sign: async (data) => new Uint8Array(await subtle.sign(ED25519, key, new Uint8Array(data))),
  }
}
