import { describe, expect, it } from 'vitest'
import { createBrowserCrypto } from './browser-crypto.ts'
import { generateRecoveryKey, recoverySigner, seedFromPkcs8 } from './recovery-key.ts'

describe('recovery keys in WebCrypto (decision 0027)', () => {
  it('sign again from the seed alone, as the same key', async () => {
    const made = await generateRecoveryKey()
    if (made === undefined) return // No Ed25519 here: nothing to test.
    expect(made.seed).toHaveLength(32)
    const signer = await recoverySigner(made.seed)
    expect(signer.id).toBe(made.id)
    const data = new TextEncoder().encode('recover')
    const signature = await signer.sign(data)
    expect(await createBrowserCrypto().verify(made.id, signature, data)).toBe(true)
  })

  it('finds the seed in both PKCS #8 forms, never by taking the last bytes', () => {
    const seed = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
    const v1 = Uint8Array.of(
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
      ...seed,
    )
    // v2 (RFC 8410 OneAsymmetricKey) carries the public key after the seed.
    const publicKey = new Uint8Array(32).fill(0xee)
    const v2 = Uint8Array.of(
      0x30,
      0x51,
      0x02,
      0x01,
      0x01,
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
      ...seed,
      0x81,
      0x21,
      0x00,
      ...publicKey,
    )
    expect(seedFromPkcs8(v1)).toEqual(seed)
    expect(seedFromPkcs8(v2)).toEqual(seed)
    expect(seedFromPkcs8(new Uint8Array(10))).toBeUndefined()
  })
})
