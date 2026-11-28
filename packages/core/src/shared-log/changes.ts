// The entries a person's change on one device becomes. Each is written as this device's next
// entry and stamped by `stampFor`, so a change made after seeing another beats it.

import { base32Encode } from '../encoding/bytes.ts'
import type { Signer } from '../identity/crypto.ts'
import type { PeerId } from '../identity/identity.ts'
import {
  INCARNATION_BYTES,
  MAX_SHARED_ENTRIES_PER_DEVICE,
  type SharedEntry,
  type SharedOp,
  STAMP_CAP,
  signEntry,
  subjectOf,
} from './entry.ts'
import { counting, type FoldContext } from './fold.ts'
import { nextNumber, type SharedLog, withEntry } from './log.ts'

/**
 * Every friendship with `friend` this device holds and hasn't ended, shown or not: a block hides
 * a friendship without ending it, and two devices pairing again at once leave two.
 */
export function heldFriendships(
  log: SharedLog,
  context: FoldContext,
  friend: PeerId,
): readonly string[] {
  const entries = counting(log, context)
  const ended = new Set(entries.flatMap(({ op }) => (op.kind === 'tomb' ? [op.inc] : [])))
  const out = new Set<string>()
  for (const { op } of entries)
    if (op.kind === 'add' && op.friend === friend && !ended.has(op.inc)) out.add(op.inc)
  return [...out].sort()
}

/** Unfriending: a tombstone for every friendship with them held here, which nothing undoes. */
export function unfriendOps(
  log: SharedLog,
  context: FoldContext,
  friend: PeerId,
): readonly SharedOp[] {
  return heldFriendships(log, context, friend).map((inc) => ({ kind: 'tomb', friend, inc }))
}

/** Blocking: unfriending, then the block, stamped after the tombstones. */
export function blockOps(
  log: SharedLog,
  context: FoldContext,
  friend: PeerId,
  name: string | undefined,
): readonly SharedOp[] {
  return [
    ...unfriendOps(log, context, friend),
    { kind: 'block', friend, on: true, ...(name === undefined ? {} : { name }) },
  ]
}

/**
 * Two live friendships with one friend, from two devices pairing again at once: once this device
 * sees the friend in one of them (`seen`, a bound hello in its rooms or a letter from one of the
 * friend's devices under its tags), the others end, so every device ends on the friendship the
 * friend is in. Nothing while only one is held, or while `seen` isn't one of them.
 */
export function settleOps(
  log: SharedLog,
  context: FoldContext,
  friend: PeerId,
  seen: string,
): readonly SharedOp[] {
  const held = heldFriendships(log, context, friend)
  if (held.length < 2 || !held.includes(seen)) return []
  return held.filter((inc) => inc !== seen).map((inc) => ({ kind: 'tomb', friend, inc }))
}

/**
 * The `at` the device that removes devices stamps the device-log entry with (a `remove`, or a
 * `recover` that leaves them off): later than `now` and than every entry it holds from them that
 * counts, so what they had already delivered keeps counting however fast their clocks ran. An
 * entry above the cap counts for nothing and is skipped, and `at` never goes past the cap, so a
 * device that stamps at the top of the safe integers while listed can still be removed.
 */
export function removalAt(log: SharedLog, removed: readonly PeerId[], now: number): number {
  let at = Math.max(1, Math.floor(now))
  for (const entry of log.entries)
    if (removed.includes(entry.device) && entry.stamp <= STAMP_CAP)
      at = Math.max(at, entry.stamp + 1)
  return Math.min(at, STAMP_CAP)
}

/**
 * The stamp a new change gets: later than this device's clock and than every entry about the
 * same friend or setting that counts here, so a change made after seeing another beats it. An
 * entry that doesn't count (a removed device's from its removal on, one stamped above the cap)
 * never raises it, and it stops at the cap. A stamp held far ahead moves only stamps about its
 * own subject, never this device's clock.
 */
export function stampFor(log: SharedLog, context: FoldContext, op: SharedOp, now: number): number {
  const subject = subjectOf(op)
  let stamp = Math.max(1, Math.floor(now))
  for (const { entry, op: held } of counting(log, context))
    if (subjectOf(held) === subject) stamp = Math.max(stamp, entry.stamp + 1)
  return Math.min(stamp, STAMP_CAP)
}

/** Writes `op` as this device's next entry, stamped by `stampFor`. */
export async function appendShared(
  log: SharedLog,
  signer: Signer,
  op: SharedOp,
  now: number,
  context: FoldContext,
): Promise<{ readonly log: SharedLog; readonly entry: SharedEntry } | undefined> {
  const n = nextNumber(log, signer.id)
  if (n > MAX_SHARED_ENTRIES_PER_DEVICE) return undefined
  const at = stampFor(log, context, op, now)
  const entry = await signEntry(signer, log.identity, n, at, op)
  return { log: withEntry(log, entry), entry }
}

/** A new friendship's incarnation id: `INCARNATION_BYTES` random bytes. */
export const newIncarnation = (random: (length: number) => Uint8Array): string =>
  base32Encode(random(INCARNATION_BYTES))
