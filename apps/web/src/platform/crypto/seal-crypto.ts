// Core's SealCrypto and a device's Sealer on WebCrypto: HPKE from @hpke/core, which
// runs on WebCrypto itself, and ECDH on P-256, HKDF-SHA256 and AES-256-GCM for the older form. A
// device's sealing key is made once, non-extractable like its signing key, so not even the page
// can read its private half; only its public half leaves the browser. HPKE opens with that same
// key: the library is handed the key pair, so it works out the shared secret with WebCrypto and
// never asks for the private half.
import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from '@hpke/core'
import type { SealCrypto, Sealer } from '@pigeon/core'

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const
const copy = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes)

/** RFC 9180 base mode: DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-256-GCM. */
const hpke = new CipherSuite({
  kem: new DhkemP256HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
})

/** A raw P-256 public key as WebCrypto's: refused unless it's a point on the curve. */
const publicKeyOf = (subtle: SubtleCrypto, raw: Uint8Array) =>
  subtle.importKey('raw', copy(raw), ECDH, true, [])

export interface StoredSealingKey {
  readonly privateKey: CryptoKey
  /** Raw P-256, 65 bytes. */
  readonly publicKey: Uint8Array
}

export async function generateSealingKey(subtle = crypto.subtle): Promise<StoredSealingKey> {
  const pair = await subtle.generateKey(ECDH, false, ['deriveBits'])
  const publicKey = new Uint8Array(await subtle.exportKey('raw', pair.publicKey))
  return { privateKey: pair.privateKey, publicKey }
}

export function isStoredSealingKey(value: unknown): value is StoredSealingKey {
  if (typeof value !== 'object' || value === null) return false
  const fields = value as Record<string, unknown>
  return (
    fields['privateKey'] instanceof CryptoKey &&
    fields['publicKey'] instanceof Uint8Array &&
    fields['publicKey'].length === 65
  )
}

async function deriveShared(subtle: SubtleCrypto, privateKey: CryptoKey, peer: Uint8Array) {
  const imported = await subtle.importKey('raw', copy(peer), ECDH, false, [])
  return new Uint8Array(
    await subtle.deriveBits({ name: 'ECDH', public: imported }, privateKey, 256),
  )
}

export function sealerFor(stored: StoredSealingKey, subtle = crypto.subtle): Sealer {
  let publicKey: Promise<CryptoKey> | undefined
  return {
    publicKey: stored.publicKey,
    share: (peer) => deriveShared(subtle, stored.privateKey, peer).catch(() => undefined),
    async hpkeOpen(enc, info, aad, sealed) {
      try {
        publicKey ??= publicKeyOf(subtle, stored.publicKey)
        const recipientKey = { privateKey: stored.privateKey, publicKey: await publicKey }
        const params = { recipientKey, enc: copy(enc).buffer, info: copy(info).buffer }
        return new Uint8Array(await hpke.open(params, copy(sealed).buffer, copy(aad).buffer))
      } catch {
        return undefined
      }
    },
  }
}

export function createWebSealCrypto(subtle = crypto.subtle): SealCrypto {
  const random = (length: number) => crypto.getRandomValues(new Uint8Array(length))
  const aes = (key: Uint8Array, usage: KeyUsage) =>
    subtle.importKey('raw', copy(key), { name: 'AES-GCM' }, false, [usage])
  return {
    async ephemeralShare(peer) {
      const pair = await subtle.generateKey(ECDH, false, ['deriveBits'])
      const publicKey = new Uint8Array(await subtle.exportKey('raw', pair.publicKey))
      return { publicKey, shared: await deriveShared(subtle, pair.privateKey, peer) }
    },
    async hkdf(ikm, info, length) {
      const key = await subtle.importKey('raw', copy(ikm), 'HKDF', false, ['deriveBits'])
      const params = {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(),
        info: new TextEncoder().encode(info),
      }
      return new Uint8Array(await subtle.deriveBits(params, key, length * 8))
    },
    async seal(key, data) {
      const iv = random(12)
      const sealed = await subtle.encrypt(
        { name: 'AES-GCM', iv },
        await aes(key, 'encrypt'),
        copy(data),
      )
      const out = new Uint8Array(12 + sealed.byteLength)
      out.set(iv)
      out.set(new Uint8Array(sealed), 12)
      return out
    },
    async open(key, sealed) {
      if (sealed.length < 28) return undefined
      try {
        const plain = await subtle.decrypt(
          { name: 'AES-GCM', iv: copy(sealed.subarray(0, 12)) },
          await aes(key, 'decrypt'),
          copy(sealed.subarray(12)),
        )
        return new Uint8Array(plain)
      } catch {
        return undefined
      }
    },
    random,
    async hpkeSeal(peer, info, aad, data) {
      const recipientPublicKey = await publicKeyOf(subtle, peer)
      const params = { recipientPublicKey, info: copy(info).buffer }
      const { enc, ct } = await hpke.seal(params, copy(data).buffer, copy(aad).buffer)
      return { enc: new Uint8Array(enc), sealed: new Uint8Array(ct) }
    },
  }
}
