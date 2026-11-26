// Core's Crypto and Signer for Node, with its WebCrypto: the Lighthouse's own key, made on first
// start and kept in a file only its operator can read, and the hashing the mailbox needs.

import { webcrypto } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import {
  type Crypto,
  isCanonicalSignature,
  type PeerId,
  parsePeerId,
  peerIdFromPublicKey,
  type Signer,
} from '@pigeon/core'

const subtle = webcrypto.subtle
const ED25519 = { name: 'Ed25519' } as const
const P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const
const P256_SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const

const copy = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes)

export function createNodeCrypto(subtle = webcrypto.subtle): Crypto {
  const keys = new Map<PeerId, Promise<webcrypto.CryptoKey | null>>()
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
      // One spelling per signature: a high-S P-256 one is a second spelling, refused.
      if (!isCanonicalSignature(signer, signature)) return false
      const imported = await key
      if (imported === null) return false
      const algorithm = imported.algorithm.name === 'Ed25519' ? ED25519 : P256_SIGN
      return subtle.verify(algorithm, imported, copy(signature), copy(data)).catch(() => false)
    },
  }
}

/** The key file: the Ed25519 private key as PKCS#8, base64, and nothing else. */
async function makeKeyFile(path: string): Promise<void> {
  const pair = (await subtle.generateKey(ED25519, true, [
    'sign',
    'verify',
  ])) as webcrypto.CryptoKeyPair
  const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey))
  // `wx` refuses to overwrite: a Lighthouse's key is its identity, so it's never replaced.
  await writeFile(path, `${Buffer.from(pkcs8).toString('base64')}\n`, { mode: 0o600, flag: 'wx' })
}

/** The Lighthouse's signer, from its key file, which is made on first start. */
export async function loadSigner(path: string): Promise<Signer> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await makeKeyFile(path)
    text = await readFile(path, 'utf8')
  }
  const pkcs8 = Buffer.from(text.trim(), 'base64')
  const privateKey = await subtle.importKey('pkcs8', pkcs8, ED25519, true, ['sign'])
  // The public half, from the private key's JWK: `x` is the raw 32-byte Ed25519 public key.
  const jwk = await subtle.exportKey('jwk', privateKey)
  if (jwk.x === undefined) throw new Error('the key file holds no Ed25519 public key')
  const id = peerIdFromPublicKey(new Uint8Array(Buffer.from(jwk.x, 'base64url')))
  return {
    id,
    sign: async (data) => new Uint8Array(await subtle.sign(ED25519, privateKey, copy(data))),
  }
}
