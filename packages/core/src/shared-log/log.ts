// Your shared log as one device holds it: every entry it has from each of your devices, and how
// two devices find out what the other lacks.
//
// Entries are taken one by one: one that doesn't hold is dropped, never the rest. One from a key
// that was never on your device log is refused (and so never passed on). Two different entries one
// device signed under one number can only come from that device; every device keeps the one with
// the lower signature bytes, so all of them end on the same one whatever order they came in.
//
// A summary carries, per device, the highest number held and a digest of every entry held from
// it, gaps included: a device can sign numbers out of order, or skip some, so what is held is
// described whole, never as a run from 1. A device whose entries up to the other's highest number
// match the other's digest is sent only those above it; one whose entries there differ (two
// entries under one number, or a gap one side has filled) is sent all of that device's entries,
// so the lower signature and anything missing reach it. A device ahead checks the shorter range
// itself, so nothing it holds is sent to it again, and two devices holding the same entries send
// each other nothing.
import { base32Encode, utf8Encode } from '../encoding/bytes.ts'
import { canonicalBytes } from '../encoding/canonical.ts'
import type { Crypto } from '../identity/crypto.ts'
import { isPeerId, type PeerId } from '../identity/identity.ts'
import {
  compareBytes,
  isSharedEntry,
  MAX_SHARED_ENTRIES_PER_DEVICE,
  type SharedEntry,
  sameEntry,
  sigBytesOf,
  verifyEntry,
} from './entry.ts'

export interface SharedLog {
  readonly identity: PeerId
  /** Sorted by device, then number: one entry for each. */
  readonly entries: readonly SharedEntry[]
}

/** Per device: the highest number held, and a digest of every entry held up to it, gaps included. */
export type SharedSummary = Readonly<
  Record<PeerId, { readonly n: number; readonly digest: string }>
>

export const emptySharedLog = (identity: PeerId): SharedLog => ({ identity, entries: [] })

const byDeviceAndNumber = (a: SharedEntry, b: SharedEntry): number =>
  a.device < b.device ? -1 : a.device > b.device ? 1 : a.n - b.n

const keyOf = (entry: Pick<SharedEntry, 'device' | 'n'>): string => `${entry.device}/${entry.n}`

/**
 * Takes `incoming` into `log`: each entry of the log's identity, signed by its device, from a
 * device in `authors` (every device ever on your device log), and within that device's cap.
 * `taken` is what changed what the log holds.
 */
export async function takeSharedEntries(
  crypto: Crypto,
  log: SharedLog,
  incoming: readonly unknown[],
  authors: ReadonlySet<PeerId>,
): Promise<{ readonly log: SharedLog; readonly taken: readonly SharedEntry[] }> {
  const held = new Map(log.entries.map((entry) => [keyOf(entry), entry]))
  const taken: SharedEntry[] = []
  for (const value of incoming) {
    if (!isSharedEntry(log.identity, value)) continue
    if (!authors.has(value.device) || value.n > MAX_SHARED_ENTRIES_PER_DEVICE) continue
    const kept = held.get(keyOf(value))
    if (kept !== undefined && sameEntry(kept, value)) continue
    // Two entries under one number: the lower signature, compared as bytes, stays everywhere.
    if (kept !== undefined && compareBytes(sigBytesOf(value), sigBytesOf(kept)) >= 0) continue
    if (!(await verifyEntry(crypto, value))) continue
    held.set(keyOf(value), value)
    taken.push(value)
  }
  if (taken.length === 0) return { log, taken }
  return {
    log: { identity: log.identity, entries: [...held.values()].sort(byDeviceAndNumber) },
    taken,
  }
}

/** One device's entries in `log`, in order. */
const entriesOf = (log: SharedLog, device: PeerId) =>
  log.entries.filter((entry) => entry.device === device)

/** The highest number held among one device's entries in order, gaps or not. */
const highest = (entries: readonly SharedEntry[]): number => entries.at(-1)?.n ?? 0

/**
 * A digest of every entry held from one device numbered up to `n`, gaps included: SHA-256 over
 * their signatures' bytes in order.
 */
async function digestOf(
  crypto: Crypto,
  entries: readonly SharedEntry[],
  n: number,
): Promise<string> {
  const sigs = entries
    .filter((entry) => entry.n <= n)
    .map((entry) => base32Encode(sigBytesOf(entry)))
  return base32Encode(await crypto.sha256(canonicalBytes(sigs)))
}

export async function summarizeShared(crypto: Crypto, log: SharedLog): Promise<SharedSummary> {
  const out: Record<PeerId, { n: number; digest: string }> = {}
  for (const device of new Set(log.entries.map((entry) => entry.device))) {
    const mine = entriesOf(log, device)
    const n = highest(mine)
    if (n > 0) out[device] = { n, digest: await digestOf(crypto, mine, n) }
  }
  return out
}

/**
 * What a summary says of `device`, looked up among its own keys only: a summary comes from
 * another device, so no name it holds or doesn't is read through what every object inherits.
 */
export const summaryOf = (
  summary: SharedSummary,
  device: PeerId,
): { readonly n: number; readonly digest: string } | undefined =>
  Object.hasOwn(summary, device) ? summary[device] : undefined

/** The most devices a summary names: far more than anyone has ever had on their list. */
export const MAX_SUMMARY_DEVICES = 64

/** Reads a summary as it arrives: anything that doesn't hold is left out. */
export function readSharedSummary(value: unknown): SharedSummary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<PeerId, { n: number; digest: string }> = {}
  for (const [device, item] of Object.entries(value).slice(0, MAX_SUMMARY_DEVICES)) {
    // Keyed by device ids only, so no name another device sends (`__proto__`) lands on the object.
    if (!isPeerId(device) || typeof item !== 'object' || item === null) continue
    const { n, digest } = item as Record<string, unknown>
    if (
      typeof n === 'number' &&
      Number.isSafeInteger(n) &&
      n >= 0 &&
      n <= MAX_SHARED_ENTRIES_PER_DEVICE &&
      typeof digest === 'string' &&
      digest.length <= 64
    )
      out[device] = { n, digest }
  }
  return out
}

/**
 * What `log` holds that a device whose summary is `theirs` lacks, in order: per device, the
 * entries past their highest number, or all that device's entries when what this log holds up to
 * that number differs from what their digest says they hold. Nothing for a device they're ahead
 * on: they check that range against this log's summary themselves.
 */
export async function missingShared(
  crypto: Crypto,
  log: SharedLog,
  theirs: SharedSummary | undefined,
): Promise<readonly SharedEntry[]> {
  if (theirs === undefined) return log.entries
  const out: SharedEntry[] = []
  for (const device of new Set(log.entries.map((entry) => entry.device))) {
    const mine = entriesOf(log, device)
    const them = summaryOf(theirs, device)
    if (them === undefined) {
      out.push(...mine)
      continue
    }
    const ours = highest(mine)
    if (them.n > ours) continue
    if ((await digestOf(crypto, mine, them.n)) !== them.digest) out.push(...mine)
    else out.push(...mine.filter((entry) => entry.n > them.n))
  }
  return out
}

/**
 * Whether a device whose summary is `theirs` holds something `log` lacks: more of some device's
 * entries, or as many with a different digest (two entries under one number).
 */
export async function behindShared(
  crypto: Crypto,
  log: SharedLog,
  theirs: SharedSummary,
): Promise<boolean> {
  for (const [device, them] of Object.entries(theirs)) {
    const mine = entriesOf(log, device)
    const ours = highest(mine)
    if (them.n > ours) return true
    if (them.n > 0 && (await digestOf(crypto, mine, them.n)) !== them.digest) return true
  }
  return false
}

/** The number `device`'s next entry in `log` takes. */
export const nextNumber = (log: SharedLog, device: PeerId): number =>
  (entriesOf(log, device).at(-1)?.n ?? 0) + 1

/** `log` with an entry this device just signed, in its place. */
export const withEntry = (log: SharedLog, entry: SharedEntry): SharedLog => ({
  identity: log.identity,
  entries: [...log.entries, entry].sort(byDeviceAndNumber),
})

/**
 * Entries to send, each device's in turn, one at a time, so a device with many entries can't
 * crowd out the others in a letter that holds only so many: those in `first` (your devices on
 * the list) before the rest, each device's oldest first.
 */
export function inTurn(
  entries: readonly SharedEntry[],
  first: ReadonlySet<PeerId>,
): readonly SharedEntry[] {
  const queues = new Map<PeerId, SharedEntry[]>()
  for (const entry of entries)
    queues.set(entry.device, [...(queues.get(entry.device) ?? []), entry])
  const devices = [...queues.keys()].sort()
  const out: SharedEntry[] = []
  for (const group of [devices.filter((d) => first.has(d)), devices.filter((d) => !first.has(d))])
    for (let i = 0; out.length < entries.length; i++) {
      const round = group.flatMap((device) => queues.get(device)?.[i] ?? [])
      if (round.length === 0) break
      out.push(...round)
    }
  return out
}

/** Splits entries into batches whose JSON stays under `maxBytes`, oldest first. */
export function batchShared(
  entries: readonly SharedEntry[],
  maxBytes: number,
): readonly (readonly SharedEntry[])[] {
  const out: SharedEntry[][] = []
  let batch: SharedEntry[] = []
  let size = 0
  for (const entry of entries) {
    const bytes = utf8Encode(JSON.stringify(entry)).length + 1
    if (batch.length > 0 && size + bytes > maxBytes) {
      out.push(batch)
      batch = []
      size = 0
    }
    batch.push(entry)
    size += bytes
  }
  if (batch.length > 0) out.push(batch)
  return out
}
