import {
  canonicalSignature,
  encodePairSecret,
  isCanonicalSignature,
  isPeerId,
  PAIR_SECRET_BYTES,
  pairPassword,
  parsePeerId,
} from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import {
  createBrowserCrypto,
  generateIdentity,
  isStoredIdentity,
  NoEd25519Error,
  signerFor,
} from './browser-crypto.ts'

const bytes = (text: string) => new TextEncoder().encode(text)
const hex = (data: Uint8Array) =>
  [...data].map((byte) => byte.toString(16).padStart(2, '0')).join('')

describe('browser crypto', () => {
  it('signs with a non-extractable key that verifies under its PeerId, and nothing else', async () => {
    const identity = await generateIdentity()
    expect(isStoredIdentity(identity)).toBe(true)
    expect(identity.privateKey.extractable).toBe(false)
    const signer = signerFor(identity)
    expect(isPeerId(signer.id)).toBe(true)

    const crypto = createBrowserCrypto()
    const signature = await signer.sign(bytes('coo'))
    expect(await crypto.verify(signer.id, signature, bytes('coo'))).toBe(true)
    expect(await crypto.verify(signer.id, signature, bytes('coo!'))).toBe(false)
    const other = signerFor(await generateIdentity())
    expect(await crypto.verify(other.id, signature, bytes('coo'))).toBe(false)
    expect(await crypto.verify('junk', signature, bytes('coo'))).toBe(false)
  })

  it('makes no P-256 key where Ed25519 is missing', async () => {
    const subtle = crypto.subtle
    const noEd25519 = new Proxy(subtle, {
      get(target, key) {
        if (key === 'generateKey')
          return (algorithm: AlgorithmIdentifier, ...rest: [boolean, KeyUsage[]]) =>
            (algorithm as Algorithm).name === 'Ed25519'
              ? Promise.reject(new Error('NotSupportedError'))
              : target.generateKey(algorithm as EcKeyGenParams, ...rest)
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    await expect(generateIdentity(noEd25519)).rejects.toBeInstanceOf(NoEd25519Error)
  })

  it('keeps a P-256 identity from before working, signing low-S and refusing high-S', async () => {
    const P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const
    const pair = await crypto.subtle.generateKey(P256, false, ['sign', 'verify'])
    const identity = {
      privateKey: pair.privateKey,
      publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
    }
    expect(isStoredIdentity(identity)).toBe(true)
    const signer = signerFor(identity)
    expect(parsePeerId(signer.id)).toMatchObject({ ok: true, value: { kind: 'p256' } })
    const verifier = createBrowserCrypto()
    // WebCrypto gives either spelling, about half each: enough tries see both.
    for (let tries = 0; tries < 16; tries += 1) {
      const signature = await signer.sign(bytes('coo'))
      expect(isCanonicalSignature(signer.id, signature)).toBe(true)
      expect(await verifier.verify(signer.id, signature, bytes('coo'))).toBe(true)
    }
    let high: Uint8Array | undefined
    for (let tries = 0; tries < 64 && high === undefined; tries += 1) {
      const raw = new Uint8Array(
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, bytes('coo')),
      )
      if (!isCanonicalSignature(signer.id, raw)) high = raw
    }
    if (high === undefined) throw new Error('no high-S signature in 64 tries')
    expect(await verifier.verify(signer.id, high, bytes('coo'))).toBe(false)
    const low = canonicalSignature(signer.id, high)
    expect(await verifier.verify(signer.id, low, bytes('coo'))).toBe(true)
  })

  it('computes HMAC-SHA256 (RFC 4231, case 2)', async () => {
    const mac = await createBrowserCrypto().hmacSha256(
      new TextEncoder().encode('Jefe'),
      new TextEncoder().encode('what do ya want for nothing?'),
    )
    expect(hex(mac)).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
  })

  it('derives the pair password as WebCrypto’s own HKDF does', async () => {
    const secret = new Uint8Array(PAIR_SECRET_BYTES).fill(9)
    const ikm = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0),
        info: new TextEncoder().encode('pigeon/pair/password'),
      },
      ikm,
      256,
    )
    const ours = await pairPassword(createBrowserCrypto(), encodePairSecret(secret))
    // The password is base32, like a secret: the same encoding of the 32 derived bytes.
    expect(ours).toBe(encodePairSecret(new Uint8Array(bits)))
  })
})
