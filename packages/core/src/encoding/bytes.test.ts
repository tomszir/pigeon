import { describe, expect, it } from 'vitest'
import { base32Decode, base32Encode, hexEncode, utf8Decode, utf8Encode } from './bytes.ts'

describe('utf8', () => {
  it('encodes every width of character', () => {
    expect([...utf8Encode('aé鳩🐦')]).toEqual([
      0x61, 0xc3, 0xa9, 0xe9, 0xb3, 0xa9, 0xf0, 0x9f, 0x90, 0xa6,
    ])
  })

  it('round-trips', () => {
    for (const text of ['', 'pigeon', 'café', '鳩', 'coo 🐦'])
      expect(utf8Decode(utf8Encode(text))).toEqual({ ok: true, value: text })
  })

  it('rejects malformed sequences', () => {
    for (const bytes of [[0xff], [0xc3], [0xe9, 0x41], [0xc0, 0x80], [0xed, 0xa0, 0x80]])
      expect(utf8Decode(Uint8Array.from(bytes)).ok).toBe(false)
  })
})

describe('base32', () => {
  it('matches the RFC 4648 vectors, lowercased and unpadded', () => {
    const vectors: [string, string][] = [
      ['', ''],
      ['f', 'my'],
      ['fo', 'mzxq'],
      ['foo', 'mzxw6'],
      ['foob', 'mzxw6yq'],
      ['fooba', 'mzxw6ytb'],
      ['foobar', 'mzxw6ytboi'],
    ]
    for (const [plain, encoded] of vectors) {
      expect(base32Encode(utf8Encode(plain))).toBe(encoded)
      expect(base32Decode(encoded)).toEqual({ ok: true, value: utf8Encode(plain) })
    }
  })

  it('accepts upper case but rejects stray characters and non-zero leftover bits', () => {
    expect(base32Decode('MZXW6').ok).toBe(true)
    expect(base32Decode('mzxw1').ok).toBe(false)
    expect(base32Decode('mz').ok).toBe(false)
    expect(base32Decode('m').ok).toBe(false)
  })
})

it('hex-encodes with leading zeros', () => {
  expect(hexEncode(Uint8Array.from([0, 15, 255]))).toBe('000fff')
})
