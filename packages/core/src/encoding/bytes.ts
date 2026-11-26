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

/**
 * Decodes base32 only as Pigeon writes it: lowercase letters and 2 to 7, nothing else. Signatures
 * and keys are kept as text, so any other spelling of the same bytes (capitals, or a character
 * such as the Kelvin sign that lowercases to `k`) would be a second copy of the same value.
 */
export function base32DecodeExact(text: string): Result<Uint8Array, 'malformed'> {
  return /^[a-z2-7]*$/.test(text) ? base32Decode(text) : err('malformed')
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

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard base64 with padding: how sealed mail travels in JSON, at a third more than raw. */
export function base64Encode(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const triple = (a << 16) | (b << 8) | c
    out += BASE64[(triple >> 18) & 63]
    out += BASE64[(triple >> 12) & 63]
    out += i + 1 < bytes.length ? BASE64[(triple >> 6) & 63] : '='
    out += i + 2 < bytes.length ? BASE64[triple & 63] : '='
  }
  return out
}

/** Decodes standard padded base64; anything else, unused bits included, is malformed. */
export function base64Decode(text: string): Result<Uint8Array, 'malformed'> {
  if (text.length % 4 !== 0) return err('malformed')
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  const out = new Uint8Array((text.length / 4) * 3 - padding)
  let at = 0
  for (let i = 0; i < text.length; i += 4) {
    let triple = 0
    for (let j = 0; j < 4; j++) {
      const char = text[i + j] ?? ''
      const last = i + 4 === text.length
      if (char === '=' && last && j >= 4 - padding) {
        triple <<= 6
        continue
      }
      const value = BASE64.indexOf(char)
      if (value < 0) return err('malformed')
      triple = (triple << 6) | value
    }
    const chunk = [(triple >> 16) & 255, (triple >> 8) & 255, triple & 255]
    for (const byte of chunk) if (at < out.length) out[at++] = byte
    // Bits past the end must be zero, so each value has one spelling.
    if (i + 4 === text.length && padding > 0 && (triple & ((1 << (8 * padding)) - 1)) !== 0)
      return err('malformed')
  }
  return ok(out)
}
