// Which pair secret a device is on for a friendship, worked out from the signed proposals it
// knows, as replacement rounds settle it. Starting from the friendship's first secret (made when
// pairing, replacing nothing), it follows the earliest proposal for the secret held, by time,
// then device, then secret, counting only proposals whose device is on its side's list. So:
//
// - rival proposals for one secret settle on the same one everywhere;
// - a proposal from a device later removed stops counting once the removal is heard, and the
//   device falls back to the secret before it, or a rival that counts;
// - nobody can jump ahead by claiming a high round: a proposal counts only as a link in the chain.
import { uniq } from './canon.ts'
import { counts as entryCounts } from './data-fold.ts'
import {
  type DataRules,
  type DataState,
  type Dev,
  type FriendDevice,
  type FriendId,
  knowsRemoval,
  listOf,
  type Proposal,
  propKey,
  REMOVED,
} from './data-state.ts'

const earlier = (a: Proposal, b: Proposal): boolean =>
  a.at !== b.at ? a.at < b.at : a.by !== b.by ? a.by < b.by : a.id < b.id

/** The secret the proposals settle on, counting those `counts` takes. */
export function winner(
  rules: DataRules,
  props: readonly Proposal[],
  counts: (p: Proposal) => boolean,
): Proposal | undefined {
  if (!rules.chainRules) {
    // The defect: the highest round anyone claims, counted or not, and never given up.
    return props.reduce<Proposal | undefined>(
      (best, p) => (!best || p.round > best.round ? p : best),
      undefined,
    )
  }
  let current = props.find((p) => p.replaces === null)
  while (current) {
    const from: Proposal = current
    const next = props
      .filter((p) => p.replaces === from.id && counts(p))
      .reduce<Proposal | undefined>((best, p) => (!best || earlier(p, best) ? p : best), undefined)
    if (!next) break
    current = next
  }
  return current
}

/** Whether a proposal counts on your device `d`: by a friend's device, or one on `d`'s list. */
export const countsOn =
  (state: DataState, d: Dev) =>
  (p: Proposal): boolean =>
    p.replaces === null || p.by === 'F' || p.by === 'G' || listOf(state, d).includes(p.by as Dev)

/** Whether a proposal counts on a friend's device: unless it's by a device it knows you removed. */
export const countsOnFriend =
  (friend: FriendDevice) =>
  (p: Proposal): boolean =>
    p.replaces === null || !(friend.knowsR && p.by === REMOVED)

/** The secret device `d` is on for friendship `inc` of `fr`. */
export function secretOf(
  rules: DataRules,
  state: DataState,
  d: Dev,
  fr: FriendId,
  inc: string,
): Proposal | undefined {
  const props = state.devs[d]?.props[propKey(rules, fr, inc)] ?? []
  return winner(rules, props, countsOn(state, d))
}

export const friendSecret = (rules: DataRules, friend: FriendDevice): Proposal | undefined =>
  winner(rules, friend.props, countsOnFriend(friend))

/**
 * Adds proposals to those a device knows. A friendship's proposals stay, unused, after its
 * tombstone lands: a tombstone can stop counting (a removed device's, stamped after its removal),
 * and then the friendship shows again on the secret it was on.
 */
export function takeProps(
  state: DataState,
  d: Dev,
  incoming: Readonly<Record<string, readonly Proposal[]>>,
): boolean {
  const dev = state.devs[d]
  if (!dev) return false
  let changed = false
  for (const [key, props] of Object.entries(incoming)) {
    const held = dev.props[key] ?? []
    const fresh = props.filter((p) => !held.some((h) => h.id === p.id))
    if (fresh.length === 0) continue
    dev.props[key] = [...held, ...fresh]
    changed = true
  }
  dev.learned = uniq([
    ...dev.learned,
    ...Object.values(incoming).flatMap((ps) => ps.map((p) => p.id)),
  ])
  return changed
}

/** Every proposal id in a set of proposals, for what a reader learns. */
export const propIds = (props: Readonly<Record<string, readonly Proposal[]>>): string[] =>
  Object.values(props).flatMap((ps) => ps.map((p) => p.id))

/** Whether device `d` has heard of the removal, for a proposal's ghost. */
export const knew = (state: DataState, d: Dev): boolean => {
  const dev = state.devs[d]
  return dev ? knowsRemoval(dev) : false
}

/**
 * The planted defect only: drops the pair-secret state of every friendship this device holds a
 * counting tombstone for, which loses it for good if the tombstone later stops counting.
 */
export function dropEnded(rules: DataRules, state: DataState, d: Dev): void {
  const dev = state.devs[d]
  if (!dev || rules.keepEndedSecrets) return
  for (const e of dev.entries)
    if (e.op.k === 'tomb' && entryCounts(state, rules, d, e)) delete dev.props[e.op.inc]
}
