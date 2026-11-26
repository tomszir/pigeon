// Live codes for invites and device links: a code to type, and a short link to open or scan.
// A typed code is a nameplate and a password. The nameplate is public: it names the room the
// two sides meet in, `invite/v2:<nameplate>` or `link/v2:<nameplate>`. The password never
// leaves the device except through SPAKE2 (handshake.ts), so the relays, which see the room's
// name, hold nothing a guess could be tested against. A link carries a 128-bit secret instead,
// which takes the password's place and names a room of its own, so nobody without the link can
// find that room, and the fingerprint of whoever made it.
import { base32Decode, base32Encode, hexDecode, hexEncode, utf8Encode } from '../encoding/bytes.ts'
import type { Crypto } from '../identity/crypto.ts'
import { err, ok, type Result } from '../result/result.ts'
import type { RoomName } from '../transport/transport.ts'

/** The nameplate: 4 base32 characters, 20 bits. Public; it only has to keep live codes apart. */
export const NAMEPLATE_LENGTH = 4
/** The password: 6 base32 characters, 30 bits, each guess one live try the inviter sees. */
export const PASSWORD_LENGTH = 6
export const CODE_LENGTH = NAMEPLATE_LENGTH + PASSWORD_LENGTH
/** A link's secret: 16 bytes, 26 base32 characters. */
export const LINK_SECRET_BYTES = 16
const LINK_SECRET_LENGTH = 26
/** Random bytes a new code takes: enough for the nameplate, the password and the link secret. */
export const CODE_RANDOM_BYTES = 7 + LINK_SECRET_BYTES
export const INVITE_LIFETIME_MS = 30 * 60 * 1000
/** Fingerprints are 8 bytes (16 hex); in a link they're 13 base32 characters. */
const FINGERPRINT_LENGTH = 13
/**
 * Pigeons before codes went through SPAKE2 made 8-character codes, and links of those and a
 * fingerprint. They can't be opened any more, but they're told apart, so the person is told to
 * have their friend reload Pigeon rather than that they typed it wrong.
 */
const OLD_CODE_LENGTH = 8

/**
 * Why something isn't a code or link: `old` when it's one an older Pigeon made, which a current
 * one can't open, and `malformed` otherwise.
 */
export type CodeError = 'malformed' | 'old'

/** A live code as the side that made it keeps it. */
export interface LiveCode {
  readonly nameplate: string
  readonly password: string
  readonly secret: string
}

/**
 * What someone typed or opened: a typed code's nameplate and password, or a link's 128-bit
 * secret and the fingerprint of whoever made it.
 */
export type Invite =
  | {
      readonly via: 'code'
      readonly nameplate: string
      readonly secret: string
      readonly fingerprint?: undefined
    }
  | { readonly via: 'link'; readonly secret: string; readonly fingerprint: string }

export type CodeKind = 'invite' | 'link'

/** The room a typed code meets in: its nameplate, public by design. */
const typedRoom = (kind: CodeKind, nameplate: string): RoomName => `${kind}/v2:${nameplate}`

/**
 * The room a link meets in: 26 base32 characters of SHA-256 of its secret, so only someone with
 * the link can find it, and no nameplate's room has a name that long.
 */
async function linkedRoom(crypto: Crypto, kind: CodeKind, secret: string): Promise<RoomName> {
  const hash = await crypto.sha256(utf8Encode(`pigeon/${kind}/v2/room/${secret}`))
  return `${kind}/v2:${base32Encode(hash.subarray(0, 16))}`
}

/** Where to meet for what someone typed or opened. */
export const roomFor = (crypto: Crypto, kind: CodeKind, invite: Invite): Promise<RoomName> =>
  invite.via === 'code'
    ? Promise.resolve(typedRoom(kind, invite.nameplate))
    : linkedRoom(crypto, kind, invite.secret)

/** Both rooms the side that made `code` waits in: the typed code's and the link's. */
export async function roomsFor(
  crypto: Crypto,
  kind: CodeKind,
  code: LiveCode,
): Promise<{ readonly code: RoomName; readonly link: RoomName }> {
  return {
    code: typedRoom(kind, code.nameplate),
    link: await linkedRoom(crypto, kind, code.secret),
  }
}

/** True when `invite` is `code`, typed or as its link. */
export const isOwnCode = (code: LiveCode | undefined, invite: Invite): boolean =>
  code !== undefined &&
  (invite.via === 'code'
    ? invite.nameplate === code.nameplate && invite.secret === code.password
    : invite.secret === code.secret)

/** A new live code from `random` (CODE_RANDOM_BYTES of it). */
export function newCode(random: Uint8Array): LiveCode {
  if (random.length < CODE_RANDOM_BYTES) throw new Error('newCode: too few random bytes')
  // 7 bytes is 56 bits; the first 10 characters take 50 of them.
  const typed = base32Encode(random.subarray(0, 7)).slice(0, CODE_LENGTH)
  return {
    nameplate: typed.slice(0, NAMEPLATE_LENGTH),
    password: typed.slice(NAMEPLATE_LENGTH),
    secret: base32Encode(random.subarray(7, CODE_RANDOM_BYTES)),
  }
}

export const isLiveCode = (value: unknown): value is LiveCode => {
  if (typeof value !== 'object' || value === null) return false
  const { nameplate, password, secret } = value as Record<string, unknown>
  return (
    typeof nameplate === 'string' &&
    new RegExp(`^[a-z2-7]{${NAMEPLATE_LENGTH}}$`).test(nameplate) &&
    typeof password === 'string' &&
    new RegExp(`^[a-z2-7]{${PASSWORD_LENGTH}}$`).test(password) &&
    typeof secret === 'string' &&
    isLinkSecret(secret)
  )
}

const isLinkSecret = (text: string) =>
  text.length === LINK_SECRET_LENGTH && /^[a-z2-7]+$/.test(text) && base32Decode(text).ok

/** "K7RT-VP2-BXQ": how a code is shown and read out. */
export const formatCode = (code: LiveCode): string =>
  `${code.nameplate}-${code.password.slice(0, 3)}-${code.password.slice(3)}`.toUpperCase()

/** The part after `#` in an invite link: `i/<secret><fingerprint>`. */
export const encodeInviteLink = (code: LiveCode, fingerprint: string): string =>
  encode('i/', code, fingerprint)

/** The part after `#` in a link that links a new device to yours: `l/...`, as for invites. */
export const encodeDeviceLink = (code: LiveCode, fingerprint: string): string =>
  encode('l/', code, fingerprint)

function encode(prefix: 'i/' | 'l/', code: LiveCode, fingerprint: string): string {
  const bytes = hexDecode(fingerprint)
  if (!bytes.ok) throw new Error(`encode link: fingerprint is not hex: ${fingerprint}`)
  return `${prefix}${code.secret}${base32Encode(bytes.value)}`
}

/** Letters people misread for digits base32 doesn't have. */
const LOOKALIKES: Readonly<Record<string, string>> = { '0': 'o', '1': 'l', '8': 'b' }

function readCode(text: string): Result<Invite, CodeError> {
  const code = text
    .toLowerCase()
    .replace(/[\s-]/g, '')
    .replace(/[018]/g, (digit) => LOOKALIKES[digit] ?? digit)
  if (new RegExp(`^[a-z2-7]{${OLD_CODE_LENGTH}}$`).test(code)) return err('old')
  if (!new RegExp(`^[a-z2-7]{${CODE_LENGTH}}$`).test(code)) return err('malformed')
  return ok({
    via: 'code',
    nameplate: code.slice(0, NAMEPLATE_LENGTH),
    secret: code.slice(NAMEPLATE_LENGTH),
  })
}

/**
 * Reads whatever someone pasted or typed: a whole link, the part after `#`, or a code with or
 * without its dashes, in any case.
 */
export const decodeInvite = (text: string): Result<Invite, CodeError> => decode(text, 'i/')

export const decodeDeviceLink = (text: string): Result<Invite, CodeError> => decode(text, 'l/')

function decode(text: string, prefix: 'i/' | 'l/'): Result<Invite, CodeError> {
  const trimmed = text.trim()
  const hash = trimmed.indexOf('#')
  const fragment = hash < 0 ? trimmed : trimmed.slice(hash + 1)
  if (fragment.startsWith(prefix)) {
    const body = fragment.slice(2).toLowerCase()
    if (body.length === OLD_CODE_LENGTH + FINGERPRINT_LENGTH && /^[a-z2-7]+$/.test(body))
      return err('old')
    if (body.length !== LINK_SECRET_LENGTH + FINGERPRINT_LENGTH) return err('malformed')
    const secret = body.slice(0, LINK_SECRET_LENGTH)
    const print = base32Decode(body.slice(LINK_SECRET_LENGTH))
    if (!isLinkSecret(secret) || !print.ok || print.value.length !== 8) return err('malformed')
    return ok({ via: 'link', secret, fingerprint: hexEncode(print.value) })
  }
  if (hash >= 0) return err('malformed')
  return readCode(trimmed)
}
