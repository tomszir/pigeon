// What your devices show, worked out from the shared log's entries: the same entries give the same
// view on every device, whatever order they came in, which is what keeps your devices in step.
//
// - An `add` makes a friendship (an incarnation) live, and a `tomb` naming it ends it for good:
//   nothing brings that incarnation back, only pairing again, which makes a new one.
// - A petname, a mute, a block and each setting take the value of the entry with the highest
//   stamp, then device, then number (the last two only settle ties).
// - A block hides every friendship added at or before it, by stamp; one added after it stays.
// - Of two live friendships with one friend (paired again on two devices at once), the newer add
//   shows.
// - An entry counts only from a device that is or was on your device log, and only when stamped
//   at or under the cap. Entries a removed device stamped at or after its removal count for
//   nothing, measured against the removal's own `at` in the device log, which the device that
//   removed it stamped later than every entry it held from it. What it stamped before still
//   counts, as its own word.
import type { Removal } from '../devices/device-log.ts'
import type { PeerId } from '../identity/identity.ts'
import { readOp, type SharedEntry, type SharedOp, STAMP_CAP } from './entry.ts'
import type { SharedLog } from './log.ts'

/** What a device knows of your device log that the fold needs. */
export interface FoldContext {
  /** Every device ever on your device log. */
  readonly authors: ReadonlySet<PeerId>
  /** Each device no longer on the list, with its removal. */
  readonly removals: ReadonlyMap<PeerId, Removal>
}

export interface Friendship {
  readonly friend: PeerId
  readonly inc: string
  /** The stamp of the newest add that made it. */
  readonly stamp: number
}

export interface SharedView {
  /** Every friendship that is live: added, not ended, not hidden by a block. */
  readonly friendships: ReadonlyMap<string, Friendship>
  /** For each friend, the friendship shown: the newest live one. */
  readonly shown: ReadonlyMap<PeerId, Friendship>
  /** Every friendship a counting tomb ended. */
  readonly ended: ReadonlySet<string>
  readonly petnames: ReadonlyMap<PeerId, string>
  /** Until when each muted friend is quiet: a time, or -1 for until you unmute. */
  readonly mutes: ReadonlyMap<PeerId, number>
  /** Each blocked person, with what they were called when blocked. */
  readonly blocked: ReadonlyMap<PeerId, { readonly name?: string }>
  readonly relay: boolean
  /**
   * The registers some counting entry speaks for (`pet:<friend>`, `mute:<friend>`,
   * `block:<friend>`, `setting:relay`), so an unset value is told apart from one nobody set.
   */
  readonly said: ReadonlySet<string>
}

/** Which of two entries is later: stamp, then device, then number. */
export const later = (a: SharedEntry, b: SharedEntry): boolean =>
  a.stamp !== b.stamp ? a.stamp > b.stamp : a.device !== b.device ? a.device > b.device : a.n > b.n

/** Every entry that counts, with what it says. */
export function counting(
  log: SharedLog,
  context: FoldContext,
): readonly { readonly entry: SharedEntry; readonly op: SharedOp }[] {
  const out: { entry: SharedEntry; op: SharedOp }[] = []
  for (const entry of log.entries) {
    if (!context.authors.has(entry.device) || entry.stamp > STAMP_CAP) continue
    // A removed device's entries count up to its removal's own `at`, which the device that
    // removed it stamped later than every entry it held from it.
    const removal = context.removals.get(entry.device)
    if (removal !== undefined && entry.stamp >= removal.at) continue
    const op = readOp(entry)
    if (op !== undefined) out.push({ entry, op })
  }
  return out
}

/** The register an op writes, or nothing for friendship entries and thresholds. */
function registerOf(op: SharedOp): string | undefined {
  switch (op.kind) {
    case 'pet':
    case 'mute':
    case 'block':
      return `${op.kind}:${op.friend}`
    case 'setting':
      return `setting:${op.key}`
    default:
      return undefined
  }
}

export function foldShared(log: SharedLog, context: FoldContext): SharedView {
  const entries = counting(log, context)
  const winners = new Map<string, { entry: SharedEntry; op: SharedOp }>()
  const ended = new Set<string>()
  for (const item of entries) {
    if (item.op.kind === 'tomb') ended.add(item.op.inc)
    const register = registerOf(item.op)
    if (register === undefined) continue
    const held = winners.get(register)
    if (held === undefined || later(item.entry, held.entry)) winners.set(register, item)
  }
  const petnames = new Map<PeerId, string>()
  const mutes = new Map<PeerId, number>()
  const blocked = new Map<PeerId, { name?: string }>()
  const blockedAt = new Map<PeerId, number>()
  let relay = false
  for (const { entry, op } of winners.values()) {
    if (op.kind === 'pet' && op.name !== '') petnames.set(op.friend, op.name)
    if (op.kind === 'mute' && op.until !== null) mutes.set(op.friend, op.until)
    if (op.kind === 'block' && op.on) {
      blocked.set(op.friend, op.name === undefined ? {} : { name: op.name })
      blockedAt.set(op.friend, entry.stamp)
    }
    if (op.kind === 'setting' && op.key === 'relay') relay = op.value
  }
  // Each live friendship, from its newest add.
  const adds = new Map<string, { entry: SharedEntry; friend: PeerId }>()
  for (const { entry, op } of entries) {
    if (op.kind !== 'add' || ended.has(op.inc)) continue
    const held = adds.get(op.inc)
    if (held === undefined || later(entry, held.entry))
      adds.set(op.inc, { entry, friend: op.friend })
  }
  const friendships = new Map<string, Friendship>()
  const shown = new Map<PeerId, Friendship>()
  const shownEntry = new Map<PeerId, SharedEntry>()
  for (const [inc, { entry, friend }] of adds) {
    const block = blockedAt.get(friend)
    if (block !== undefined && block >= entry.stamp) continue
    const friendship = { friend, inc, stamp: entry.stamp }
    friendships.set(inc, friendship)
    const held = shownEntry.get(friend)
    if (held === undefined || later(entry, held)) {
      shown.set(friend, friendship)
      shownEntry.set(friend, entry)
    }
  }
  return {
    friendships,
    shown,
    ended,
    petnames,
    mutes,
    blocked,
    relay,
    said: new Set(winners.keys()),
  }
}

/** Every live friendship with `friend`, newest first. */
export function friendshipsWith(view: SharedView, friend: PeerId): readonly Friendship[] {
  return [...view.friendships.values()]
    .filter((friendship) => friendship.friend === friend)
    .sort((a, b) => b.stamp - a.stamp || (a.inc < b.inc ? 1 : -1))
}
