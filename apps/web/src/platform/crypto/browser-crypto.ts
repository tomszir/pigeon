// WebCrypto behind core's Crypto and Signer. Keys are Ed25519 (docs/protocol.md, "Identity"). The
// private key is made non-extractable and kept as a CryptoKey in IndexedDB, so the page can sign
// with it but never read it.
import {
  type Crypto,
  isCanonicalSignature,
  type PeerId,
  parsePeerId,
  peerIdFromPublicKey,
  type Signer,
} from '@pigeon/core'

type Bytes = Uint8Array<ArrayBuffer>

/** What storage keeps: the private key as an opaque CryptoKey, the public half as raw bytes. */
export interface StoredIdentity {
  readonly privateKey: CryptoKey
  readonly publicKey: Uint8Array
}

const ED25519 = { name: 'Ed25519' } as const

const copy = (bytes: Uint8Array): Bytes => new Uint8Array(bytes)

/** Thrown by `generateIdentity` in a browser whose WebCrypto has no Ed25519. */
export class NoEd25519Error extends Error {
  constructor() {
    super('This browser’s WebCrypto has no Ed25519')
    this.name = 'NoEd25519Error'
  }
}

/** A new Ed25519 key. There's no fallback: every current browser has Ed25519. */
export async function generateIdentity(subtle = crypto.subtle): Promise<StoredIdentity> {
  let pair: CryptoKeyPair
  try {
    pair = (await subtle.generateKey(ED25519, false, ['sign', 'verify'])) as CryptoKeyPair
  } catch {
    throw new NoEd25519Error()
  }
  const publicKey = new Uint8Array(await subtle.exportKey('raw', pair.publicKey))
  return { privateKey: pair.privateKey, publicKey }
}

export function isStoredIdentity(value: unknown): value is StoredIdentity {
  if (typeof value !== 'object' || value === null) return false
  const fields = value as Record<string, unknown>
  return fields['privateKey'] instanceof CryptoKey && fields['publicKey'] instanceof Uint8Array
}

export function signerFor(identity: StoredIdentity, subtle = crypto.subtle): Signer {
  return {
    id: peerIdFromPublicKey(identity.publicKey),
    sign: async (data) =>
      new Uint8Array(await subtle.sign(ED25519, identity.privateKey, copy(data))),
  }
}

export function createBrowserCrypto(subtle = crypto.subtle): Crypto {
  const keys = new Map<PeerId, Promise<CryptoKey | null>>()
  const importKey = (id: PeerId): Promise<CryptoKey | null> => {
    const parsed = parsePeerId(id)
    if (!parsed.ok) return Promise.resolve(null)
    return subtle
      .importKey('raw', copy(parsed.value.bytes), ED25519, true, ['verify'])
      .catch(() => null)
  }
  return {
    sha256: async (data) => new Uint8Array(await subtle.digest('SHA-256', copy(data))),
    async hmacSha256(key, data) {
      const hmac = { name: 'HMAC', hash: 'SHA-256' } as const
      const imported = await subtle.importKey('raw', copy(key), hmac, false, ['sign'])
      return new Uint8Array(await subtle.sign(hmac, imported, copy(data)))
    },
    async verify(signer, signature, data) {
      let key = keys.get(signer)
      if (key === undefined) {
        key = importKey(signer)
        keys.set(signer, key)
      }
      // One spelling per signature: an Ed25519 S at or past the group order is refused.
      if (!isCanonicalSignature(signer, signature)) return false
      const imported = await key
      if (imported === null) return false
      return subtle.verify(ED25519, imported, copy(signature), copy(data)).catch(() => false)
    },
  }
}

export const randomBytes = (length: number): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(length))
