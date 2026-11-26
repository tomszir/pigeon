// Invite links that work through Lighthouses. A link carries a random secret and the inviter's
// long fingerprint. The secret names where the invite's card waits and seals it, so only people
// holding the link can find and read it; the fingerprint lets them check the card is the
// inviter's, since anyone holding the link could put a card of their own. Asking to be friends,
// and the answer, are ordinary mail (`mail:invite`, `mail:invite-answer`) under tags from the
// secret and from a reply secret only the asker and the inviter know.
import { type DeviceLog, deviceState, isDeviceLog, speakerIdentity } from '../devices/device-log.ts'
import {
  base32Decode,
  base32DecodeExact,
  base32Encode,
  base64Decode,
  base64Encode,
  hexEncode,
  utf8Decode,
  utf8Encode,
} from '../encoding/bytes.ts'
import { canonicalBytes, type Json } from '../encoding/canonical.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import { isPeerId, type PeerId } from '../identity/identity.ts'
import {
  formatLighthouseAddress,
  isLighthouseAddress,
  type LighthouseAddress,
  parseLighthouseAddress,
} from '../lighthouse/address.ts'
import { MAX_BLOB_BYTES, MAX_MAIL_MS } from '../lighthouse/protocol.ts'
import { isSealingKey, type SealingKey, verifySealingKey } from '../mail/mail.ts'
import type { SealCrypto } from '../mail/seal-crypto.ts'
import { cleanHandle, MAX_HANDLE_LENGTH, MAX_LIGHTHOUSES } from '../messages/envelope.ts'
import { err, ok, type Result } from '../result/result.ts'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** An invite's secret: 16 bytes, 26 base32 characters. */
export const INVITE_SECRET_BYTES = 16
const SECRET_LENGTH = 26
/** A link's fingerprint: the first 16 bytes of the identity's SHA-256, 26 base32 characters. */
export const LINK_FINGERPRINT_BYTES = 16

/** How long an invite link can last, chosen when it's made. */
export const INVITE_LINK_LIFETIMES = [HOUR, DAY, 7 * DAY, 30 * DAY] as const
export const DEFAULT_INVITE_LINK_LIFETIME = 7 * DAY
/** How many people an invite link can bring in, chosen when it's made. */
export const INVITE_LINK_USES = [1, 5, 10, 25] as const
export const DEFAULT_INVITE_LINK_USES = 1
/** Nothing lasts longer than a Lighthouse keeps mail. */
export const MAX_INVITE_LINK_LIFETIME = MAX_MAIL_MS

/** The largest request an inviter fetches; bigger blobs under the tag are skipped unread. */
export const MAX_INVITE_REQUEST_BYTES = 16 * 1024
/** The most requests an inviter fetches for one invite in a day. */
export const MAX_INVITE_REQUESTS_PER_DAY = 200

const CARD_CONTEXT = 'pigeon/invite-card/v1'
const KEY_INFO = 'pigeon/invite/key'

/** What a link names: the invite's secret, the inviter, and a Lighthouse if not the official ones. */
export interface InviteLink {
  /** base32, 26 characters. */
  readonly secret: string
  /** The first 16 bytes of SHA-256 of the inviter's identity, hex. */
  readonly fingerprint: string
  readonly lighthouse?: LighthouseAddress | undefined
}

/** The long fingerprint a link carries, in hex. */
export async function linkFingerprint(crypto: Crypto, id: PeerId): Promise<string> {
  const hash = await crypto.sha256(utf8Encode(id))
  return hexEncode(hash.subarray(0, LINK_FINGERPRINT_BYTES))
}

const hexBytes = (hex: string): Uint8Array =>
  new Uint8Array((hex.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16)))

/** The part after `#`: `a/<secret><fingerprint>`, then `?l=<address>` if it names a Lighthouse. */
export function encodeInviteLinkFragment(link: InviteLink): string {
  const base = `a/${link.secret}${base32Encode(hexBytes(link.fingerprint))}`
  if (link.lighthouse === undefined) return base
  return `${base}?l=${encodeURIComponent(formatLighthouseAddress(link.lighthouse))}`
}

/** Reads a whole link or the part after `#`. */
export function decodeInviteLink(text: string): Result<InviteLink, 'malformed'> {
  const trimmed = text.trim()
  // The last '#': a link pasted with a message before it ("Toms invites you…") opens too, even
  // when the message has a '#' of its own.
  const hash = trimmed.lastIndexOf('#')
  const fragment = hash < 0 ? trimmed : trimmed.slice(hash + 1)
  if (!fragment.startsWith('a/')) return err('malformed')
  const rest = fragment.slice(2)
  const mark = rest.indexOf('?')
  const body = (mark < 0 ? rest : rest.slice(0, mark)).toLowerCase()
  if (body.length !== 2 * SECRET_LENGTH) return err('malformed')
  const secret = body.slice(0, SECRET_LENGTH)
  const secretBytes = base32Decode(secret)
  const print = base32Decode(body.slice(SECRET_LENGTH))
  if (!secretBytes.ok || secretBytes.value.length !== INVITE_SECRET_BYTES) return err('malformed')
  if (!print.ok || print.value.length !== LINK_FINGERPRINT_BYTES) return err('malformed')
  let lighthouse: LighthouseAddress | undefined
  if (mark >= 0) {
    const query = rest.slice(mark + 1)
    if (!query.startsWith('l=')) return err('malformed')
    let address: string
    try {
      address = decodeURIComponent(query.slice(2))
    } catch {
      return err('malformed')
    }
    const parsed = parseLighthouseAddress(address)
    // A pass in a link would be a pass for everyone holding it.
    if (!parsed.ok || parsed.value.pass !== undefined) return err('malformed')
    lighthouse = parsed.value
  }
  return ok({ secret, fingerprint: hexEncode(print.value), lighthouse })
}

const secretOf = (secret: string): Uint8Array => {
  const bytes = base32Decode(secret)
  if (!bytes.ok) throw new Error('not an invite secret')
  return bytes.value
}

const tagFrom = async (crypto: Crypto, secret: Uint8Array, text: string) =>
  base32Encode(await crypto.hmacSha256(secret, utf8Encode(text)))

/** Where an invite's card waits, for as long as the invite lasts. */
export const inviteCardTag = (crypto: Crypto, secret: string): Promise<string> =>
  tagFrom(crypto, secretOf(secret), 'pigeon/invite/v1/card')

/** A link's claim key: 32 random bytes, base32, kept by the inviter's own devices. */
export const isInviteClaimKey = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^[a-z2-7]{52}$/.test(value)) return false
  const bytes = base32Decode(value)
  return bytes.ok && bytes.value.length === 32
}

/**
 * What a card is claimed with at the Lighthouse whose key is `lighthouse`: a value of its own
 * at each one, so a Lighthouse, which sees it, can't claim the card's tag at any other.
 */
export const inviteCardClaim = (
  crypto: Crypto,
  claimKey: string,
  lighthouse: PeerId,
): Promise<string> => tagFrom(crypto, secretOf(claimKey), `pigeon/invite/v1/claim/${lighthouse}`)

/** Where requests to be friends through an invite wait, on `date`. */
export const inviteAskTag = (crypto: Crypto, secret: string, date: string): Promise<string> =>
  tagFrom(crypto, secretOf(secret), `pigeon/invite/v1/ask/${date}`)

/** Where the answer to one request waits, on `date`, from the reply secret only its asker knows. */
export const inviteAnswerTag = (crypto: Crypto, reply: string, date: string): Promise<string> =>
  tagFrom(crypto, secretOf(reply), `pigeon/invite/v1/answer/${date}`)

/** What an invite's card says: who made it, how to reach them, and whether it's still open. */
export interface InviteCard {
  readonly identity: PeerId
  /** The inviter's device log; empty for a first device that has linked none. */
  readonly deviceLog: DeviceLog
  /** Sealing keys of the inviter's devices, each signed by its own device. */
  readonly keys: readonly SealingKey[]
  readonly name: string
  /** Where requests go: the inviter's Lighthouses without passes. */
  readonly lighthouses: readonly LighthouseAddress[]
  readonly expires: number
  /** False once the invite is used up, cancelled, or closed by your other devices. */
  readonly open: boolean
  /** The device that signed it, active on `deviceLog`. */
  readonly from: PeerId
  /** The link's card tag, so a card can't be moved to another of your links. */
  readonly tag: string
}

const cardPart = (card: InviteCard): Json =>
  ({
    v: CARD_CONTEXT,
    identity: card.identity,
    deviceLog: card.deviceLog,
    keys: card.keys,
    name: card.name,
    lighthouses: card.lighthouses,
    expires: card.expires,
    open: card.open,
    from: card.from,
    tag: card.tag,
  }) as unknown as Json

const cardKey = (seal: SealCrypto, secret: string) => seal.hkdf(secretOf(secret), KEY_INFO, 32)

/** Signs `card` with `signer` (its `from`) and seals it under the invite's secret: a blob to put. */
export async function sealInviteCard(
  crypto: Crypto,
  seal: SealCrypto,
  signer: Signer,
  secret: string,
  card: Omit<InviteCard, 'from' | 'tag'>,
): Promise<Result<string, 'too-big'>> {
  const signed: InviteCard = {
    ...card,
    from: signer.id,
    tag: await inviteCardTag(crypto, secret),
  }
  const sig = base32Encode(await signer.sign(canonicalBytes(cardPart(signed))))
  const inner = canonicalBytes({ ...(cardPart(signed) as Record<string, Json>), sig })
  const sealed = await seal.seal(await cardKey(seal, secret), inner)
  if (sealed.length > MAX_BLOB_BYTES) return err('too-big')
  return ok(base64Encode(sealed))
}

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

function readCard(value: unknown): (InviteCard & { readonly sig: string }) | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const f = value as Record<string, unknown>
  const { identity, deviceLog, keys, name, lighthouses, expires, open, from, tag, sig } = f
  if (
    f['v'] !== CARD_CONTEXT ||
    typeof identity !== 'string' ||
    !isPeerId(identity) ||
    !isDeviceLog(deviceLog) ||
    deviceLog.identity !== identity ||
    !Array.isArray(keys) ||
    keys.length > 32 ||
    !keys.every(isSealingKey) ||
    typeof name !== 'string' ||
    name.trim() === '' ||
    name.length > MAX_HANDLE_LENGTH ||
    !Array.isArray(lighthouses) ||
    lighthouses.length > MAX_LIGHTHOUSES ||
    !lighthouses.every((address) => isLighthouseAddress(address) && address.pass === undefined) ||
    !isTime(expires) ||
    typeof open !== 'boolean' ||
    typeof from !== 'string' ||
    !isPeerId(from) ||
    typeof tag !== 'string' ||
    typeof sig !== 'string'
  )
    return undefined
  return { identity, deviceLog, keys, name, lighthouses, expires, open, from, tag, sig }
}

export type CardError = 'malformed' | 'not-theirs' | 'bad-signature'

/**
 * Opens a card fetched under a link's card tag and checks it holds: the identity's long
 * fingerprint is the link's, its signer is active on the log it carries (checked against
 * `known`, the log you keep for that identity, if any), the signature is the signer's, and only
 * sealing keys signed by their own devices, active on the log, are kept.
 */
export async function openInviteCard(
  crypto: Crypto,
  seal: SealCrypto,
  link: InviteLink,
  blob: string,
  known?: DeviceLog,
): Promise<Result<InviteCard, CardError>> {
  const bytes = base64Decode(blob)
  if (!bytes.ok) return err('malformed')
  const inner = await seal.open(await cardKey(seal, link.secret), bytes.value)
  if (inner === undefined) return err('malformed')
  const text = utf8Decode(inner)
  if (!text.ok) return err('malformed')
  let parsed: unknown
  try {
    parsed = JSON.parse(text.value)
  } catch {
    return err('malformed')
  }
  const card = readCard(parsed)
  if (card === undefined) return err('malformed')
  if ((await linkFingerprint(crypto, card.identity)) !== link.fingerprint) return err('not-theirs')
  // Signed for this link, not moved here from another of theirs.
  if (card.tag !== (await inviteCardTag(crypto, link.secret))) return err('not-theirs')
  const { sig, ...fields } = card
  const signature = base32DecodeExact(sig)
  if (!signature.ok) return err('malformed')
  if (!(await crypto.verify(fields.from, signature.value, canonicalBytes(cardPart(fields)))))
    return err('bad-signature')
  // The signer must be on the log, merged into the one you keep for them, if any.
  const speaker = { identity: fields.identity, devices: fields.deviceLog }
  if ((await speakerIdentity(crypto, fields.from, speaker, known)) !== fields.identity)
    return err('not-theirs')
  const active = deviceState(fields.deviceLog).active
  const keys: SealingKey[] = []
  for (const key of fields.keys)
    if (active.has(key.device) && (await verifySealingKey(crypto, key))) keys.push(key)
  // The name is cleaned only now, since the signature covers it as it was sent.
  const name = cleanHandle(fields.name)
  if (name === '') return err('malformed')
  return ok({ ...fields, name, keys })
}

/** How far a device log has come: its epoch, then how many entries. */
export function logProgress(log: DeviceLog): readonly [number, number] {
  const entries =
    log.entries.length +
    (log.epochs ?? []).reduce((n, epoch) => n + epoch.entries.length + 1, 0) +
    (log.recovery === undefined ? 0 : 1)
  return [deviceState(log).epoch, entries]
}

/** Of the cards that hold, the one with the newest log; the first of those, if several tie. */
export function newestCard(cards: readonly InviteCard[]): InviteCard | undefined {
  let best: InviteCard | undefined
  for (const card of cards) {
    if (best === undefined) {
      best = card
      continue
    }
    const [e1, n1] = logProgress(card.deviceLog)
    const [e0, n0] = logProgress(best.deviceLog)
    if (e1 > e0 || (e1 === e0 && n1 > n0)) best = card
    // Two cards on the same log: a closed one wins, as closing is the last thing a card says.
    else if (e1 === e0 && n1 === n0 && !card.open && best.open) best = card
  }
  return best
}

/** A request's body: who's asking, how to reach their devices, and where the answer goes. */
export interface InviteRequest {
  readonly name: string
  readonly deviceLog: DeviceLog
  readonly keys: readonly SealingKey[]
  readonly lighthouses: readonly LighthouseAddress[]
  /** base32, 26 characters: the answer's tags come from it. */
  readonly reply: string
  /** The link's card tag: a request put under another link's tags is refused there. */
  readonly link: string
}

/** An answer's body: added, with the pair secret and the inviter's log, or not. */
export type InviteAnswer =
  | {
      readonly answer: 'added'
      readonly secret: string
      readonly name: string
      readonly deviceLog: DeviceLog
    }
  | { readonly answer: 'declined' }
  | {
      readonly answer: 'closed'
      /**
       * The inviter's device log as the device answering has it, so an asker whose request went
       * through a card a removed device put hears of the removal. Missing from older Pigeons.
       */
      readonly deviceLog?: DeviceLog | undefined
    }
  /** Too many requests are waiting on the link: ask again once some are answered. */
  | { readonly answer: 'busy' }

export const inviteRequestBody = (request: InviteRequest): Json => request as unknown as Json
export const inviteAnswerBody = (answer: InviteAnswer): Json => answer as unknown as Json

/** Reads a request's body for `sender`; nothing is checked cryptographically here. */
export function readInviteRequest(sender: PeerId, body: unknown): InviteRequest | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { name, deviceLog, keys, lighthouses, reply, link } = body as Record<string, unknown>
  const replyBytes = typeof reply === 'string' ? base32Decode(reply) : undefined
  if (
    typeof name !== 'string' ||
    name.trim() === '' ||
    name.length > MAX_HANDLE_LENGTH ||
    !isDeviceLog(deviceLog) ||
    deviceLog.identity !== sender ||
    !Array.isArray(keys) ||
    keys.length > 32 ||
    !keys.every(isSealingKey) ||
    !Array.isArray(lighthouses) ||
    lighthouses.length > MAX_LIGHTHOUSES ||
    !lighthouses.every(isLighthouseAddress) ||
    typeof reply !== 'string' ||
    replyBytes === undefined ||
    !replyBytes.ok ||
    replyBytes.value.length !== INVITE_SECRET_BYTES ||
    typeof link !== 'string' ||
    cleanHandle(name) === ''
  )
    return undefined
  return { name: cleanHandle(name), deviceLog, keys, lighthouses, reply, link }
}

/** Reads an answer's body for `sender`; nothing is checked cryptographically here. */
export function readInviteAnswer(sender: PeerId, body: unknown): InviteAnswer | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const fields = body as Record<string, unknown>
  if (fields['answer'] === 'declined') return { answer: 'declined' }
  if (fields['answer'] === 'closed') {
    // A log that isn't the sender's is left out, never the answer.
    const deviceLog = fields['deviceLog']
    return isDeviceLog(deviceLog) && deviceLog.identity === sender
      ? { answer: 'closed', deviceLog }
      : { answer: 'closed' }
  }
  if (fields['answer'] === 'busy') return { answer: 'busy' }
  const { secret, name, deviceLog } = fields
  if (
    fields['answer'] !== 'added' ||
    typeof secret !== 'string' ||
    secret.length > 64 ||
    typeof name !== 'string' ||
    name.trim() === '' ||
    name.length > MAX_HANDLE_LENGTH ||
    !isDeviceLog(deviceLog) ||
    deviceLog.identity !== sender ||
    cleanHandle(name) === ''
  )
    return undefined
  return { answer: 'added', secret, name: cleanHandle(name), deviceLog }
}

/** Whether `secret` is an invite's or a reply's: 16 bytes in base32. */
export function isInviteSecret(secret: unknown): secret is string {
  if (typeof secret !== 'string' || secret.length !== SECRET_LENGTH) return false
  const bytes = base32Decode(secret)
  return bytes.ok && bytes.value.length === INVITE_SECRET_BYTES
}

/** When an invite made at `now` for `lifetime` expires: never later than a Lighthouse keeps it. */
export const inviteExpiry = (now: number, lifetime: number): number =>
  now + Math.min(lifetime, MAX_INVITE_LINK_LIFETIME)
