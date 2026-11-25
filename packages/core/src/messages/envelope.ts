// The wire format: every message is a signed envelope, `v: 1`, at most 64 KB, naming the room
// it was sent in so it can't be replayed elsewhere (docs/protocol.md, "Messages").

import { isLogEntry, type LogEntry, type LogSummary } from '../chat/chat-log.ts'
import { type DeviceLog, isDeviceLog } from '../devices/device-log.ts'
import { base32Decode, base32Encode, utf8Decode } from '../encoding/bytes.ts'
import { canonicalBytes, type Json } from '../encoding/canonical.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import { isPeerId, type PeerId } from '../identity/identity.ts'
import { isPairSecret } from '../pairing/pair-rooms.ts'
import { err, ok, type Result } from '../result/result.ts'

export const MAX_MESSAGE_BYTES = 64 * 1024
export const MAX_HANDLE_LENGTH = 32
export const MAX_PERSONAL_MESSAGE_LENGTH = 120

export type Status = 'online' | 'away' | 'busy'

export type Body =
  /**
   * `avatar` is the version your bird is drawn with; Pigeons that leave it out mean 1. `devices`:
   * this Pigeon knows device logs (decision 0024); those before it don't say so. `instance`: a
   * random id for this run of Pigeon, so a device that hears its own key with another one knows
   * it's open somewhere else too (decision 0028).
   */
  | {
      readonly type: 'hello'
      readonly handle: string
      readonly avatar?: number
      readonly devices?: boolean
      readonly instance?: string
    }
  /** Your device log: which devices speak for you. Sent before hello by an identity with one. */
  | { readonly type: 'device-log'; readonly log: DeviceLog }
  | { readonly type: 'presence'; readonly status: Status; readonly message: string }
  | { readonly type: 'typing'; readonly active: boolean }
  | { readonly type: 'buzz' }
  /** Sent as a tab closes, so the friend shows you offline now rather than at the timeout. */
  | { readonly type: 'bye' }
  /** You've removed this friend: their Pigeon stops talking to you and says so. */
  | { readonly type: 'unfriend' }
  | { readonly type: 'log-sync'; readonly have: LogSummary }
  | { readonly type: 'log-entries'; readonly entries: readonly LogEntry[] }
  /**
   * The invitee answers an invite; `code` proves they were given it (decision 0018). From a
   * device that isn't its identity's first, `identity` and its device log say who it speaks for.
   */
  | ({ readonly type: 'pair-request'; readonly code: string; readonly handle: string } & Speaker)
  /** The inviter says who it is, so the invitee can check the fingerprint before agreeing. */
  | ({ readonly type: 'pair-offer'; readonly code: string; readonly handle: string } & Speaker)
  /** The invitee agrees, having seen the inviter's name and fingerprint. */
  | { readonly type: 'pair-confirm'; readonly code: string }
  /**
   * The inviter has added the invitee; both move to their pair room, named from `secret`
   * (decision 0026). A Pigeon from before 0026 sends no secret.
   */
  | { readonly type: 'pair-accept'; readonly code: string; readonly secret?: string }
  /** Moving friends from before 0026: the lower id gives the secret, in the old room. */
  | { readonly type: 'pair-secret'; readonly secret: string }
  /** The other side has the secret too: both leave the old room. */
  | { readonly type: 'pair-secret-ok' }
  /** A new device asks to join the identity whose device showed `code` (decision 0024). */
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
const isHandle = (value: unknown) =>
  isString(MAX_HANDLE_LENGTH)(value) && (value as string).trim() !== ''
const isCode = isString(64)

function isSummary(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.entries(value).every(
    ([id, seq]) => isPeerId(id) && typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 0,
  )
}

/** A run's id, as `encodeInstance` makes it (decision 0028). */
const isInstance = (value: unknown) => typeof value === 'string' && /^[a-z2-7]{8,32}$/.test(value)

const isSpeaker = (b: Fields) =>
  (b['identity'] === undefined && b['devices'] === undefined) ||
  (typeof b['identity'] === 'string' && isPeerId(b['identity']) && isDeviceLog(b['devices']))

/** One shape check per body type: content lives in a table, not a switch. */
const BODY_CHECKS: Readonly<Record<BodyType, (body: Fields) => boolean>> = {
  hello: (b) =>
    isHandle(b['handle']) &&
    (b['avatar'] === undefined ||
      (Number.isSafeInteger(b['avatar']) &&
        (b['avatar'] as number) >= 1 &&
        (b['avatar'] as number) <= 255)) &&
    (b['devices'] === undefined || b['devices'] === true) &&
    (b['instance'] === undefined || isInstance(b['instance'])),
  'device-log': (b) => isDeviceLog(b['log']),
  presence: (b) =>
    (b['status'] === 'online' || b['status'] === 'away' || b['status'] === 'busy') &&
    isString(MAX_PERSONAL_MESSAGE_LENGTH)(b['message']),
  typing: (b) => typeof b['active'] === 'boolean',
  buzz: () => true,
  bye: () => true,
  unfriend: () => true,
  'log-sync': (b) => isSummary(b['have']),
  'log-entries': (b) => Array.isArray(b['entries']) && b['entries'].every(isLogEntry),
  'pair-request': (b) => isCode(b['code']) && isHandle(b['handle']) && isSpeaker(b),
  'pair-offer': (b) => isCode(b['code']) && isHandle(b['handle']) && isSpeaker(b),
  'pair-confirm': (b) => isCode(b['code']),
  'pair-accept': (b) =>
    isCode(b['code']) && (b['secret'] === undefined || isPairSecret(b['secret'])),
  'pair-secret': (b) => isPairSecret(b['secret']),
  'pair-secret-ok': () => true,
  'link-request': (b) => isCode(b['code']),
  'link-offer': (b) => isCode(b['code']) && isHandle(b['handle']) && isSpeaker(b),
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
  const signature = base32Decode(sig)
  if (!signature.ok) return err('malformed')
  const valid = await crypto.verify(from, signature.value, canonicalBytes(signedPart(envelope)))
  return valid ? ok(envelope) : err('bad-signature')
}
