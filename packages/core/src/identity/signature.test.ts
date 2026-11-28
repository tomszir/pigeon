import { describe, expect, it } from 'vitest'
import { fakeSigner } from '../testing/testing.ts'
import { isCanonicalSignature } from './signature.ts'

describe('signature spellings', () => {
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
    // S + 1 = L: the same signature spelled again, as RFC 8032 forbids.
    signature[32] = (signature[32] ?? 0) + 1
    expect(isCanonicalSignature(ed25519, signature)).toBe(false)
    expect(isCanonicalSignature(ed25519, new Uint8Array(63))).toBe(false)
    expect(isCanonicalSignature('not a key', new Uint8Array(64))).toBe(false)
  })
})
