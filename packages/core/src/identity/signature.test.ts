import { describe, expect, it } from 'vitest'
import { utf8Encode } from '../encoding/bytes.ts'
import { flipS, isHighS, p256Crypto, p256Signer } from '../testing/p256.ts'
import { fakeSigner } from '../testing/testing.ts'
import { canonicalSignature, isCanonicalSignature } from './signature.ts'

describe('signature spellings', () => {
  it('take only the low-S spelling of a P-256 signature, which is the same signature', async () => {
    const signer = await p256Signer('high')
    const data = utf8Encode('coo')
    const high = await signer.sign(data)
    expect(isHighS(high)).toBe(true)
    expect(isCanonicalSignature(signer.id, high)).toBe(false)
    const low = canonicalSignature(signer.id, high)
    expect(isHighS(low)).toBe(false)
    expect(low).toEqual(flipS(high))
    expect(isCanonicalSignature(signer.id, low)).toBe(true)
    expect(canonicalSignature(signer.id, low)).toBe(low)
    expect(await p256Crypto().verify(signer.id, low, data)).toBe(true)
    expect(await p256Crypto().verify(signer.id, high, data)).toBe(false)
    expect(await p256Crypto({ lenient: true }).verify(signer.id, high, data)).toBe(true)
  })

  it('take an Ed25519 signature whose S is below the group order, as it is', () => {
    const ed25519 = fakeSigner('ed').id
    const signature = new Uint8Array(64)
    // S = L - 1, little-endian: the largest S there is.
    const below = (1n << 252n) + 27742317777372353535851937790883648492n
    for (let at = 0, rest = below; at < 32; at += 1, rest >>= 8n)
      signature[32 + at] = Number(rest & 255n)
    const copy = signature.slice()
    expect(isCanonicalSignature(ed25519, signature)).toBe(true)
    expect(signature).toEqual(copy)
    expect(canonicalSignature(ed25519, signature)).toBe(signature)
    // S + 1 = L: the same signature spelled again, as RFC 8032 forbids.
    signature[32] = (signature[32] ?? 0) + 1
    expect(isCanonicalSignature(ed25519, signature)).toBe(false)
    expect(isCanonicalSignature(ed25519, new Uint8Array(63))).toBe(false)
    expect(isCanonicalSignature('not a key', new Uint8Array(64))).toBe(false)
  })

  it('refuse a P-256 signature that isn’t 64 bytes', async () => {
    const signer = await p256Signer()
    expect(isCanonicalSignature(signer.id, new Uint8Array(63))).toBe(false)
    expect(isCanonicalSignature(signer.id, new Uint8Array(72))).toBe(false)
    // r or s of 0, and r at or past n, are no signature.
    expect(isCanonicalSignature(signer.id, new Uint8Array(64))).toBe(false)
    const big = new Uint8Array(64).fill(0xff)
    big.fill(1, 32)
    expect(isCanonicalSignature(signer.id, big)).toBe(false)
  })
})
