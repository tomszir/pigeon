// Core's Crypto and the Lighthouse's Signer on the Workers runtime's WebCrypto.
import {
  base64Decode,
  type Crypto,
  type PeerId,
  parsePeerId,
  peerIdFromPublicKey,
  type Signer,
} from '@pigeon/core'

const ED25519 = { name: 'Ed25519' } as const
const P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const
const P256_SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const
const copy = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes)

export function createWorkerCrypto(subtle: SubtleCrypto = crypto.subtle): Crypto {
  const keys = new Map<PeerId, Promise<CryptoKey | null>>()
  const importKey = (id: PeerId) => {
    const parsed = parsePeerId(id)
    if (!parsed.ok) return Promise.resolve(null)
    const algorithm = parsed.value.kind === 'ed25519' ? ED25519 : P256
    return subtle
      .importKey('raw', copy(parsed.value.bytes), algorithm, true, ['verify'])
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
      const imported = await key
      if (imported === null) return false
      const algorithm = imported.algorithm.name === 'Ed25519' ? ED25519 : P256_SIGN
      return subtle.verify(algorithm, imported, copy(signature), copy(data)).catch(() => false)
    },
  }
}

/** The Lighthouse's signer, from its key: Ed25519 PKCS#8 in base64. */
export async function signerFromKey(
  base64: string,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<Signer> {
  const pkcs8 = base64Decode(base64.trim())
  if (!pkcs8.ok) throw new Error('LIGHTHOUSE_KEY is not base64')
  const privateKey = await subtle.importKey('pkcs8', copy(pkcs8.value), ED25519, true, ['sign'])
  // The public half, from the private key's JWK: `x` is the raw 32-byte Ed25519 public key.
  const jwk = await subtle.exportKey('jwk', privateKey)
  if (jwk.x === undefined) throw new Error('LIGHTHOUSE_KEY holds no Ed25519 public key')
  const raw = base64Decode(jwk.x.replaceAll('-', '+').replaceAll('_', '/').padEnd(44, '='))
  if (!raw.ok) throw new Error('LIGHTHOUSE_KEY has a malformed public key')
  const id = peerIdFromPublicKey(raw.value)
  return {
    id,
    sign: async (data) => new Uint8Array(await subtle.sign(ED25519, privateKey, copy(data))),
  }
}
