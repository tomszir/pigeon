// Which pair secret a device is on for a friendship, worked out from the signed proposals it
// knows, as replacement rounds settle it. Starting from the friendship's first secret (made when
// pairing, replacing nothing), it follows the earliest proposal for the secret held, by time,
// then device, then secret, counting only proposals whose device is on its side's list. So:
//
// - rival proposals for one secret settle on the same one everywhere;
// - a proposal from a device later removed stops counting once the removal is heard, and the
//   device falls back to the secret before it, or a rival that counts;
// - nobody can jump ahead by claiming a high round: a proposal counts only as a link in the chain;
// - a first secret counts as an entry does (from a device on the list, or from a removed one that
//   stamped it before its removal), and of several, the earliest wins, so arrival order never
//   decides. A removed device can still backdate one; the writer's renewal replaces it.
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
  // The defect: whichever first secret the device happens to hold first.
  let current = rules.rootRules
    ? props
        .filter((p) => p.replaces === null && counts(p))
        .reduce<Proposal | undefined>(
          (best, p) => (!best || earlier(p, best) ? p : best),
          undefined,
        )
    : props.find((p) => p.replaces === null)
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

/**
 * Whether a proposal counts on your device `d`: by a friend's device, or by one on `d`'s list. A
 * first secret by a device `d` knows was removed counts if stamped before the removal, as an
 * entry would; a replacement by it never does.
 */
export const countsOn =
  (rules: DataRules, state: DataState, d: Dev) =>
  (p: Proposal): boolean => {
    if (p.by === 'F' || p.by === 'G' || listOf(state, d).includes(p.by as Dev)) return true
    if (p.replaces !== null) return false
    return !rules.rootRules || p.at < state.removalSt
  }

/** The same on a friend's device, which knows of a removal once a letter carrying it arrives. */
export const countsOnFriend =
  (rules: DataRules, state: DataState, friend: FriendDevice) =>
  (p: Proposal): boolean => {
    if (!(friend.knowsR && p.by === REMOVED)) return true
    if (p.replaces !== null) return false
    return !rules.rootRules || p.at < state.removalSt
  }

/** The secret device `d` is on for friendship `inc` of `fr`. */
export function secretOf(
  rules: DataRules,
  state: DataState,
  d: Dev,
  fr: FriendId,
  inc: string,
): Proposal | undefined {
  const props = state.devs[d]?.props[propKey(rules, fr, inc)] ?? []
  return winner(rules, props, countsOn(rules, state, d))
}

export const friendSecret = (
  rules: DataRules,
  state: DataState,
  friend: FriendDevice,
): Proposal | undefined => winner(rules, friend.props, countsOnFriend(rules, state, friend))

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
