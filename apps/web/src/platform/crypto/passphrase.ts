// Sealing with a passphrase, for files you keep yourself: the export of your data, and the
// recovery key's file. The passphrase is stretched into an AES-256-GCM key and the sealed text
// is one line, so it can sit in a .txt.
//
// New files are version 2: Argon2id (RFC 9106, memory-hard, so a guess costs a GPU far more
// than PBKDF2's) with its parameters in the line. The key comes out of WebAssembly as 32 bytes
// that go straight into a non-extractable WebCrypto key and are wiped. Version 1 files, from
// before, used PBKDF2-SHA256 in WebCrypto; they still open, and nothing writes them any more.
import type { Argon2id, Argon2idParams } from '@pigeon/core'

const V1 = 'pigeon-sealed:v1'
const V2 = 'pigeon-sealed:v2'

/** What new files are sealed with: RFC 9106's second recommended option (64 MiB, 3 passes). */
export const ARGON2ID_PARAMS: Argon2idParams = { memoryKiB: 64 * 1024, passes: 3, lanes: 4 }

/**
 * The most a file may ask for. A file's parameters are its writer's, so a hostile one could
 * ask for gigabytes or minutes; this is twice the memory of what Pigeon writes and four times
 * the work, which a phone can bear.
 */
export const ARGON2ID_LIMITS: Argon2idParams = { memoryKiB: 128 * 1024, passes: 6, lanes: 4 }

/** Rounds Pigeon wrote to version 1 files; one may ask for up to ten million. */
const MAX_V1_ROUNDS = 10_000_000

const SALT_BYTES = 16
const IV_BYTES = 12
const TAG_BYTES = 16

type Bytes = Uint8Array<ArrayBuffer>

function toBase64(bytes: Uint8Array): string {
  // In slices: spreading a large export into one call overflows the stack.
  let text = ''
  for (let at = 0; at < bytes.length; at += 0x8000)
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(text)
}
function fromBase64(text: string): Bytes | undefined {
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
  } catch {
    return undefined
  }
}
/** Base64 with one spelling: what `toBase64` writes, and nothing that decodes to the same bytes. */
function fromCanonicalBase64(text: string): Bytes | undefined {
  const bytes = fromBase64(text)
  return bytes !== undefined && toBase64(bytes) === text ? bytes : undefined
}

/** A count written as plain decimal digits, no sign, spaces, exponent or leading zero. */
function readCount(text: string | undefined): number | undefined {
  if (text === undefined || !/^[1-9][0-9]{0,9}$/.test(text)) return undefined
  return Number(text)
}

/** Whether Argon2id would take these and a file may ask for them. */
function withinLimits(params: Argon2idParams): boolean {
  const { memoryKiB, passes, lanes } = params
  return (
    Number.isSafeInteger(memoryKiB) &&
    Number.isSafeInteger(passes) &&
    Number.isSafeInteger(lanes) &&
    lanes >= 1 &&
    lanes <= ARGON2ID_LIMITS.lanes &&
    passes >= 1 &&
    passes <= ARGON2ID_LIMITS.passes &&
    memoryKiB >= 8 * lanes &&
    memoryKiB <= ARGON2ID_LIMITS.memoryKiB
  )
}

export interface PassphraseSealOptions {
  /** Stretches passphrases for version 2 files. Version 1 files need none. */
  argon2id: Argon2id
  /** Cost of new files; Pigeon's own choice unless a test wants it quick. Must be within limits. */
  params?: Argon2idParams
  subtle?: SubtleCrypto
}

/** Seals bytes with a passphrase into one line of text, and opens it again. */
export interface PassphraseSealer {
  /** "pigeon-sealed:v2:<memory KiB>:<passes>:<lanes>:<salt>:<iv>:<sealed>", base64. */
  seal(passphrase: string, data: Uint8Array): Promise<string>
  /**
   * The data, or undefined for a wrong passphrase, parameters beyond what a file may ask for, or
   * text that isn't sealed by Pigeon. Throws when the passphrase can't be stretched (no memory
   * for it, or the WebAssembly didn't load), which says nothing about the passphrase.
   */
  open(passphrase: string, text: string): Promise<Uint8Array | undefined>
}

export function createPassphraseSeal(options: PassphraseSealOptions): PassphraseSealer {
  const { argon2id, params = ARGON2ID_PARAMS, subtle = crypto.subtle } = options
  if (!withinLimits(params)) throw new RangeError('Argon2id parameters out of range')

  /** The passphrase as UTF-8 of its NFC form, so the same text on any keyboard is one key. */
  const passphraseBytes = (passphrase: string) =>
    new TextEncoder().encode(passphrase.normalize('NFC'))

  const aesKey = (raw: Bytes) =>
    subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])

  async function argon2idKey(passphrase: string, salt: Bytes, costs: Argon2idParams) {
    const typed = passphraseBytes(passphrase)
    let raw: Uint8Array | undefined
    try {
      raw = await argon2id.derive(typed, salt, costs)
      return await aesKey(raw as Bytes)
    } finally {
      typed.fill(0)
      raw?.fill(0)
    }
  }

  async function pbkdf2Key(passphrase: string, salt: Bytes, rounds: number) {
    const typed = passphraseBytes(passphrase)
    try {
      const base = await subtle.importKey('raw', typed, 'PBKDF2', false, ['deriveKey'])
      return await subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      )
    } finally {
      typed.fill(0)
    }
  }

  async function decrypt(key: CryptoKey, iv: Bytes, sealed: Bytes) {
    try {
      return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv }, key, sealed))
    } catch {
      return undefined
    }
  }

  async function seal(passphrase: string, data: Uint8Array): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
    const key = await argon2idKey(passphrase, salt, params)
    const sealed = new Uint8Array(
      await subtle.encrypt({ name: 'AES-GCM', iv }, key, new Uint8Array(data)),
    )
    return [
      V2,
      params.memoryKiB,
      params.passes,
      params.lanes,
      toBase64(salt),
      toBase64(iv),
      toBase64(sealed),
    ].join(':')
  }

  async function openV2(passphrase: string, parts: string[]) {
    if (parts.length !== 8) return undefined
    const [, , memory, passes, lanes, salt, iv, sealed] = parts
    const [memoryKiB, passCount, laneCount] = [memory, passes, lanes].map(readCount)
    if (memoryKiB === undefined || passCount === undefined || laneCount === undefined)
      return undefined
    const costs = { memoryKiB, passes: passCount, lanes: laneCount }
    // Before anything is allocated or derived: a file's numbers are its writer's.
    if (!withinLimits(costs)) return undefined
    const [saltBytes, ivBytes, sealedBytes] = [salt, iv, sealed].map((part) =>
      fromCanonicalBase64(part ?? ''),
    )
    if (saltBytes?.length !== SALT_BYTES || ivBytes?.length !== IV_BYTES) return undefined
    // Nothing shorter than the GCM tag can open, so don't spend the memory finding out.
    if (sealedBytes === undefined || sealedBytes.length < TAG_BYTES) return undefined
    return decrypt(await argon2idKey(passphrase, saltBytes, costs), ivBytes, sealedBytes)
  }

  async function openV1(passphrase: string, parts: string[]) {
    if (parts.length !== 6) return undefined
    const [, , rounds, salt, iv, sealed] = parts
    const count = readCount(rounds)
    const saltBytes = fromBase64(salt ?? '')
    const ivBytes = fromBase64(iv ?? '')
    const sealedBytes = fromBase64(sealed ?? '')
    if (count === undefined || count > MAX_V1_ROUNDS) return undefined
    if (saltBytes === undefined || ivBytes === undefined || sealedBytes === undefined)
      return undefined
    return decrypt(await pbkdf2Key(passphrase, saltBytes, count), ivBytes, sealedBytes)
  }

  async function open(passphrase: string, text: string): Promise<Uint8Array | undefined> {
    const line = text
      .split(/\r?\n/)
      .map((part) => part.trim())
      .find((part) => /^pigeon-sealed:v[12]:/.test(part))
    if (line === undefined) return undefined
    const parts = line.split(':')
    const version = `${parts[0]}:${parts[1]}`
    if (version === V2) return openV2(passphrase, parts)
    if (version === V1) return openV1(passphrase, parts)
    return undefined
  }

  return { seal, open }
}
