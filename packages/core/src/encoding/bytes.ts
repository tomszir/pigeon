// Byte encodings the protocol needs, written out so core stays free of platform APIs:
// UTF-8, lowercase base32 (RFC 4648 alphabet, no padding) and hex.
import { err, ok, type Result } from '../result/result.ts'

export function utf8Encode(text: string): Uint8Array {
  const out: number[] = []
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x80) out.push(code)
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63))
    else if (code < 0x10000)
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
    else
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      )
  }
  return Uint8Array.from(out)
}

/** Decodes UTF-8, or fails on a malformed sequence rather than guessing. */
export function utf8Decode(bytes: Uint8Array): Result<string, 'malformed'> {
  let text = ''
  let i = 0
  const cont = (at: number): number => {
    const byte = bytes[at]
    if (byte === undefined || (byte & 0xc0) !== 0x80) return -1
    return byte & 63
  }
  while (i < bytes.length) {
    const lead = bytes[i] ?? 0
    let code: number
    let length: number
    if (lead < 0x80) {
      code = lead
      length = 1
    } else if (lead >= 0xc2 && lead < 0xe0) {
      const a = cont(i + 1)
      if (a < 0) return err('malformed')
      code = ((lead & 31) << 6) | a
      length = 2
    } else if (lead >= 0xe0 && lead < 0xf0) {
      const a = cont(i + 1)
      const b = cont(i + 2)
      if (a < 0 || b < 0) return err('malformed')
      code = ((lead & 15) << 12) | (a << 6) | b
      if (code < 0x800 || (code >= 0xd800 && code < 0xe000)) return err('malformed')
      length = 3
    } else if (lead >= 0xf0 && lead < 0xf5) {
      const a = cont(i + 1)
      const b = cont(i + 2)
      const c = cont(i + 3)
      if (a < 0 || b < 0 || c < 0) return err('malformed')
      code = ((lead & 7) << 18) | (a << 12) | (b << 6) | c
      if (code < 0x10000 || code > 0x10ffff) return err('malformed')
      length = 4
    } else {
      return err('malformed')
    }
    text += String.fromCodePoint(code)
    i += length
  }
  return ok(text)
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

export function base32Encode(bytes: Uint8Array): string {
  let out = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(buffer >> (bits - 5)) & 31]
      bits -= 5
    }
    buffer &= (1 << bits) - 1
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31]
  return out
}

/** Decodes base32 in either case. Leftover bits must be zero so each value has one spelling. */
export function base32Decode(text: string): Result<Uint8Array, 'malformed'> {
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of text.toLowerCase()) {
    const value = BASE32.indexOf(char)
    if (value < 0) return err('malformed')
    buffer = (buffer << 5) | value
    bits += 5
    if (bits >= 8) {
      out.push((buffer >> (bits - 8)) & 255)
      bits -= 8
    }
    buffer &= (1 << bits) - 1
  }
  if (bits >= 5 || buffer !== 0) return err('malformed')
  return ok(Uint8Array.from(out))
}

export function hexEncode(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

export function hexDecode(text: string): Result<Uint8Array, 'malformed'> {
  if (text.length % 2 !== 0 || !/^[0-9a-f]*$/.test(text)) return err('malformed')
  const out = new Uint8Array(text.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16)
  return ok(out)
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i])
}
