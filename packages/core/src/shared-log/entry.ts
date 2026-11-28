// One entry of your shared log: a change a person made on one of their devices, signed by that
// device. Your devices pass each other the entries the other lacks, so every device ends up
// holding every entry and works out the same friends, petnames, mutes, blocks and settings from
// them (fold.ts).
//
// An entry is a flat object: `v`, the identity whose log it is, the device that wrote it, its
// number `n` among that device's entries (1, 2, 3...), its `stamp`, its `kind` and the kind's own
// fields, and `sig`, the device's signature over the canonical JSON of everything else. So what an
// entry is for (its kind, whose log, which device, which number) is in the bytes it's signed over,
// and it can't pass as anything else Pigeon signs, which all carry another `v` or a `type`.
//
// A kind this Pigeon doesn't know, from a newer one, is checked the same way, kept and passed on,
// and skipped when working out what to show: its signature covers whatever fields it has.
import { base32DecodeExact, base32Encode, bytesEqual } from '../encoding/bytes.ts'
import { canonicalBytes, type Json } from '../encoding/canonical.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import { isPeerId, type PeerId } from '../identity/identity.ts'
import { MAX_HANDLE_LENGTH } from '../messages/envelope.ts'

/** What every entry's signature is for. */
export const SHARED_ENTRY_CONTEXT = 'pigeon/your-data/v1'

/** The most bytes one entry takes, signature included, as canonical JSON. */
export const MAX_SHARED_ENTRY_BYTES = 1024

/**
 * The most entries one device's log holds. Past it, its entries are refused and not passed on: a
 * person's own changes stay far below it, and it bounds what a device can make your others keep.
 */
export const MAX_SHARED_ENTRIES_PER_DEVICE = 10_000

/**
 * The highest stamp that counts. An entry stamped above it is kept and passed on, so devices
 * still agree on what they hold, but counts for nothing, and a device's own stamps stop here: so
 * one past any stamp that counts is still a safe integer, and a made-up stamp near the top can't
 * stop later changes from being stamped after it.
 */
export const STAMP_CAP: number = 2 ** 53 - 2 ** 32

/** Random bytes in an incarnation id: one friendship with one friend, from pairing to its end. */
export const INCARNATION_BYTES = 16

/** The settings your devices share. */
export type SettingKey = 'relay'

/** What a readable entry says. */
export type SharedOp =
  /**
   * A friendship began: with `friend`, as incarnation `inc`; `name` is what they were called then,
   * for a device that doesn't hold them; `before`: written at the update.
   */
  | {
      readonly kind: 'add'
      readonly friend: PeerId
      readonly inc: string
      readonly name?: string
      readonly before?: true
    }
  /** The friendship `inc` with `friend` ended, for good. */
  | { readonly kind: 'tomb'; readonly friend: PeerId; readonly inc: string }
  /** What you call `friend`; empty for their own name. */
  | { readonly kind: 'pet'; readonly friend: PeerId; readonly name: string }
  /** `friend` quiet until `until` (a time, or -1 for until you unmute), or not (`null`). */
  | { readonly kind: 'mute'; readonly friend: PeerId; readonly until: number | null }
  /** `friend` blocked or not; `name` is what they were called when blocked. */
  | {
      readonly kind: 'block'
      readonly friend: PeerId
      readonly on: boolean
      readonly name?: string
    }
  | { readonly kind: 'setting'; readonly key: SettingKey; readonly value: boolean }

export type SharedKind = SharedOp['kind']

/** An entry as it travels and is kept. Fields beyond these belong to its kind. */
export interface SharedEntry {
  readonly v: typeof SHARED_ENTRY_CONTEXT
  readonly identity: PeerId
  readonly device: PeerId
  readonly n: number
  readonly stamp: number
  readonly kind: string
  readonly sig: string
  readonly [field: string]: Json
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isCount = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= max

const isStamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1

/** An incarnation id as written: `INCARNATION_BYTES` bytes, base32, in its one spelling. */
export function isIncarnation(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const bytes = base32DecodeExact(value)
  return bytes.ok && bytes.value.length === INCARNATION_BYTES && base32Encode(bytes.value) === value
}

/** Whether `value` is JSON a signature can be checked over: no undefined, no odd numbers. */
function isJson(value: unknown, depth = 0): value is Json {
  if (depth > 8) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((item) => isJson(item, depth + 1))
  if (!isObject(value)) return false
  return Object.values(value).every((item) => isJson(item, depth + 1))
}

/** The fields each known kind has, besides the common ones: anything else makes it unreadable. */
const FIELDS: Readonly<Record<SharedKind, readonly string[]>> = {
  add: ['friend', 'inc', 'name', 'before'],
  tomb: ['friend', 'inc'],
  pet: ['friend', 'name'],
  mute: ['friend', 'until'],
  block: ['friend', 'on', 'name'],
  setting: ['key', 'value'],
}
const COMMON = ['v', 'identity', 'device', 'n', 'stamp', 'kind', 'sig']

const isPeer = (value: unknown): value is PeerId => typeof value === 'string' && isPeerId(value)

const isName = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_HANDLE_LENGTH

/**
 * What an entry says, or undefined when its kind is one this Pigeon doesn't read (from a newer
 * one) or its fields don't hold for its kind. Either way the entry is still kept and passed on.
 */
export function readOp(entry: SharedEntry): SharedOp | undefined {
  // A kind is a string from whoever signed the entry, so it's looked up only among the table's own
  // keys: `constructor` or `toString` must read as a kind this Pigeon doesn't know, like any other.
  if (!Object.hasOwn(FIELDS, entry.kind)) return undefined
  // And nothing in one entry can stop the rest being read: one that throws reads as unknown.
  try {
    return readKnown(entry)
  } catch {
    return undefined
  }
}

function readKnown(entry: SharedEntry): SharedOp | undefined {
  const kind = entry.kind as SharedKind
  const fields = FIELDS[kind]
  for (const key of Object.keys(entry))
    if (!COMMON.includes(key) && !fields.includes(key)) return undefined
  const friend = entry['friend']
  switch (kind) {
    case 'add': {
      const { before, name } = entry
      if (!isPeer(friend) || !isIncarnation(entry['inc'])) return undefined
      if (before !== undefined && before !== true) return undefined
      if (name !== undefined && !isName(name)) return undefined
      return {
        kind,
        friend,
        inc: entry['inc'],
        ...(name === undefined ? {} : { name }),
        ...(before === true ? { before } : {}),
      }
    }
    case 'tomb':
      return isPeer(friend) && isIncarnation(entry['inc'])
        ? { kind, friend, inc: entry['inc'] }
        : undefined
    case 'pet':
      return isPeer(friend) && isName(entry['name'])
        ? { kind, friend, name: entry['name'] }
        : undefined
    case 'mute': {
      const until = entry['until']
      const holds = until === null || until === -1 || (typeof until === 'number' && isStamp(until))
      return isPeer(friend) && holds ? { kind, friend, until: until as number | null } : undefined
    }
    case 'block': {
      const name = entry['name']
      if (!isPeer(friend) || typeof entry['on'] !== 'boolean') return undefined
      if (name !== undefined && !isName(name)) return undefined
      return {
        kind,
        friend,
        on: entry['on'],
        ...(name === undefined ? {} : { name }),
      }
    }
    case 'setting':
      return entry['key'] === 'relay' && typeof entry['value'] === 'boolean'
        ? { kind, key: 'relay', value: entry['value'] }
        : undefined
  }
}

/** The bytes an entry is signed over: everything in it but its signature. */
function signedBytes(entry: Readonly<Record<string, Json>>): Uint8Array {
  const { sig: _sig, ...rest } = entry
  return canonicalBytes(rest)
}

/** An entry's size as it travels. */
export const entryBytes = (entry: SharedEntry): number => canonicalBytes(entry).length

/**
 * The shape every entry has, whatever its kind: for `identity`'s log, numbered, stamped, at most
 * `MAX_SHARED_ENTRY_BYTES`, its signature in its one spelling. Not the signature itself.
 */
export function isSharedEntry(identity: PeerId, value: unknown): value is SharedEntry {
  if (!isObject(value) || !isJson(value)) return false
  const { v, device, n, stamp, kind, sig } = value
  if (
    v !== SHARED_ENTRY_CONTEXT ||
    value['identity'] !== identity ||
    typeof device !== 'string' ||
    !isPeerId(device) ||
    !isCount(n, MAX_SHARED_ENTRIES_PER_DEVICE) ||
    !isStamp(stamp) ||
    typeof kind !== 'string' ||
    kind.length === 0 ||
    kind.length > 32 ||
    typeof sig !== 'string'
  )
    return false
  const signature = base32DecodeExact(sig)
  if (!signature.ok || base32Encode(signature.value) !== sig) return false
  return entryBytes(value as SharedEntry) <= MAX_SHARED_ENTRY_BYTES
}

/** Whether an entry of the right shape is signed by the device it names, in the one spelling. */
export async function verifyEntry(crypto: Crypto, entry: SharedEntry): Promise<boolean> {
  const signature = base32DecodeExact(entry.sig)
  if (!signature.ok) return false
  return crypto.verify(entry.device, signature.value, signedBytes(entry))
}

/** A signature as the bytes it's compared by: its decoded Ed25519 bytes. */
export function sigBytesOf(entry: SharedEntry): Uint8Array {
  const signature = base32DecodeExact(entry.sig)
  return signature.ok ? signature.value : new Uint8Array()
}

/** Whether two entries are the same signed entry: compared as decoded bytes, never as text. */
export const sameEntry = (a: SharedEntry, b: SharedEntry): boolean =>
  a.device === b.device &&
  a.n === b.n &&
  bytesEqual(signedBytes(a), signedBytes(b)) &&
  bytesEqual(sigBytesOf(a), sigBytesOf(b))

/** Orders two byte strings: the first differing byte decides, then the shorter. */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return a.length - b.length
}

/** Fields an op is written with, beside the common ones. */
function opFields(op: SharedOp): Record<string, Json> {
  const { kind: _kind, ...fields } = op
  return fields as Record<string, Json>
}

/** Signs a new entry: `signer` is the device writing it, as entry `n` of its log. */
export async function signEntry(
  signer: Signer,
  identity: PeerId,
  n: number,
  stamp: number,
  op: SharedOp,
): Promise<SharedEntry> {
  const unsigned = {
    v: SHARED_ENTRY_CONTEXT,
    identity,
    device: signer.id,
    n,
    stamp,
    kind: op.kind,
    ...opFields(op),
  }
  const sig = base32Encode(await signer.sign(canonicalBytes(unsigned)))
  return { ...unsigned, sig } as SharedEntry
}

/**
 * What an op is about, for stamping: a new change is stamped after every entry about the same
 * friend or setting.
 */
export function subjectOf(op: SharedOp): string {
  switch (op.kind) {
    case 'setting':
      return `setting:${op.key}`
    default:
      return `friend:${op.friend}`
  }
}
