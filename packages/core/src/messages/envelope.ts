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
import { err, ok, type Result } from '../result/result.ts'
import { isFingerprint } from '../transport/transport.ts'

export const MAX_MESSAGE_BYTES: number = 64 * 1024
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
/** A SPAKE2 message or a MAC, base64: far longer than either is. */
const MAX_PAKE_LENGTH = 256
/** Sealed mail too big for one envelope goes in pieces of at most this many characters. */
export const MAX_SEALED_PART_LENGTH = 40_000
/** The most pieces a sealed answer comes in: enough for the largest blob a Lighthouse takes. */
export const MAX_SEALED_PARTS = 4

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
  /**
   * Between your own devices only: per device, the highest number of your shared log held and a
   * digest of every entry held up to it, gaps included, so the other sends what this one lacks.
   */
  | { readonly type: 'sync-summary'; readonly summary: SyncSummaryBody }
  /** Between your own devices only: shared-log entries, each checked on its own as it's taken. */
  | { readonly type: 'sync-entries'; readonly entries: readonly Json[] }
  | { readonly type: 'log-entries'; readonly entries: readonly LogEntry[] }
  /**
   * Opening a live code (pairing/handshake.ts): which secret this side holds, `code` or `link`,
   * and its SPAKE2 message. The room says whether it's an invite or a device link.
   */
  | { readonly type: 'pake-start'; readonly via: 'code' | 'link'; readonly pake: string }
  /** The code's maker answers with its own SPAKE2 message. */
  | { readonly type: 'pake-reply'; readonly pake: string }
  /** The opener's key confirmation, which the maker checks before saying who it is. */
  | { readonly type: 'pake-prove'; readonly mac: string }
  /** The confirmation was wrong: a wrong code, or someone in the middle. */
  | { readonly type: 'pake-wrong' }
  /**
   * The inviter's key confirmation, and who it is, so the invitee can check the fingerprint
   * before agreeing. From a device that isn't its identity's first, `identity` and its device
   * log say who it speaks for.
   */
  | ({ readonly type: 'pair-offer'; readonly mac: string; readonly handle: string } & Speaker)
  /**
   * The invitee agrees, and asks to be added: who it is, and the sealing key of the device
   * that ran the handshake, which the pair secret is sealed to.
   */
  | ({
      readonly type: 'pair-request'
      readonly handle: string
      readonly sealing: SealingKey
    } & Speaker)
  /** The inviter added the invitee: the pair secret, as a `mail:pair` letter sealed to it. */
  | { readonly type: 'pair-accept'; readonly sealed: string }
  /** The inviter said no. */
  | { readonly type: 'pair-decline' }
  /** The existing device's key confirmation, and whose it is. */
  | ({ readonly type: 'link-offer'; readonly mac: string; readonly handle: string } & Speaker)
  /** The new device's sealing key, which what it's handed is sealed to. */
  | { readonly type: 'link-request'; readonly sealing: SealingKey }
  /**
   * Confirmed on the existing device: the new one is on the log, and gets what it needs, as a
   * `mail:link` letter sealed to it, in `parts` pieces sent in order.
   */
  | {
      readonly type: 'link-accept'
      readonly part: number
      readonly parts: number
      readonly sealed: string
    }

export type BodyType = Body['type']

/** A shared-log summary as it travels: per device, a number and a digest. */
export type SyncSummaryBody = Readonly<
  Record<PeerId, { readonly n: number; readonly digest: string }>
>

/** Entries in one `sync-entries` message: each is at most 1 KB, so a batch fits an envelope. */
export const MAX_SYNC_BATCH = 48

const isPlainObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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
  'sync-summary': (b) => isPlainObject(b['summary']),
  // Each entry is read on its own where it's taken, so one that doesn't hold never stops the rest.
  'sync-entries': (b) =>
    Array.isArray(b['entries']) &&
    b['entries'].length <= MAX_SYNC_BATCH &&
    b['entries'].every(isPlainObject),
  'pake-start': (b) =>
    (b['via'] === 'code' || b['via'] === 'link') && isString(MAX_PAKE_LENGTH)(b['pake']),
  'pake-reply': (b) => isString(MAX_PAKE_LENGTH)(b['pake']),
  'pake-prove': (b) => isString(MAX_PAKE_LENGTH)(b['mac']),
  'pake-wrong': () => true,
  'pair-offer': (b) =>
    isString(MAX_PAKE_LENGTH)(b['mac']) && isHandleText(b['handle']) && isSpeaker(b),
  'pair-request': (b) => isHandleText(b['handle']) && isSealingKey(b['sealing']) && isSpeaker(b),
  'pair-accept': (b) => isString(MAX_SEALED_PART_LENGTH)(b['sealed']),
  'pair-decline': () => true,
  'link-offer': (b) =>
    isString(MAX_PAKE_LENGTH)(b['mac']) && isHandleText(b['handle']) && isSpeaker(b),
  'link-request': (b) => isSealingKey(b['sealing']),
  'link-accept': (b) =>
    Number.isSafeInteger(b['parts']) &&
    (b['parts'] as number) >= 1 &&
    (b['parts'] as number) <= MAX_SEALED_PARTS &&
    Number.isSafeInteger(b['part']) &&
    (b['part'] as number) >= 0 &&
    (b['part'] as number) < (b['parts'] as number) &&
    isString(MAX_SEALED_PART_LENGTH)(b['sealed']),
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
