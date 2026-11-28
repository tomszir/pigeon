// The your-data model put together: how it settles, and its scenarios.
import { canon, copy } from './canon.ts'
import { dataChecks, dataFlags } from './data-checks.ts'
import { friendRenew, friendToRenew } from './data-friend.ts'
import { finish, sweep } from './data-run.ts'
import {
  type DataConfig,
  type DataState,
  DESIGN,
  honest,
  initialState,
  REMOVED,
} from './data-state.ts'
import { check, rekey, steps } from './data-steps.ts'
import type { Model } from './explore.ts'

/**
 * Settles: every honest device puts what waits in its outbox and puts again what was lost, the
 * writer replaces secrets it owes, each device sends what its others may lack, and every letter
 * reaches whoever can still take it, round after round until nothing changes. A hostile removed
 * device does nothing more, but reads what reaches it.
 */
export function settle(cfg: DataConfig, state: DataState): DataState {
  const s = copy(state)
  for (let round = 0; ; round++) {
    // Settling must reach a fixed point: running out of rounds is a failure (S0), never a stop.
    if (round === SETTLE_ROUNDS) {
      s.unsettled = true
      break
    }
    const before = canon(s)
    rekey(cfg, s)
    delete s.friendHold
    if (friendToRenew(cfg, s, 'F')) friendRenew(cfg, s, 'F')
    for (const d of honest(s, cfg)) check(cfg, s, d)
    for (const r of ['F', 'G', ...(cfg.hostile ? [REMOVED] : [])]) check(cfg, s, r)
    const alive = new Set<string>([...honest(s, cfg), 'F', 'G', ...(cfg.hostile ? [REMOVED] : [])])
    for (const l of s.mail) l.pending = l.pending.filter((p) => alive.has(p))
    sweep(s)
    finish(cfg, s)
    if (canon(s) === before) break
  }
  return s
}

/** More rounds than any settling the design allows needs; reaching it means it never ends. */
export const SETTLE_ROUNDS = 40

export function dataModel(cfg: DataConfig): Model<DataState> {
  const checks = dataChecks(cfg)
  return {
    name: cfg.name,
    init: finish(cfg, initialState(cfg)),
    steps: (s) => steps(cfg, s),
    safety: checks.safety,
    stepChecks: checks.stepChecks,
    settle: (s) => settle(cfg, s),
    settled: checks.settled,
    flags: (s) => dataFlags(cfg, s),
  }
}

const config = (
  name: string,
  devices: DataConfig['devices'],
  hostile: boolean,
  budgets: DataConfig['budgets'],
  more: Omit<Partial<DataConfig>, 'name' | 'devices' | 'hostile' | 'budgets' | 'rules'> = {},
): DataConfig => ({ name, devices, hostile, budgets, ...more, rules: DESIGN })

const unfriendF = { op: { k: 'tomb', fr: 'F', inc: 'F1' }, stamp: 'current' } as const
const renameF = { op: { k: 'pet', fr: 'F', v: 'px' }, stamp: 'early' } as const
const proposeF = { proposal: true } as const
const rootG = { root: 'G' } as const

/** The scenarios, each small enough to explore every history of. */
export const SCENARIOS: Readonly<Record<string, DataConfig>> = {
  // The maintainer's report: a friend added on the phone (B) must reach the desktop (A) and a
  // third device (C) that may be away, then be renamed on one and unfriended on another, with a
  // letter lost on the way.
  friends: config(
    'friends: added on one device, renamed and unfriended on others',
    ['A', 'B', 'C'],
    false,
    { add: 1, unfriend: 1, pet: 2, lose: 1 },
    { who: { add: ['B'], unfriend: ['A'], pet: ['B', 'C'] }, targets: ['G'] },
  ),
  // A friend unfriended and paired with again on one device, while the others are away: every
  // device must end on the new friendship's secret, never the dead one's.
  repair: config(
    'repair: unfriended and paired with again',
    ['A', 'B', 'C'],
    false,
    { unfriend: 1, add: 1, pet: 1, lose: 1 },
    { who: { unfriend: ['A'], add: ['A'], pet: ['B'] }, targets: ['F'], adds: ['F'] },
  ),
  // Blocking and unblocking on two devices while the third is away and comes back.
  blocks: config(
    'blocks: blocked on one device, unblocked on another',
    ['A', 'B', 'C'],
    false,
    { block: 1, unblock: 1, pet: 1, lose: 1 },
    { who: { block: ['A'], unblock: ['B'], pet: ['C'] }, targets: ['F'] },
  ),
  // Settings and a petname changed on devices while another is away and comes back with a change
  // of its own, made on an old clock.
  settings: config(
    'settings: changed on devices that were away',
    ['A', 'B', 'C'],
    false,
    { relay: 2, pet: 2 },
    { who: { relay: ['A', 'B'], pet: ['A', 'C'] }, targets: ['F'] },
  ),
  // A device whose clock runs a month ahead renames and then unfriends a friend; the others must
  // take both, and a later change made after seeing them must still win.
  skew: config(
    'skew: a device whose clock runs ahead',
    ['A', 'B', 'C'],
    false,
    { skew: 1, unfriend: 1, pet: 2 },
    { who: { skew: ['C'], unfriend: ['C'], pet: ['A', 'C'] }, targets: ['F'] },
  ),
  // A hostile device is removed: it proposes a pair secret of its own for F claiming a high round
  // and unfriends F at a current stamp, sends them to your devices and to F, and reads whatever is
  // sealed to it, while the writer replaces the secrets. (The early stamp is the room scenario's.)
  removal: config(
    'removal: a hostile removed device',
    ['A', 'B', 'X'],
    true,
    { remove: 1 },
    { forges: [proposeF, unfriendF] },
  ),
  // B pairs with G while it still takes X for yours, so X reads G's first secret; then the
  // writer removes X, and must renew G's friendship too.
  window: config(
    'window: a friendship paired before the removal is heard',
    ['A', 'B', 'X'],
    true,
    { remove: 1, add: 1 },
    { who: { add: ['B'] } },
  ),
  // The removed device meets a device that hasn't heard yet in the self room, and signs two
  // entries with one number, one for the writer and one for the others; your devices swap
  // entries by summary.
  room: config(
    'room: a removed device in the self room',
    ['A', 'B', 'X'],
    true,
    { remove: 1, fork: 1, meet: 2 },
    { forges: [renameF] },
  ),
  // The writer pairs with G, and X reads G's first secret while still on the list; then X is
  // removed and forges a second first secret for G, stamped as early as it can, and sends it to B
  // before the writer's own reaches it.
  roots: config(
    'roots: a removed device forges a second first secret',
    ['A', 'B', 'X'],
    true,
    { add: 1, remove: 1 },
    { who: { add: ['A'] }, adds: ['G'], forges: [rootG] },
  ),
  // The friend proposes a replacement of its own around the removal, sealed to X while the friend
  // hasn't heard, and its proposal is earlier than the writer's renewal.
  friendround: config(
    'friendround: the friend replaces a secret in the window',
    ['A', 'B', 'X'],
    true,
    { remove: 1, friendRound: 1 },
  ),
  // Both sides remove a device of their own: the friend first, then the writer. Each side's
  // writer renews by the same rule, and settling must still end.
  mutual: config('mutual: both sides remove a device of their own', ['A', 'B', 'X'], false, {
    remove: 1,
    friendRemove: 1,
  }),
  // The friend has a second device. The first passes it your writer's renewed chain, and the
  // second sends it back to your devices, sealed to its own copy of your list.
  relay: config(
    'relay: the friend\u2019s second device passes the chain on',
    ['A', 'B', 'X'],
    true,
    {
      remove: 1,
      friendSync: 1,
      friendRelay: 1,
    },
  ),
  // X's clock runs ahead: it pairs with G, the writer takes its letter and removes it, so the
  // threshold is later than the removal's clock time, and G's first secret (by X) falls between.
  skewpair: config(
    'skewpair: a fast-clocked device pairs, then is removed',
    ['A', 'B', 'X'],
    false,
    { skew: 1, add: 1, remove: 1 },
    { who: { skew: ['X'], add: ['X'] }, adds: ['G'] },
  ),
  // X, still on the list, has an entry stamped far ahead reach the writer, raising the threshold;
  // the writer removes it; B, whose clock runs ahead, pairs with G in the window; X forges a first
  // secret for G stamped at the removal's time, earlier than B's, and mails it to G and the writer.
  hostilepair: config(
    'hostilepair: a removed device raises the threshold and forges a first secret',
    ['A', 'B', 'X'],
    true,
    { remove: 1, add: 1, skew: 1 },
    {
      who: { add: ['B'], skew: ['B'] },
      adds: ['G'],
      xMails: ['A'],
      forges: [
        { op: { k: 'pet', fr: 'F', v: 'px' }, stamp: 'ahead' },
        { root: 'G', at: 'removal' },
      ],
    },
  ),
  // A Lighthouse holds the friend's mail while X mails G forged first secrets, each earlier than
  // the last; each one G takes before it hears costs the writer a renewal (S1's rivals).
  held: config(
    'held: the friend\u2019s mail held while forgeries reach it',
    ['A', 'B', 'X'],
    true,
    { add: 1, remove: 1, hold: 1 },
    { who: { add: ['A'] }, adds: ['G'], xMails: [], forges: [{ root: 'G' }] },
  ),
  // X signs an entry under a number one past its next, leaving a gap nobody can fill, and sends
  // it to the writer; your devices swap summaries until settling.
  gap: config(
    'gap: a removed device skips a number',
    ['A', 'B', 'X'],
    true,
    { remove: 1 },
    { xMails: ['A'], forges: [{ op: { k: 'pet', fr: 'F', v: 'px' }, stamp: 'early', skip: true }] },
  ),
  // X signs two entries, skipping the number before the first, and sends each device only its
  // latest: one device can end up holding an entry the other, further along, lacks.
  gaps: config(
    'gaps: a skipped number, and entries one device holds and another lacks',
    ['A', 'B', 'X'],
    true,
    {},
    {
      xSendsLatest: true,
      forges: [
        { op: { k: 'pet', fr: 'F', v: 'px' }, stamp: 'early', skip: true },
        { op: { k: 'relay', v: true }, stamp: 'early' },
      ],
    },
  ),
  // X, still on the list, sends A an entry stamped at the device log's ceiling; A removes X, and B
  // pairs with G.
  overcap: config(
    'overcap: a device on the list stamps at the device log\u2019s ceiling',
    ['A', 'B', 'X'],
    true,
    { remove: 1, add: 1 },
    {
      who: { add: ['B'] },
      adds: ['G'],
      xMails: ['A'],
      forges: [{ op: { k: 'pet', fr: 'F', v: 'px' }, stamp: 'over' }],
    },
  ),
  // X, still on the list, signs twice the per-author cap's worth of entries and sends the writer
  // those numbered up to the cap and B those above it.
  flood: config(
    'flood: a device on the list floods past the per-author cap',
    ['A', 'B', 'X'],
    true,
    { pet: 1 },
    { who: { pet: ['B'] }, targets: ['F'], xSplits: true, forges: [{ flood: true }] },
  ),
  // Once removed, X sends B an entry stamped one below the cap. B takes it before it hears; then,
  // having heard, B renames F, and A renames F after seeing B's change.
  capped: config(
    'capped: a removed device stamps at the cap',
    ['A', 'B', 'X'],
    true,
    { remove: 1, pet: 2 },
    {
      who: { pet: ['A', 'B'] },
      targets: ['F'],
      petAfterRemoval: true,
      xMails: ['B'],
      forges: [{ op: { k: 'pet', fr: 'F', v: 'px' }, stamp: 'cap' }],
    },
  ),
  // X, still on the list, signs entries whose kind names an object already has, and sends them.
  kinds: config(
    'kinds: entries with kind names an object already has',
    ['A', 'B', 'X'],
    true,
    { pet: 1 },
    {
      who: { pet: ['A'] },
      targets: ['F'],
      xMails: ['A'],
      forges: [
        { op: { k: 'future', name: '__proto__' }, stamp: 'current' },
        { op: { k: 'future', name: 'constructor' }, stamp: 'current' },
      ],
    },
  ),
  // Two devices pair again with one friend at once, after an unfriend.
  race: config(
    'race: two devices pair again with one friend at once',
    ['A', 'B'],
    false,
    { unfriend: 1, add: 2 },
    { who: { unfriend: ['A'], add: ['A', 'B'] }, targets: ['F'], adds: ['F'] },
  ),
  // An honest device whose clock runs ahead renames and unfriends, then is removed: what the
  // writer held from it must keep counting.
  skewremoval: config(
    'skewremoval: a device with a fast clock removed after its changes',
    ['A', 'B', 'X'],
    false,
    { skew: 1, pet: 1, unfriend: 1, remove: 1 },
    { who: { skew: ['X'], pet: ['X'], unfriend: ['X'] }, targets: ['F'] },
  ),
  // A device is linked after a removal, and a letter sealed before it is lost and put again.
  link: config(
    'link: a device linked after a removal',
    ['A', 'B', 'X'],
    true,
    { remove: 1, link: 1, pet: 1, lose: 1 },
    { who: { pet: ['B'] }, targets: ['F'] },
  ),
  // Tabs close between deciding to send and putting: after a replacement, and after a change.
  outbox: config('outbox: a tab closed before the put', ['A', 'B', 'X'], false, {
    remove: 1,
    pet: 1,
    crash: 2,
  }),
  // A newer Pigeon writes an entry this one can't read, among ones it can.
  newer: config(
    'newer: an entry only a newer Pigeon reads',
    ['A', 'B'],
    false,
    { future: 1, pet: 1, add: 1 },
    { who: { future: ['B'], add: ['B'], pet: ['A'] } },
  ),
}
