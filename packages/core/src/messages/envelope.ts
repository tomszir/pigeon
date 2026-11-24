// The wire format: every message is a signed envelope, `v: 1`, at most 64 KB, naming the room
// it was sent in so it can't be replayed elsewhere (docs/protocol.md, "Messages").

import { isLogEntry, type LogEntry, type LogSummary } from '../chat/chat-log.ts'
import { base32Decode, base32Encode, utf8Decode } from '../encoding/bytes.ts'
import { canonicalBytes, type Json } from '../encoding/canonical.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import { isPeerId, type PeerId } from '../identity/identity.ts'
import { err, ok, type Result } from '../result/result.ts'

export const MAX_MESSAGE_BYTES = 64 * 1024
export const MAX_HANDLE_LENGTH = 32
export const MAX_PERSONAL_MESSAGE_LENGTH = 120

export type Status = 'online' | 'away' | 'busy'

export type Body =
  | { readonly type: 'hello'; readonly handle: string }
  | { readonly type: 'presence'; readonly status: Status; readonly message: string }
  | { readonly type: 'typing'; readonly active: boolean }
  | { readonly type: 'buzz' }
  /** Sent as a tab closes, so the friend shows you offline now rather than at the timeout. */
  | { readonly type: 'bye' }
  | { readonly type: 'log-sync'; readonly have: LogSummary }
  | { readonly type: 'log-entries'; readonly entries: readonly LogEntry[] }
  /** The invitee answers an invite link; `token` proves they were given it. */
  | { readonly type: 'pair-request'; readonly token: string; readonly handle: string }
  /** The inviter confirms; both sides now know each other's id and move to the pair room. */
  | { readonly type: 'pair-accept'; readonly token: string; readonly handle: string }

export type BodyType = Body['type']

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
const isToken = isString(64)

function isSummary(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.entries(value).every(
    ([id, seq]) => isPeerId(id) && typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 0,
  )
}

/** One shape check per body type: content lives in a table, not a switch. */
const BODY_CHECKS: Readonly<Record<BodyType, (body: Fields) => boolean>> = {
  hello: (b) => isHandle(b['handle']),
  presence: (b) =>
    (b['status'] === 'online' || b['status'] === 'away' || b['status'] === 'busy') &&
    isString(MAX_PERSONAL_MESSAGE_LENGTH)(b['message']),
  typing: (b) => typeof b['active'] === 'boolean',
  buzz: () => true,
  bye: () => true,
  'log-sync': (b) => isSummary(b['have']),
  'log-entries': (b) => Array.isArray(b['entries']) && b['entries'].every(isLogEntry),
  'pair-request': (b) => isToken(b['token']) && isHandle(b['handle']),
  'pair-accept': (b) => isToken(b['token']) && isHandle(b['handle']),
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
