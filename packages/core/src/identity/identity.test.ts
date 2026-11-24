import { describe, expect, it } from 'vitest'
import { base32Encode } from '../encoding/bytes.ts'
import { fakeCrypto, fakeSigner } from '../testing/testing.ts'
import { fingerprint, formatFingerprint, pairRoom, parsePeerId } from './identity.ts'

describe('parsePeerId', () => {
  it('knows Ed25519 and P-256 keys by length', () => {
    expect(parsePeerId(base32Encode(new Uint8Array(32)))).toMatchObject({
      ok: true,
      value: { kind: 'ed25519' },
    })
    expect(parsePeerId(base32Encode(new Uint8Array(65)))).toMatchObject({
      ok: true,
      value: { kind: 'p256' },
    })
  })

  it('rejects other lengths, upper case and junk', () => {
    expect(parsePeerId(base32Encode(new Uint8Array(31))).ok).toBe(false)
    expect(parsePeerId(base32Encode(new Uint8Array(32)).toUpperCase()).ok).toBe(false)
    expect(parsePeerId('not a key').ok).toBe(false)
  })
})

it('names the same pair room from either side, and a different one for another pair', async () => {
  const [a, b, c] = ['a', 'b', 'c'].map((name) => fakeSigner(name).id) as [string, string, string]
  const ab = await pairRoom(fakeCrypto, a, b)
  expect(ab).toMatch(/^pair:[a-z2-7]+$/)
  expect(await pairRoom(fakeCrypto, b, a)).toBe(ab)
  expect(await pairRoom(fakeCrypto, a, c)).not.toBe(ab)
})

it('gives a 16-hex fingerprint, spelled in fours', async () => {
  const print = await fingerprint(fakeCrypto, fakeSigner('mika').id)
  expect(print).toMatch(/^[0-9a-f]{16}$/)
  expect(formatFingerprint('7f3a91c204bed817')).toBe('7f3a 91c2 04be d817')
})
