// The friend's side, running the same rules as yours. A friend's device takes your proposals for
// the friendship it is in, refuses a letter from a device it knows you removed, and, when its
// secret changes, sends the proposals back to your devices, first secrets included. The friend can
// propose a round of its own, and remove one of its own devices, after which its writer renews
// the friendship by the same rule as yours.
import { uniq } from './canon.ts'
import { friendSecret } from './data-secrets.ts'
import {
  type DataConfig,
  type DataState,
  type Dev,
  type FriendDevice,
  type FriendId,
  type Letter,
  type LogEvent,
  type Proposal,
  propKey,
  REMOVED,
} from './data-state.ts'

/** The removals a friend's device has merged: yours of X, and its own. */
export const friendKnows = (f: FriendDevice): LogEvent[] => [
  ...(f.knowsR ? (['rmX'] as const) : []),
  ...(f.ownRemoved ? (['rmF'] as const) : []),
]

/** Sends your devices on the friend's copy of your list the proposals the friend holds. */
function friendSend(cfg: DataConfig, state: DataState, fr: FriendId): void {
  const f = state.friends[fr]
  if (!f) return
  const to = (Object.keys(state.devs) as Dev[]).filter((d) => d !== REMOVED || !f.knowsR)
  state.mail.push({
    id: state.nextLetter++,
    kind: 'friend-rekey',
    from: fr,
    to,
    pending: to,
    lost: [],
    put: true,
    knew: f.knowsR,
    sealedWith: [],
    log: friendKnows(f),
    entries: [],
    props: { [propKey(cfg.rules, fr, f.inc)]: f.props },
    summary: {},
  })
}

/** The friend proposes a replacement for the secret it is on, and sends it to your devices. */
export function friendPropose(cfg: DataConfig, state: DataState, fr: FriendId): void {
  const f = state.friends[fr]
  const held = f ? friendSecret(cfg.rules, state, f) : undefined
  if (!f || !held) return
  const at =
    Math.max(
      ...Object.values(state.devs).map((d) => d?.clock ?? 0),
      ...f.props.map((p) => p.at),
      f.ownRemovedAt,
    ) + 1
  let id = `${f.inc}f${held.round + 1}`
  while (state.secrets[id]) id = `${id}'`
  const p: Proposal = {
    id,
    inc: f.inc,
    replaces: held.id,
    at,
    by: fr,
    round: held.round + 1,
    knew: friendKnows(f),
  }
  f.props = [...f.props, p]
  f.learned = uniq([...f.learned, p.id])
  state.secrets[p.id] = { by: fr, knew: f.knowsR }
  friendSend(cfg, state, fr)
}

/**
 * Whether the friend's writer must renew, after removing one of its own devices: the same rule as
 * yours, mirrored. Under the design, when the secret it is on was signed by a device that hadn't
 * merged that removal; under the planted defect, unless it proposed the secret itself after the
 * removal, by time.
 */
export function friendToRenew(cfg: DataConfig, state: DataState, fr: FriendId): boolean {
  const f = state.friends[fr]
  if (!f?.ownRemoved) return false
  const held = friendSecret(cfg.rules, state, f)
  if (!held) return false
  if (cfg.rules.renewByKnowledge) return !held.knew.includes('rmF')
  return !(held.by === fr && held.at > f.ownRemovedAt)
}

/** A friend's device takes a letter with proposals for the friendship it is in. */
export function friendTakes(cfg: DataConfig, state: DataState, letter: Letter, fr: FriendId): void {
  const friend = state.friends[fr]
  if (!friend) return
  if (letter.log.includes('rmX')) friend.knowsR = true
  // A letter from a device it knows you removed counts for nothing.
  if (letter.from === REMOVED && friend.knowsR) return
  const before = friendSecret(cfg.rules, state, friend)?.id
  const props = Object.values(letter.props)
    .flat()
    .filter((p) => p.inc === friend.inc)
  friend.learned = uniq([...friend.learned, ...props.map((p) => p.id)])
  friend.props = [...friend.props, ...props.filter((p) => !friend.props.some((h) => h.id === p.id))]
  const after = friendSecret(cfg.rules, state, friend)?.id
  if (cfg.rules.friendForwards && after !== before) friendSend(cfg, state, fr)
}
