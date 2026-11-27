// What a device shows, worked out from the entries it holds: which friendships are live, each
// friend's petname and whether they're blocked, and the relay setting. The same entries give the
// same view on every device, whatever order they came in, which is what makes the log converge.
//
// - An `add` makes a friendship (an incarnation) live, and a `tomb` naming it ends it for good:
//   nothing brings that incarnation back, only pairing again, which is a new one.
// - A petname, a block and the relay setting each take the value of the entry with the highest
//   stamp, then device, then number (the last two only settle ties).
// - A block hides every friendship added before it (by stamp); one added after it stays.
// - Entries a removed device stamped at or after its removal count for nothing on a device that
//   knows of the removal. Those it stamped before still count: that is its own word, as a chat
//   entry's time is.
import {
  type DataRules,
  type DataState,
  type Dev,
  type Entry,
  type FriendId,
  knowsRemoval,
  REMOVED,
} from './data-state.ts'

export interface View {
  /** Live incarnations, each with its friend. */
  readonly live: Readonly<Record<string, FriendId>>
  readonly pet: Readonly<Partial<Record<FriendId, string>>>
  readonly blocked: Readonly<Partial<Record<FriendId, boolean>>>
  readonly relay: boolean
}

/** The register an entry writes, or nothing for friendship entries and unreadable ones. */
export function fieldOf(e: Entry): string | undefined {
  switch (e.op.k) {
    case 'pet':
    case 'block':
      return `${e.op.k}:${e.op.fr}`
    case 'relay':
      return 'relay'
    default:
      return undefined
  }
}

export function valueIn(e: Entry): string {
  switch (e.op.k) {
    case 'pet':
      return e.op.v
    case 'block':
    case 'relay':
      return String(e.op.v)
    default:
      return e.op.k
  }
}

/** Whether an entry counts on device `d`. */
export function counts(state: DataState, rules: DataRules, d: Dev, e: Entry): boolean {
  if (e.op.k === 'future') return false
  const dev = state.devs[d]
  if (rules.discountRemoved && e.by === REMOVED && dev && knowsRemoval(dev))
    return e.st < state.removalSt
  return true
}

const later = (a: Entry, b: Entry): boolean =>
  a.st !== b.st ? a.st > b.st : a.by !== b.by ? a.by > b.by : a.n > b.n

/** The winning entry of each register among those that count. */
export function winners(
  state: DataState,
  rules: DataRules,
  d: Dev,
  entries: readonly Entry[],
): Map<string, Entry> {
  const win = new Map<string, Entry>()
  for (const e of entries) {
    const field = fieldOf(e)
    if (field === undefined || !counts(state, rules, d, e)) continue
    const held = win.get(field)
    // Off, the entry that arrived last wins: a device back from days away overwrites newer values.
    if (!held || !rules.stampOrder || later(e, held)) win.set(field, e)
  }
  return win
}

export function viewOf(state: DataState, rules: DataRules, d: Dev): View {
  const entries = state.devs[d]?.entries ?? []
  const win = winners(state, rules, d, entries)
  const counting = entries.filter((e) => counts(state, rules, d, e))
  const ended = new Set(counting.flatMap((e) => (e.op.k === 'tomb' ? [e.op.inc] : [])))
  const live: Record<string, FriendId> = {}
  const pet: Partial<Record<FriendId, string>> = {}
  const blocked: Partial<Record<FriendId, boolean>> = {}
  for (const e of counting) {
    if (e.op.k !== 'add' || ended.has(e.op.inc)) continue
    const block = win.get(`block:${e.op.fr}`)
    if (block?.op.k === 'block' && block.op.v && block.st > e.st) continue
    live[e.op.inc] = e.op.fr
  }
  for (const e of win.values()) {
    if (e.op.k === 'pet') pet[e.op.fr] = e.op.v
    if (e.op.k === 'block') blocked[e.op.fr] = e.op.v
  }
  const relay = win.get('relay')
  return { live, pet, blocked, relay: relay?.op.k === 'relay' ? relay.op.v : false }
}

export const liveFriends = (view: View): FriendId[] => [...new Set(Object.values(view.live))].sort()
