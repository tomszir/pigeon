// WebCrypto behind core's Crypto and Signer. Ed25519 where the browser has it, ECDSA P-256 where
// it doesn't (docs/protocol.md, "Identity"). The private key is made non-extractable and kept as
// a CryptoKey in IndexedDB, so the page can sign with it but never read it.
import {
  type Crypto,
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
const P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const
const P256_SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const

const copy = (bytes: Uint8Array): Bytes => new Uint8Array(bytes)

export async function generateIdentity(subtle = crypto.subtle): Promise<StoredIdentity> {
  let pair: CryptoKeyPair
  try {
    pair = (await subtle.generateKey(ED25519, false, ['sign', 'verify'])) as CryptoKeyPair
  } catch {
    pair = await subtle.generateKey(P256, false, ['sign', 'verify'])
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
  const id = peerIdFromPublicKey(identity.publicKey)
  const algorithm = identity.privateKey.algorithm.name === 'Ed25519' ? ED25519 : P256_SIGN
  return {
    id,
    sign: async (data) =>
      new Uint8Array(await subtle.sign(algorithm, identity.privateKey, copy(data))),
  }
}

export function createBrowserCrypto(subtle = crypto.subtle): Crypto {
  const keys = new Map<PeerId, Promise<CryptoKey | null>>()
  const importKey = (id: PeerId): Promise<CryptoKey | null> => {
    const parsed = parsePeerId(id)
    if (!parsed.ok) return Promise.resolve(null)
    const algorithm = parsed.value.kind === 'ed25519' ? ED25519 : P256
    return subtle
      .importKey('raw', copy(parsed.value.bytes), algorithm, true, ['verify'])
      .catch(() => null)
  }
  return {
    sha256: async (data) => new Uint8Array(await subtle.digest('SHA-256', copy(data))),
    async verify(signer, signature, data) {
      let key = keys.get(signer)
      if (key === undefined) {
        key = importKey(signer)
        keys.set(signer, key)
      }
      const imported = await key
      if (imported === null) return false
      const algorithm = imported.algorithm.name === 'Ed25519' ? ED25519 : P256_SIGN
      return subtle.verify(algorithm, imported, copy(signature), copy(data)).catch(() => false)
    },
  }
}

export const randomBytes = (length: number): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(length))
