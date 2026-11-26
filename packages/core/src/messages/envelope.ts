// The wire format: every message is a signed envelope, `v: 1`, at most 64 KB, naming the room
// it was sent in so it can't be replayed elsewhere (docs/protocol.md, "Messages").

import { isLogEntry, type LogEntry, type LogSummary } from '../chat/chat-log.ts'
import { type DeviceLog, isDeviceLog } from '../devices/device-log.ts'
import { base32DecodeExact, base32Encode, utf8Decode } from '../encoding/bytes.ts'
import { canonicalBytes, type Json } from '../encoding/canonical.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import { isPeerId, type PeerId } from '../identity/identity.ts'
import { isLighthouseAddress, type LighthouseAddress } from '../lighthouse/address.ts'
import { isSealingKey, type SealingKey } from '../mail/mail.ts'
import { isPairSecret } from '../pairing/pair-rooms.ts'
import { err, ok, type Result } from '../result/result.ts'
import { isFingerprint } from '../transport/transport.ts'

export const MAX_MESSAGE_BYTES = 64 * 1024
export const MAX_HANDLE_LENGTH = 32
export const MAX_PERSONAL_MESSAGE_LENGTH = 120

/**
 * What a name may not hold: control characters (line breaks among them), the line and paragraph
 * separators, and the marks that reorder text. Any of these could make a name break the line it's
 * shown on, or read as a different name.
 */
const NOT_IN_HANDLE = /[\p{Cc}\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu

/** A name you may choose: 1 to 32 characters, not only spaces, with none `NOT_IN_HANDLE`. */
export function isHandle(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_HANDLE_LENGTH &&
    value.trim() !== '' &&
    !hasUnsafeHandleCharacters(value)
  )
}

/** Whether `text` holds a character a name may not. */
export function hasUnsafeHandleCharacters(text: string): boolean {
  NOT_IN_HANDLE.lastIndex = 0
  return NOT_IN_HANDLE.test(text)
}

/**
 * A name someone else sent, or one saved earlier, as Pigeon shows it: with the characters a name
 * may not hold taken out, and trimmed. Taken out rather than refused, so a friend whose Pigeon
 * still lets such a name through stays reachable. Empty when nothing is left.
 */
export const cleanHandle = (text: string): string => text.replace(NOT_IN_HANDLE, '').trim()
/** Lighthouses a Pigeon may name in its hello: where friends leave its mail. */
export const MAX_LIGHTHOUSES = 4
/** Random bytes in a `nonce`: 26 base32 characters. */
export const NONCE_BYTES = 16

/**
 * What a hello is bound to: the `nonce` the connection it answers sent, and the channel's
 * certificate fingerprints as the sender sees them (its own first).
 */
export interface HelloBinding {
  readonly nonce: string
  readonly local: string
  readonly remote: string
}

export type Status = 'online' | 'away' | 'busy'

export type Body =
  /**
   * `avatar` is the version your bird is drawn with; Pigeons that leave it out mean 1. `devices`:
   * this Pigeon knows device logs; those before it don't say so. `instance`: a
   * random id for this run of Pigeon, so a device that hears its own key with another one knows
   * it's open somewhere else too. `sealing`: this device's sealing key, signed by it, which
   * mail for it is sealed to. `lighthouses`: where to leave mail for this Pigeon. Pigeons that
   * don't know either leave them out, and ignore them when others send them. `binding`: the
   * connection this hello answers (see `nonce`); a hello without one, from a Pigeon before
   * binding, proves nothing in pair and self rooms.
   */
  | {
      readonly type: 'hello'
      readonly handle: string
      readonly avatar?: number
      readonly devices?: boolean
      readonly instance?: string
      readonly sealing?: SealingKey
      readonly lighthouses?: readonly LighthouseAddress[]
      readonly binding?: HelloBinding
    }
  /**
   * Sent first on every new connection in pair and self rooms: `NONCE_BYTES` random bytes the
   * other side's hello must sign, with the channel's fingerprints, to count on this connection.
   */
  | { readonly type: 'nonce'; readonly nonce: string }
  /** Your device log: which devices speak for you. Sent before hello by an identity with one. */
  | { readonly type: 'device-log'; readonly log: DeviceLog }
  | { readonly type: 'presence'; readonly status: Status; readonly message: string }
  /**
   * Between your own devices only: your name and personal message, and when
   * they were last changed, so the newest change wins on every device.
   */
  | {
      readonly type: 'profile'
      readonly handle: string
      readonly message: string
      readonly changedAt: number
    }
  | { readonly type: 'typing'; readonly active: boolean }
  | { readonly type: 'buzz' }
  /** Sent as a tab closes, so the friend shows you offline now rather than at the timeout. */
  | { readonly type: 'bye' }
  /** You've removed this friend: their Pigeon stops talking to you and says so. */
  | { readonly type: 'unfriend' }
  | { readonly type: 'log-sync'; readonly have: LogSummary }
  | { readonly type: 'log-entries'; readonly entries: readonly LogEntry[] }
  /**
   * The invitee answers an invite; `code` proves they were given it. From a
   * device that isn't its identity's first, `identity` and its device log say who it speaks for.
   */
  | ({ readonly type: 'pair-request'; readonly code: string; readonly handle: string } & Speaker)
  /** The inviter says who it is, so the invitee can check the fingerprint before agreeing. */
  | ({ readonly type: 'pair-offer'; readonly code: string; readonly handle: string } & Speaker)
  /** The invitee agrees, having seen the inviter's name and fingerprint. */
  | { readonly type: 'pair-confirm'; readonly code: string }
  /**
   * The inviter has added the invitee; both move to their pair room, named from `secret`.
   * A Pigeon from before pair secrets sends none.
   */
  | { readonly type: 'pair-accept'; readonly code: string; readonly secret?: string }
  /** Moving friends paired before pair secrets: the lower id gives the secret, in the old room. */
  | { readonly type: 'pair-secret'; readonly secret: string }
  /** The other side has the secret too: both leave the old room. */
  | { readonly type: 'pair-secret-ok' }
  /** A new device asks to join the identity whose device showed `code`. */
  | { readonly type: 'link-request'; readonly code: string }
  /** The existing device says whose it is, so both can show the same 6-digit check. */
  | ({ readonly type: 'link-offer'; readonly code: string; readonly handle: string } & Speaker)
  /** Confirmed on the existing device: the new one is on the log, and gets what it needs. */
  | { readonly type: 'link-accept'; readonly code: string; readonly bundle: Json }

export type BodyType = Body['type']

/** Who a device speaks for, when it isn't its identity's first device. */
export interface Speaker {
  readonly identity?: PeerId
  readonly devices?: DeviceLog
}

export interface Envelope {
  readonly v: 1
  readonly from: PeerId
  readonly room: string
  readonly at: number
  readonly body: Body
}

export type DecodeError = 'too-large' | 'malformed' | 'bad-signature'

type Fields = Readonly<Record<string, unknown>>

const isString = (max: number) => (value: unknown) =>
  typeof value === 'string' && value.length <= max
/** A name as it may arrive: cleaned by `openEnvelope` once the signature is checked. */
const isHandleText = (value: unknown) =>
  isString(MAX_HANDLE_LENGTH)(value) && (value as string).trim() !== ''
const isCode = isString(64)

function isSummary(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.entries(value).every(
    ([id, seq]) => isPeerId(id) && typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 0,
  )
}

/** `NONCE_BYTES` bytes in Pigeon's own base32 spelling, the only one accepted. */
export const isNonce = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  const bytes = base32DecodeExact(value)
  return bytes.ok && bytes.value.length === NONCE_BYTES
}

const isHelloBinding = (value: unknown) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const b = value as Fields
  return (
    Object.keys(b).length === 3 &&
    isNonce(b['nonce']) &&
    isFingerprint(b['local']) &&
    isFingerprint(b['remote'])
  )
}

/** A run's id, as `encodeInstance` makes it. */
const isInstance = (value: unknown) => typeof value === 'string' && /^[a-z2-7]{8,32}$/.test(value)

const isSpeaker = (b: Fields) =>
  (b['identity'] === undefined && b['devices'] === undefined) ||
  (typeof b['identity'] === 'string' && isPeerId(b['identity']) && isDeviceLog(b['devices']))

/** One shape check per body type: content lives in a table, not a switch. */
const BODY_CHECKS: Readonly<Record<BodyType, (body: Fields) => boolean>> = {
  hello: (b) =>
    isHandleText(b['handle']) &&
    (b['avatar'] === undefined ||
      (Number.isSafeInteger(b['avatar']) &&
        (b['avatar'] as number) >= 1 &&
        (b['avatar'] as number) <= 255)) &&
    (b['devices'] === undefined || b['devices'] === true) &&
    (b['instance'] === undefined || isInstance(b['instance'])) &&
    (b['sealing'] === undefined || isSealingKey(b['sealing'])) &&
    (b['lighthouses'] === undefined ||
      (Array.isArray(b['lighthouses']) &&
        b['lighthouses'].length <= MAX_LIGHTHOUSES &&
        b['lighthouses'].every(isLighthouseAddress))) &&
    (b['binding'] === undefined || isHelloBinding(b['binding'])),
  nonce: (b) => isNonce(b['nonce']),
  'device-log': (b) => isDeviceLog(b['log']),
  presence: (b) =>
    (b['status'] === 'online' || b['status'] === 'away' || b['status'] === 'busy') &&
    isString(MAX_PERSONAL_MESSAGE_LENGTH)(b['message']),
  profile: (b) =>
    isHandleText(b['handle']) &&
    isString(MAX_PERSONAL_MESSAGE_LENGTH)(b['message']) &&
    Number.isSafeInteger(b['changedAt']) &&
    (b['changedAt'] as number) > 0,
  typing: (b) => typeof b['active'] === 'boolean',
  buzz: () => true,
  bye: () => true,
  unfriend: () => true,
  'log-sync': (b) => isSummary(b['have']),
  'log-entries': (b) => Array.isArray(b['entries']) && b['entries'].every(isLogEntry),
  'pair-request': (b) => isCode(b['code']) && isHandleText(b['handle']) && isSpeaker(b),
  'pair-offer': (b) => isCode(b['code']) && isHandleText(b['handle']) && isSpeaker(b),
  'pair-confirm': (b) => isCode(b['code']),
  'pair-accept': (b) =>
    isCode(b['code']) && (b['secret'] === undefined || isPairSecret(b['secret'])),
  'pair-secret': (b) => isPairSecret(b['secret']),
  'pair-secret-ok': () => true,
  'link-request': (b) => isCode(b['code']),
  'link-offer': (b) => isCode(b['code']) && isHandleText(b['handle']) && isSpeaker(b),
  'link-accept': (b) =>
    isCode(b['code']) && typeof b['bundle'] === 'object' && b['bundle'] !== null,
}

function isBody(value: unknown): value is Body {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const fields = value as Fields
  const type = fields['type']
  if (typeof type !== 'string' || !Object.hasOwn(BODY_CHECKS, type)) return false
  return BODY_CHECKS[type as BodyType](fields)
}

const signedPart = (envelope: Envelope): Json => ({
  v: envelope.v,
  from: envelope.from,
  room: envelope.room,
  at: envelope.at,
  body: envelope.body as unknown as Json,
})

export async function sealEnvelope(
  signer: Signer,
  room: string,
  at: number,
  body: Body,
): Promise<Uint8Array> {
  const envelope: Envelope = { v: 1, from: signer.id, room, at, body }
  const sig = base32Encode(await signer.sign(canonicalBytes(signedPart(envelope))))
  const bytes = canonicalBytes({ ...(signedPart(envelope) as Record<string, Json>), sig })
  // A caller building an oversized message is a bug: big things are chunked before this.
  if (bytes.length > MAX_MESSAGE_BYTES) throw new Error(`envelope over 64 KB: ${body.type}`)
  return bytes
}

/** Parses and verifies an envelope that arrived in `room`. */
export async function openEnvelope(
  crypto: Crypto,
  room: string,
  bytes: Uint8Array,
): Promise<Result<Envelope, DecodeError>> {
  if (bytes.length > MAX_MESSAGE_BYTES) return err('too-large')
  const text = utf8Decode(bytes)
  if (!text.ok) return err('malformed')
  let parsed: unknown
  try {
    parsed = JSON.parse(text.value)
  } catch {
    return err('malformed')
  }
  if (typeof parsed !== 'object' || parsed === null) return err('malformed')
  const fields = parsed as Fields
  const { v, from, at, body, sig } = fields
  if (
    v !== 1 ||
    typeof from !== 'string' ||
    !isPeerId(from) ||
    fields['room'] !== room ||
    typeof at !== 'number' ||
    !Number.isSafeInteger(at) ||
    !isBody(body) ||
    typeof sig !== 'string'
  )
    return err('malformed')
  const envelope: Envelope = { v: 1, from, room, at, body }
  const signature = base32DecodeExact(sig)
  if (!signature.ok) return err('malformed')
  const valid = await crypto.verify(from, signature.value, canonicalBytes(signedPart(envelope)))
  if (!valid) return err('bad-signature')
  // A name is cleaned only after the signature is checked against what was sent. One with
  // nothing left becomes "Friend", so whoever chose it can still be reached, except in a profile
  // change, which is refused instead so that nobody's name is changed to "Friend".
  if (!('handle' in body) || typeof body.handle !== 'string') return ok(envelope)
  const handle = cleanHandle(body.handle)
  if (handle === '' && body.type === 'profile') return err('malformed')
  return ok({ ...envelope, body: { ...body, handle: handle || 'Friend' } })
}
