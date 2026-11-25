// Invites: an 8-character code to type, and a short link that carries the code plus
// the inviter's fingerprint. The code names the `invite:<code>` room; the fingerprint lets whoever
// opens the link check the inviter is who the link says. A typed code carries no fingerprint, so
// the two people compare fingerprints by eye.
import { base32Decode, base32Encode, hexDecode, hexEncode } from '../encoding/bytes.ts'
import { err, ok, type Result } from '../result/result.ts'

/** 5 bytes, 40 bits: 8 base32 characters. Enough for a code that lives 30 minutes and pairs once. */
export const INVITE_CODE_BYTES = 5
export const INVITE_CODE_LENGTH = 8
export const INVITE_LIFETIME_MS = 30 * 60 * 1000
/** Fingerprints are 8 bytes (16 hex); in a link they're 13 base32 characters. */
const FINGERPRINT_LENGTH = 13

export interface Invite {
  readonly code: string
  /** The inviter's fingerprint, known when the invite came as a link. */
  readonly fingerprint?: string
}

export const inviteCode = (random: Uint8Array): string => base32Encode(random)

export const inviteRoom = (code: string): `invite:${string}` => `invite:${code}`

/** "K7RT-VP2B": how a code is shown and read out. */
export const formatInviteCode = (code: string): string =>
  `${code.slice(0, 4)}-${code.slice(4)}`.toUpperCase()

/** The part after `#` in an invite link: `i/<code><fingerprint>`. */
export function encodeInviteLink(code: string, fingerprint: string): string {
  const bytes = hexDecode(fingerprint)
  if (!bytes.ok) throw new Error(`encodeInviteLink: fingerprint is not hex: ${fingerprint}`)
  return `i/${code}${base32Encode(bytes.value)}`
}

/** Letters people misread for digits base32 doesn't have. */
const LOOKALIKES: Readonly<Record<string, string>> = { '0': 'o', '1': 'l', '8': 'b' }

function readCode(text: string): string | undefined {
  const code = text
    .toLowerCase()
    .replace(/[\s-]/g, '')
    .replace(/[018]/g, (digit) => LOOKALIKES[digit] ?? digit)
  if (code.length !== INVITE_CODE_LENGTH) return undefined
  const bytes = base32Decode(code)
  return bytes.ok ? code : undefined
}

/**
 * Reads whatever someone pasted or typed: a whole link, the part after `#`, or a code with or
 * without its dash, in any case.
 */
export const decodeInvite = (text: string): Result<Invite, 'malformed'> => decode(text, 'i/')

/**
 * A link that links a new device to yours: `l/<code><fingerprint>`, the same
 * shape as an invite with the identity's fingerprint. Typed codes read as for invites.
 */
export function encodeDeviceLink(code: string, fingerprint: string): string {
  return `l/${encodeInviteLink(code, fingerprint).slice(2)}`
}

export const decodeDeviceLink = (text: string): Result<Invite, 'malformed'> => decode(text, 'l/')

function decode(text: string, prefix: 'i/' | 'l/'): Result<Invite, 'malformed'> {
  const trimmed = text.trim()
  const hash = trimmed.indexOf('#')
  const fragment = hash < 0 ? trimmed : trimmed.slice(hash + 1)
  if (fragment.startsWith(prefix)) {
    const body = fragment.slice(2).toLowerCase()
    if (body.length !== INVITE_CODE_LENGTH + FINGERPRINT_LENGTH) return err('malformed')
    const code = readCode(body.slice(0, INVITE_CODE_LENGTH))
    const print = base32Decode(body.slice(INVITE_CODE_LENGTH))
    if (code === undefined || !print.ok || print.value.length !== 8) return err('malformed')
    return ok({ code, fingerprint: hexEncode(print.value) })
  }
  if (hash >= 0) return err('malformed')
  const code = readCode(trimmed)
  return code === undefined ? err('malformed') : ok({ code })
}
