// The your-data model put together: how it settles, its scenarios, and its planted defects.
import { canon, copy } from './canon.ts'
import { dataChecks, dataFlags } from './data-checks.ts'
import { friendPropose, friendToRenew } from './data-friend.ts'
import { finish, sweep } from './data-run.ts'
import {
  type DataConfig,
  type DataRules,
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
    if (friendToRenew(cfg, s, 'F')) {
      const inc = s.friends.F?.inc ?? ''
      s.renewals[`F:${inc}`] = (s.renewals[`F:${inc}`] ?? 0) + 1
      friendPropose(cfg, s, 'F')
    }
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

export interface Defect {
  readonly name: string
  readonly what: string
  readonly scenario: string
  readonly rule: keyof DataRules
  /** A second rule turned off with it, where another rule would otherwise cover for this one. */
  readonly also?: keyof DataRules
  /** The invariant that must catch it. */
  readonly caughtBy: string
}

/** Planted defects: each turns one rule off, and names the invariant that must catch it. */
export const DEFECTS: readonly Defect[] = [
  {
    name: 'missing tombstone',
    what: 'unfriending drops the friend on that device only, leaving no tombstone',
    scenario: 'friends',
    rule: 'tombstones',
    caughtBy: 'T1 an ended friendship stays ended',
  },
  {
    name: 'secret per friend, not per friendship',
    what: 'pair-secret state is kept per friend, so pairing again leaves other devices on the dead secret',
    scenario: 'repair',
    rule: 'secretPerIncarnation',
    caughtBy: 'P3 one pair secret per friend',
  },
  {
    name: 'last writer by arrival',
    what: 'a register takes whatever arrived last, so a device back from days away wins',
    scenario: 'settings',
    rule: 'stampOrder',
    caughtBy: 'W1 the newest change wins',
  },
  {
    name: 'stamps refused when ahead',
    what: 'an entry stamped further ahead than the receiving clock allows is refused',
    scenario: 'skew',
    rule: 'acceptAhead',
    caughtBy: 'C1 devices on the list converge',
  },
  {
    name: 'sealed to every device ever known',
    what: 'letters, pair secrets in them included, are sealed to removed devices too',
    scenario: 'removal',
    rule: 'sealToList',
    caughtBy: 'P2 no new secret to a removed device',
  },
  {
    name: 'secret without the log',
    what: 'a letter carrying a new pair secret doesn\u2019t carry the device log that removed X',
    scenario: 'removal',
    rule: 'logFirst',
    caughtBy: 'P4 secret holders know the removal',
  },
  {
    name: 'secret by the highest round',
    what: 'a device takes whichever proposal claims the highest round, counted or not',
    scenario: 'removal',
    rule: 'chainRules',
    caughtBy: 'P6 a removed device\u2019s proposal never wins once heard',
  },
  {
    name: 'secret state dropped at a tombstone',
    what: 'a tombstone drops its friendship\u2019s secret state, lost for good if the tombstone stops counting (with the removal stamped by the writer\u2019s clock alone, so it can)',
    scenario: 'removal',
    rule: 'keepEndedSecrets',
    also: 'removalAfterHeld',
    caughtBy: 'P3 one pair secret per friend',
  },
  {
    name: 'the friend not told',
    what: 'a device whose secret changes through your devices doesn\u2019t send it to the friend',
    scenario: 'removal',
    rule: 'tellFriend',
    caughtBy: 'P3 one pair secret per friend',
  },
  {
    name: 'any first secret counts, the first held kept',
    what: 'a removed device\u2019s second first secret, taken before the writer\u2019s own, is kept for good',
    scenario: 'roots',
    rule: 'rootRules',
    caughtBy: 'P5 no friendship on a removed device\u2019s secret',
  },
  {
    name: 'only friendships live at the removal renewed',
    what: 'a friendship paired in the window before every device heard keeps a secret the removed device read',
    scenario: 'window',
    rule: 'renewLearned',
    caughtBy: 'P2b no friendship on a secret a removed device read',
  },
  {
    name: 'the friend\u2019s earlier proposal kept',
    what: 'the friend\u2019s proposal made in the window beats the writer\u2019s renewal, and nothing renews from it',
    scenario: 'friendround',
    rule: 'renewRivals',
    caughtBy: 'P2b no friendship on a secret a removed device read',
  },
  {
    name: 'renewal by time, never ending',
    what: 'each writer renews unless it proposed the secret after its removal, by time; both sides do',
    scenario: 'mutual',
    rule: 'renewByKnowledge',
    caughtBy: 'S0 settling ends',
  },
  {
    name: 'renewal by time, with a fast clock',
    what: 'the writer renews until its own clock passes the removal\u2019s stamp, once per check',
    scenario: 'skewremoval',
    rule: 'renewByKnowledge',
    caughtBy: 'S1 renewals are bounded',
  },
  {
    name: 'the friend not forwarding',
    what: 'a friend whose secret changes keeps it to itself, so a removed device mailing it splits the friendship',
    scenario: 'roots',
    rule: 'friendForwards',
    caughtBy: 'P3 one pair secret per friend',
  },
  {
    name: 'a relay without the other side\u2019s log',
    what: 'the friend\u2019s devices pass a chain between themselves without your log, so a stale copy of your list seals it to X',
    scenario: 'relay',
    rule: 'relayCarriesLogs',
    caughtBy: 'P2 no new secret to a removed device',
  },
  {
    name: 'the friend taking a removed device\u2019s letters',
    what: 'a friend that knows of the removal still takes a forged first secret from the removed device',
    scenario: 'roots',
    rule: 'friendRefuses',
    caughtBy: 'R5 a friend takes nothing from a removed device once it knows',
  },
  {
    name: 'the friend counting a removed device\u2019s replacement',
    what: 'a friend that knows of the removal still counts the removed device\u2019s proposal',
    scenario: 'removal',
    rule: 'friendDiscounts',
    caughtBy: 'P5 no friendship on a removed device\u2019s secret',
  },
  {
    name: 'a removed device\u2019s first secret trusted by its marker',
    what: 'the writer renews a removed device\u2019s backdated first secret only if its marker lacks the removal, and the marker says it knew',
    scenario: 'roots',
    rule: 'renewRemovedOwn',
    caughtBy: 'P5 no friendship on a removed device\u2019s secret',
  },
  {
    name: 'two re-pairings left as they are',
    what: 'two friendships with one friend stay live, and devices end on the one the friend isn\u2019t in',
    scenario: 'race',
    rule: 'settleRepairs',
    caughtBy: 'P3 one pair secret per friend',
  },
  {
    name: 'removal stamped by the writer\u2019s clock alone',
    what: 'what a fast-clocked device delivered before its removal stops counting',
    scenario: 'skewremoval',
    rule: 'removalAfterHeld',
    caughtBy: 'W1 the newest change wins',
  },
  {
    name: 'removed device not discounted',
    what: 'entries a removed device stamped after its removal still count',
    scenario: 'removal',
    rule: 'discountRemoved',
    caughtBy: 'R2 removed device discounted from its removal',
  },
  {
    name: 'letters from a removed device taken',
    what: 'a letter counts whoever sent it',
    scenario: 'removal',
    rule: 'senderOnList',
    caughtBy: 'R1 nothing from a removed device once all know',
  },
  {
    name: 'summaries without a digest',
    what: 'a summary says only how far each author goes, so two entries under one number never cross',
    scenario: 'room',
    rule: 'forkDigest',
    caughtBy: 'C1 devices on the list converge',
  },
  {
    name: 'same sealed letter put again',
    what: 'a lost letter is put again as first sealed: to a device removed since, not to one linked since',
    scenario: 'link',
    rule: 'resealOnReput',
    caughtBy: 'P1 sealed to the list',
  },
  {
    name: 'letters outside the outbox',
    what: 'a new pair secret or a change is sent without the outbox, and a closed tab loses it',
    scenario: 'outbox',
    rule: 'outbox',
    caughtBy: 'P3 one pair secret per friend',
  },
  {
    name: 'one unreadable entry refuses the letter',
    what: 'a letter holding an entry this Pigeon can\u2019t read is refused whole',
    scenario: 'newer',
    rule: 'perEntry',
    caughtBy: 'C1 devices on the list converge',
  },
]

export function withDefect(defect: Defect): DataConfig {
  const base = SCENARIOS[defect.scenario]
  if (!base) throw new Error(`no scenario ${defect.scenario}`)
  return {
    ...base,
    name: `${base.name} [defect: ${defect.name}]`,
    rules: {
      ...base.rules,
      [defect.rule]: false,
      ...(defect.also ? { [defect.also]: false } : {}),
    },
  }
}
