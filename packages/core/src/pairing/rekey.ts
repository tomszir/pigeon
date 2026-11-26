// Replacing a pair or self secret from before codes went through SPAKE2. Such a secret may be
// known to someone who watched the pairing or linking it came from, so it's replaced with a new
// one that only ever travels sealed to the devices that hold the old one, as a `mail:rekey`
// letter. Either side may propose; when several proposals for the same old secret meet, the
// earliest wins everywhere, by (at, by, secret), so every device settles on the same one
// whatever order they arrive in (docs/protocol.md, "Replacing an old secret").

import { type DeviceLog, isDeviceLog } from '../devices/device-log.ts'
import { base32Decode, base32DecodeExact, base32Encode, utf8Encode } from '../encoding/bytes.ts'
import { canonicalBytes, type Json } from '../encoding/canonical.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import { isPeerId, type PeerId } from '../identity/identity.ts'
import { isPairSecret } from './pair-rooms.ts'

export const REKEY_VERSION = 'pigeon/rekey/v1'

/** One proposal: a new secret to take the place of the one `replaces` names. */
export interface Rekey {
  /** `replacesId` of the old secret, so a proposal counts only against that secret. */
  readonly replaces: string
  /** The new secret, 32 bytes in base32. */
  readonly secret: string
  /** When the proposal was first made, by its proposer's clock. */
  readonly at: number
  /** The device that first made it. */
  readonly by: PeerId
  /**
   * `by`'s signature over the rest, base32, so a proposal forwarded by another device still
   * says who made it, and no device can put another's name on its own.
   */
  readonly sig: string
}

const PROPOSAL_CONTEXT = `${REKEY_VERSION}/proposal`

const proposalBytes = (rekey: Omit<Rekey, 'sig'>): Uint8Array =>
  canonicalBytes({
    v: PROPOSAL_CONTEXT,
    replaces: rekey.replaces,
    secret: rekey.secret,
    at: rekey.at,
    by: rekey.by,
  })

/** A proposal made and signed by this device. */
export async function signRekey(
  signer: Signer,
  proposal: Pick<Rekey, 'replaces' | 'secret' | 'at'>,
): Promise<Rekey> {
  const unsigned = { ...proposal, by: signer.id }
  return { ...unsigned, sig: base32Encode(await signer.sign(proposalBytes(unsigned))) }
}

/** True when the proposal carries its maker's own signature, in its one accepted spelling. */
export async function verifyRekey(crypto: Crypto, rekey: Rekey): Promise<boolean> {
  const signature = base32DecodeExact(rekey.sig)
  if (!signature.ok) return false
  return crypto.verify(rekey.by, signature.value, proposalBytes(rekey))
}

/**
 * Names a secret without giving it away: base32 HMAC-SHA256(secret, "pigeon/rekey/v1/replaces").
 * Only holders of the secret can make it, and it says nothing about the secret to anyone else.
 */
export async function replacesId(crypto: Crypto, secret: string): Promise<string> {
  const bytes = base32Decode(secret)
  if (!bytes.ok) throw new Error('not a secret')
  return base32Encode(await crypto.hmacSha256(bytes.value, utf8Encode(`${REKEY_VERSION}/replaces`)))
}

const isId = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  const bytes = base32Decode(value)
  return bytes.ok && bytes.value.length === 32 && base32Encode(bytes.value) === value
}

/** At most this many device logs ride with a proposal: the two sides'. */
export const MAX_REKEY_LOGS = 2

/** What a `mail:rekey` body says besides the proposal. */
export interface RekeyNews {
  /** On a copy for your own other devices: the friend whose secret it is. */
  readonly friend?: PeerId
  /**
   * The newest device logs the sender knows for both sides, merged before the proposal is
   * looked at, so a proposal from a device someone has since removed is seen not to count.
   */
  readonly logs?: readonly DeviceLog[]
}

/** A letter body as sent: the proposal, and what rides with it. */
export const rekeyBody = (rekey: Rekey, news: RekeyNews = {}): Json => ({
  v: REKEY_VERSION,
  replaces: rekey.replaces,
  secret: rekey.secret,
  at: rekey.at,
  by: rekey.by,
  sig: rekey.sig,
  ...(news.friend === undefined ? {} : { friend: news.friend }),
  ...(news.logs === undefined ? {} : { logs: news.logs as unknown as Json }),
})

/** Reads a `mail:rekey` body; undefined unless every part has its one accepted spelling. */
export function readRekey(body: unknown): ({ rekey: Rekey } & RekeyNews) | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const fields = body as Record<string, unknown>
  const { v, replaces, secret, at, by, sig, friend, logs } = fields
  const known = new Set(['v', 'replaces', 'secret', 'at', 'by', 'sig', 'friend', 'logs'])
  if (Object.keys(fields).some((key) => !known.has(key))) return undefined
  if (v !== REKEY_VERSION || !isId(replaces) || !isPairSecret(secret)) return undefined
  if (typeof at !== 'number' || !Number.isSafeInteger(at) || at < 0) return undefined
  if (typeof by !== 'string' || !isPeerId(by)) return undefined
  if (typeof sig !== 'string' || !base32DecodeExact(sig).ok) return undefined
  if (friend !== undefined && (typeof friend !== 'string' || !isPeerId(friend))) return undefined
  if (
    logs !== undefined &&
    (!Array.isArray(logs) || logs.length > MAX_REKEY_LOGS || !logs.every(isDeviceLog))
  )
    return undefined
  const rekey: Rekey = { replaces, secret, at, by, sig }
  return {
    rekey,
    ...(friend === undefined ? {} : { friend }),
    ...(logs === undefined ? {} : { logs: logs as DeviceLog[] }),
  }
}

/** Orders two byte strings, as a dictionary would. */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0)
  return a.length - b.length
}

const decoded = (text: string): Uint8Array => {
  const bytes = base32Decode(text)
  return bytes.ok ? bytes.value : new Uint8Array()
}

/**
 * True when `a` wins over `b`: the earlier `at`, then the lower proposing device, then the lower
 * secret, compared as decoded bytes. Every device orders proposals the same way, so whichever it
 * hears first, all of them end on the same one.
 */
export function rekeyWins(a: Rekey, b: Rekey): boolean {
  if (a.at !== b.at) return a.at < b.at
  const by = compareBytes(decoded(a.by), decoded(b.by))
  if (by !== 0) return by < 0
  return compareBytes(decoded(a.secret), decoded(b.secret)) < 0
}
