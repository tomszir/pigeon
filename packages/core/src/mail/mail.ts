// Mail sealed to devices. A letter is a signed envelope of its own, sealed once
// with a random content key; the content key and each device's drop value are wrapped for each
// recipient device with ECDH from a fresh key. Tags come from the pair or self secret, and only
// say where to look: knowing one shows that mail is waiting, never what it says. A wrap names no
// device, so a blob says nothing about whom it's for; a device tries each until one opens.
import {
  base32Decode,
  base32Encode,
  base64Decode,
  base64Encode,
  concatBytes,
  utf8Decode,
  utf8Encode,
} from '../encoding/bytes.ts'
import { canonicalBytes, type Json } from '../encoding/canonical.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import { isPeerId, type PeerId } from '../identity/identity.ts'
import { MAX_BLOB_BYTES, MAX_DROPS } from '../lighthouse/protocol.ts'
import { err, ok, type Result } from '../result/result.ts'
import type { SealCrypto, Sealer } from './seal-crypto.ts'

/** What a letter is: each kind is its own `room`, mail:<kind>, so one can't pass as another. */
export type MailKind = 'farewell' | 'self' | 'receipt' | 'invite' | 'invite-answer' | 'letter'
const KINDS: ReadonlySet<string> = new Set<MailKind>([
  'farewell',
  'self',
  'receipt',
  'invite',
  'invite-answer',
  'letter',
])

/** A device's sealing key, bound to it by its own signature. */
export interface SealingKey {
  readonly device: PeerId
  /** The raw P-256 public key, base64. */
  readonly key: string
  readonly sig: string
}

/** Where the sender's device log stood: mail counts only from a device still on it. */
export interface LogHead {
  readonly epoch: number
  readonly seq: number
}

export interface Letter {
  readonly kind: MailKind
  /** The sender's identity, whose device log `from` must be on. */
  readonly sender: PeerId
  /** The recipient's identity. */
  readonly to: PeerId
  /** The UTC date of the tag it was put under, 2026-11-25. */
  readonly date: string
  /** A random id, 8 to 64 letters: a recipient takes each (sender, id) once. */
  readonly id: string
  readonly head: LogHead
  /** The device that wrote it, and signed it. */
  readonly from: PeerId
  readonly at: number
  readonly body: Json
}

export interface SealedMail {
  /** The blob to put, base64. */
  readonly blob: string
  /**
   * One per recipient device: the drop value sealed inside for that device alone, base32. The
   * sender keeps these; `put` takes only their hashes (`dropHashes`).
   */
  readonly drops: readonly { readonly device: PeerId; readonly value: string }[]
}

export interface OpenedMail {
  readonly letter: Letter
  /** This device's drop value, base32, for `drop`. */
  readonly drop: string
}

const SEALING_KEY_CONTEXT = 'pigeon/sealing-key/v1'
const LETTER_CONTEXT = 'pigeon/letter/v1'
const WRAP_INFO = 'pigeon/mail/wrap'
const COMMIT_INFO = 'pigeon/mail/commit'

/** The UTC date a time falls on, as tags and pair rooms name days. */
export const utcDate = (at: number): string => new Date(at).toISOString().slice(0, 10)

/** Where mail for `recipient` from the holder of `secret` waits on `date`. */
export async function mailTag(
  crypto: Crypto,
  secret: Uint8Array,
  recipient: PeerId,
  date: string,
): Promise<string> {
  return base32Encode(
    await crypto.hmacSha256(secret, utf8Encode(`pigeon/mail/v1/${recipient}/${date}`)),
  )
}

/** Binds this device's sealing key to it with its own signature. */
export async function bindSealingKey(signer: Signer, sealer: Sealer): Promise<SealingKey> {
  const key = base64Encode(sealer.publicKey)
  const sig = await signer.sign(canonicalBytes({ v: SEALING_KEY_CONTEXT, device: signer.id, key }))
  return { device: signer.id, key, sig: base32Encode(sig) }
}

export function isSealingKey(value: unknown): value is SealingKey {
  if (typeof value !== 'object' || value === null) return false
  const { device, key, sig } = value as Record<string, unknown>
  if (typeof device !== 'string' || !isPeerId(device) || typeof sig !== 'string') return false
  if (typeof key !== 'string') return false
  const bytes = base64Decode(key)
  return bytes.ok && bytes.value.length === 65 && bytes.value[0] === 4
}

/** True when `binding` is its device's own signature over its key. */
export async function verifySealingKey(crypto: Crypto, binding: SealingKey): Promise<boolean> {
  if (!isSealingKey(binding)) return false
  const signature = base32Decode(binding.sig)
  if (!signature.ok) return false
  return crypto.verify(
    binding.device,
    signature.value,
    canonicalBytes({ v: SEALING_KEY_CONTEXT, device: binding.device, key: binding.key }),
  )
}

const letterPart = (letter: Letter): Json => ({
  v: LETTER_CONTEXT,
  room: `mail:${letter.kind}`,
  sender: letter.sender,
  to: letter.to,
  date: letter.date,
  id: letter.id,
  head: { epoch: letter.head.epoch, seq: letter.head.seq },
  from: letter.from,
  at: letter.at,
  body: letter.body,
})

export type SealError = 'too-big' | 'no-devices' | 'too-many-devices'

/**
 * The wrap key for one device: bound to the fresh key and to the device's key as well as the
 * secret they share, so neither can be swapped for an equivalent one, as HPKE binds them.
 */
const wrapKey = (seal: SealCrypto, shared: Uint8Array, fresh: Uint8Array, device: Uint8Array) =>
  seal.hkdf(shared, `${WRAP_INFO}/${base64Encode(fresh)}/${base64Encode(device)}`, 32)

/** An uncompressed P-256 point's shape: 65 bytes, starting with 4. */
const isPoint = (bytes: Uint8Array) => bytes.length === 65 && bytes[0] === 4

/** A Fisher-Yates shuffle on 4 random bytes a step. */
function shuffle<T>(seal: SealCrypto, items: readonly T[]): T[] {
  const out = [...items]
  const random = seal.random(4 * out.length)
  for (let i = out.length - 1; i > 0; i--) {
    const at = i * 4
    const n =
      (((random[at] ?? 0) << 24) |
        ((random[at + 1] ?? 0) << 16) |
        ((random[at + 2] ?? 0) << 8) |
        (random[at + 3] ?? 0)) >>>
      0
    const j = n % (i + 1)
    const swap = out[i] as T
    out[i] = out[j] as T
    out[j] = swap
  }
  return out
}

/**
 * Seals `letter` to each of `devices`, signed by `signer` (which becomes `letter.from`). The
 * caller passes only keys it has checked (verifySealingKey) for devices active on the
 * recipient's log. A key that isn't a usable point is skipped, never the rest: those devices
 * are in `skipped`, and the mail is sealed to the others.
 */
export async function sealMail(
  seal: SealCrypto,
  signer: Signer,
  letter: Omit<Letter, 'from'>,
  devices: readonly SealingKey[],
): Promise<Result<SealedMail & { readonly skipped: readonly PeerId[] }, SealError>> {
  if (devices.length > MAX_DROPS) return err('too-many-devices')
  const signed: Letter = { ...letter, from: signer.id }
  const sig = base32Encode(await signer.sign(canonicalBytes(letterPart(signed))))
  const inner = canonicalBytes({ ...(letterPart(signed) as Record<string, Json>), sig })
  const contentKey = seal.random(32)
  const content = await seal.seal(contentKey, inner)
  // Every device checks this, so a sender can't hand different devices different letters.
  const commit = await seal.hkdf(contentKey, COMMIT_INFO, 32)
  const drops: { device: PeerId; value: string }[] = []
  const skipped: PeerId[] = []
  const wraps: Json[] = []
  for (const device of devices) {
    const peer = base64Decode(device.key)
    if (!peer.ok || !isPoint(peer.value)) {
      skipped.push(device.device)
      continue
    }
    let fresh: { publicKey: Uint8Array; shared: Uint8Array }
    try {
      fresh = await seal.ephemeralShare(peer.value)
    } catch {
      skipped.push(device.device)
      continue
    }
    const drop = seal.random(32)
    const key = await wrapKey(seal, fresh.shared, fresh.publicKey, peer.value)
    const wrapped = await seal.seal(key, concatBytes(contentKey, drop))
    wraps.push({ e: base64Encode(fresh.publicKey), w: base64Encode(wrapped) })
    drops.push({ device: device.device, value: base32Encode(drop) })
  }
  if (wraps.length === 0) return err('no-devices')
  // Shuffled, so a wrap's place says nothing about which device it's for.
  const blob = canonicalBytes({
    v: 1,
    wraps: shuffle(seal, wraps),
    commit: base64Encode(commit),
    content: base64Encode(content),
  })
  if (blob.length > MAX_BLOB_BYTES) return err('too-big')
  return ok({ blob: base64Encode(blob), drops, skipped })
}

/**
 * The drop hashes `put` takes: SHA-256 of each drop value's 32 bytes, as the Lighthouse hashes a
 * drop it's given. The Lighthouse only ever sees these.
 */
export async function dropHashes(crypto: Crypto, mail: SealedMail): Promise<string[]> {
  const hashes: string[] = []
  for (const { value } of mail.drops) {
    const bytes = base32Decode(value)
    if (bytes.ok) hashes.push(base32Encode(await crypto.sha256(bytes.value)))
  }
  // Sorted, so a drop's place says nothing about which device used it.
  return hashes.sort()
}

export type OpenError =
  | 'malformed'
  | 'not-for-this-device'
  | 'bad-signature'
  /** It opened, but isn't what this mailbox holds: another recipient, kind or day. */
  | 'unexpected'

/** What the caller fetched the mail for: anything else in it is refused. */
export interface MailExpected {
  /** This device's identity. */
  readonly to: PeerId
  readonly kinds: readonly MailKind[]
  /** The tag's date, and any day either side the caller allows. */
  readonly dates: readonly string[]
}

const parse = (bytes: Uint8Array): unknown => {
  const text = utf8Decode(bytes)
  if (!text.ok) return undefined
  try {
    return JSON.parse(text.value)
  } catch {
    return undefined
  }
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function readLetter(value: unknown): (Letter & { readonly sig: string }) | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const f = value as Record<string, unknown>
  const head = f['head'] as Record<string, unknown> | undefined
  const room = f['room']
  if (
    f['v'] !== LETTER_CONTEXT ||
    typeof room !== 'string' ||
    !room.startsWith('mail:') ||
    !KINDS.has(room.slice(5)) ||
    typeof f['sender'] !== 'string' ||
    !isPeerId(f['sender']) ||
    typeof f['to'] !== 'string' ||
    !isPeerId(f['to']) ||
    typeof f['date'] !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(f['date']) ||
    typeof f['id'] !== 'string' ||
    f['id'].length < 8 ||
    f['id'].length > 64 ||
    typeof head !== 'object' ||
    head === null ||
    !isCount(head['epoch']) ||
    !isCount(head['seq']) ||
    typeof f['from'] !== 'string' ||
    !isPeerId(f['from']) ||
    !isCount(f['at']) ||
    !('body' in f) ||
    typeof f['sig'] !== 'string'
  )
    return undefined
  return {
    kind: room.slice(5) as MailKind,
    sender: f['sender'],
    to: f['to'],
    date: f['date'],
    id: f['id'],
    head: { epoch: head['epoch'], seq: head['seq'] },
    from: f['from'],
    at: f['at'],
    body: f['body'] as Json,
    sig: f['sig'],
  }
}

/**
 * Opens a blob with this device's sealing key: tries each wrap, checks the content key against
 * the blob's commitment, opens the letter, checks the signature of the device it names, and that
 * it's for `expected.to`, of an expected kind and dated as expected. Whether that device may
 * write for `letter.sender` (it's on the sender's newest log), and whether (sender, id) was seen
 * before, are the caller's to check.
 */
export async function openMail(
  crypto: Crypto,
  seal: SealCrypto,
  sealer: Sealer,
  blob: string,
  expected: MailExpected,
): Promise<Result<OpenedMail, OpenError>> {
  const bytes = base64Decode(blob)
  if (!bytes.ok) return err('malformed')
  const outer = parse(bytes.value) as Record<string, unknown> | undefined
  const wraps = outer?.['wraps']
  const content = outer?.['content']
  const commit = outer?.['commit']
  if (
    outer?.['v'] !== 1 ||
    !Array.isArray(wraps) ||
    typeof content !== 'string' ||
    typeof commit !== 'string'
  )
    return err('malformed')
  const sealedContent = base64Decode(content)
  const commitment = base64Decode(commit)
  if (!sealedContent.ok || !commitment.ok) return err('malformed')
  for (const wrap of wraps.slice(0, MAX_DROPS)) {
    const fields = wrap as Record<string, unknown>
    const e = typeof fields?.['e'] === 'string' ? base64Decode(fields['e']) : undefined
    const w = typeof fields?.['w'] === 'string' ? base64Decode(fields['w']) : undefined
    if (e === undefined || w === undefined || !e.ok || !w.ok || !isPoint(e.value)) continue
    const shared = await sealer.share(e.value)
    if (shared === undefined) continue
    const key = await wrapKey(seal, shared, e.value, sealer.publicKey)
    const opened = await seal.open(key, w.value)
    if (opened === undefined || opened.length !== 64) continue
    const contentKey = opened.subarray(0, 32)
    // The commitment: one content key for every device, so each opens the same letter.
    const committed = await seal.hkdf(contentKey, COMMIT_INFO, 32)
    if (base64Encode(committed) !== base64Encode(commitment.value)) return err('malformed')
    const inner = await seal.open(contentKey, sealedContent.value)
    if (inner === undefined) return err('malformed')
    const letter = readLetter(parse(inner))
    if (letter === undefined) return err('malformed')
    const { sig, ...fieldsOnly } = letter
    const signature = base32Decode(sig)
    if (!signature.ok) return err('malformed')
    const valid = await crypto.verify(
      letter.from,
      signature.value,
      canonicalBytes(letterPart(fieldsOnly)),
    )
    if (!valid) return err('bad-signature')
    if (
      fieldsOnly.to !== expected.to ||
      !expected.kinds.includes(fieldsOnly.kind) ||
      !expected.dates.includes(fieldsOnly.date)
    )
      return err('unexpected')
    return ok({ letter: fieldsOnly, drop: base32Encode(opened.subarray(32)) })
  }
  return err('not-for-this-device')
}
