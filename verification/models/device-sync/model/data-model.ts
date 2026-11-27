// The your-data model put together: how it settles, its scenarios, and its planted defects.
import { canon, copy } from './canon.ts'
import { dataChecks, dataFlags } from './data-checks.ts'
import {
  type DataConfig,
  type DataRules,
  type DataState,
  DESIGN,
  honest,
  initialState,
  REMOVED,
} from './data-state.ts'
import { check, finish, rekey, steps, sweep } from './data-steps.ts'
import type { Model } from './explore.ts'

/**
 * Settles: every honest device puts what waits in its outbox and puts again what was lost, the
 * writer replaces secrets it owes, each device sends what its others may lack, and every letter
 * reaches whoever can still take it, round after round until nothing changes. A hostile removed
 * device does nothing more, but reads what reaches it.
 */
export function settle(cfg: DataConfig, state: DataState): DataState {
  const s = copy(state)
  for (let round = 0; round < 40; round++) {
    const before = canon(s)
    rekey(cfg, s)
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
  who: DataConfig['who'] = {},
  targets?: DataConfig['targets'],
  forges?: DataConfig['forges'],
): DataConfig => ({
  name,
  devices,
  hostile,
  budgets,
  who,
  ...(targets ? { targets } : {}),
  ...(forges ? { forges } : {}),
  rules: DESIGN,
})

const unfriendF = { op: { k: 'tomb', fr: 'F', inc: 'F1' }, stamp: 'current' } as const
const renameF = { op: { k: 'pet', fr: 'F', v: 'px' }, stamp: 'early' } as const

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
    { add: ['B'], unfriend: ['A'], pet: ['B', 'C'] },
    ['G'],
  ),
  // Blocking and unblocking on two devices while the third is away and comes back.
  blocks: config(
    'blocks: blocked on one device, unblocked on another',
    ['A', 'B', 'C'],
    false,
    { block: 1, unblock: 1, pet: 1, lose: 1 },
    { block: ['A'], unblock: ['B'], pet: ['C'] },
    ['F'],
  ),
  // Settings and a petname changed on devices while another is away and comes back with a change
  // of its own, made on an old clock.
  settings: config(
    'settings: changed on devices that were away',
    ['A', 'B', 'C'],
    false,
    { relay: 2, pet: 2 },
    { relay: ['A', 'B'], pet: ['A', 'C'] },
    ['F'],
  ),
  // A hostile device is removed: it unfriends F at a current stamp and renames F at an early one,
  // sends them, and reads whatever is sealed to it, while the writer replaces the secrets and B
  // adds a friend.
  removal: config(
    'removal: a hostile removed device',
    ['A', 'B', 'X'],
    true,
    { remove: 1, add: 1 },
    { add: ['B'] },
    undefined,
    [unfriendF, renameF],
  ),
  // The removed device meets a device that hasn't heard yet in the self room, and signs two
  // entries with one number.
  room: config(
    'room: a removed device in the self room',
    ['A', 'B', 'X'],
    true,
    { remove: 1, fork: 1, meet: 2 },
    {},
    undefined,
    [renameF],
  ),
  // A device is linked after a removal, and a letter sealed before it is lost and put again.
  link: config(
    'link: a device linked after a removal',
    ['A', 'B', 'X'],
    true,
    { remove: 1, link: 1, pet: 1, lose: 1 },
    { pet: ['B'] },
    ['F'],
  ),
  // The writer's tab closes between replacing a secret and putting the letters that say so.
  outbox: config('outbox: a tab closed before the put', ['A', 'B', 'X'], false, {
    remove: 1,
    crash: 1,
  }),
  // A newer Pigeon writes an entry this one can't read, among ones it can.
  newer: config(
    'newer: an entry only a newer Pigeon reads',
    ['A', 'B'],
    false,
    { future: 1, pet: 1, add: 1 },
    { future: ['B'], add: ['B'], pet: ['A'] },
  ),
}

export interface Defect {
  readonly name: string
  readonly what: string
  readonly scenario: string
  readonly rule: keyof DataRules
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
    name: 'last writer by arrival',
    what: 'a register takes whatever arrived last, so a device back from days away wins',
    scenario: 'settings',
    rule: 'stampOrder',
    caughtBy: 'W1 the newest change wins',
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
    what: 'a letter carrying a new pair secret doesn’t carry the device log that removed X',
    scenario: 'removal',
    rule: 'logFirst',
    caughtBy: 'P4 secret holders know the removal',
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
    name: 'same sealed letter put again',
    what: 'a lost letter is put again as first sealed: to a device removed since, not to one linked since',
    scenario: 'link',
    rule: 'resealOnReput',
    caughtBy: 'P1 sealed to the list',
  },
  {
    name: 'replacement outside the outbox',
    what: 'a new pair secret is sent without the outbox, and a closed tab loses it',
    scenario: 'outbox',
    rule: 'outbox',
    caughtBy: 'P3 one pair secret per friend',
  },
  {
    name: 'one unreadable entry refuses the letter',
    what: 'a letter holding an entry this Pigeon can’t read is refused whole',
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
    rules: { ...base.rules, [defect.rule]: false },
  }
}
