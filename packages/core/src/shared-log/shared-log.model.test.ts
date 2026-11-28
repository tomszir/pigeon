// The model-based test of the shared log: the real entries, merge, summaries, fold and sync rules,
// driven through the scenarios of the your-data model in verification/models/device-sync/ and
// checked against its invariants (verification/specs/device-sync.md): C1 to C4, W1, T1, T2, T4,
// R1, R2, R4 and S0, as they apply to your data. Pair secrets aren't part of the shared log, so
// the model's pair-secret steps and invariants aren't here.
//
// Each scenario is walked at random from a fixed seed, many times, through every step it allows:
// people's changes on any device, mail checks in any order, letters lost and put again, devices
// meeting in the self room, the writer removing a device and linking one, clocks running ahead,
// and a removed device forging entries, signing two under one number and sending them. After every
// step the safety invariants are checked, and a copy is settled (every device checks mail until
// nothing changes) and checked against the invariants that hold once mail settles.
import { describe, expect, it } from 'vitest'
import {
  flags,
  random,
  safety,
  settled,
  tombsHold,
  type Violation,
} from './testing/model-checks.ts'
import { apply, steps } from './testing/model-steps.ts'
import {
  initialWorld,
  type Scenario,
  type Step,
  settle,
  type World,
} from './testing/model-world.ts'

/** The scenarios, as the model names them, with what each must reach in some walk. */
const SCENARIOS: readonly (Scenario & { readonly reach: readonly string[] })[] = [
  {
    name: 'friends',
    devices: ['A', 'B', 'C'],
    hostile: false,
    budgets: { add: 1, unfriend: 1, pet: 2, lose: 1 },
    who: { add: ['B'], unfriend: ['A'], pet: ['B', 'C'] },
    targets: ['G'],
    reach: ['G live on A', 'G live on C', 'unfriended', 'letter lost'],
  },
  {
    name: 'repair',
    devices: ['A', 'B', 'C'],
    hostile: false,
    budgets: { unfriend: 1, add: 1, pet: 1, lose: 1 },
    who: { unfriend: ['A'], add: ['A'], pet: ['B'] },
    targets: ['F'],
    adds: ['F'],
    reach: ['unfriended', 'letter lost'],
  },
  {
    name: 'blocks',
    devices: ['A', 'B', 'C'],
    hostile: false,
    budgets: { block: 1, unblock: 1, pet: 1, lose: 1 },
    who: { block: ['A'], unblock: ['B'], pet: ['C'] },
    targets: ['F'],
    reach: ['blocked', 'letter lost'],
  },
  {
    name: 'settings',
    devices: ['A', 'B', 'C'],
    hostile: false,
    budgets: { relay: 2, pet: 2, mute: 2 },
    who: { relay: ['A', 'B'], pet: ['A', 'C'], mute: ['B', 'C'] },
    targets: ['F'],
    reach: ['relay on', 'petname set', 'muted'],
  },
  {
    name: 'skew',
    devices: ['A', 'B', 'C'],
    hostile: false,
    budgets: { skew: 1, unfriend: 1, pet: 2 },
    who: { skew: ['C'], unfriend: ['C'], pet: ['A', 'C'] },
    targets: ['F'],
    reach: ['a clock ran ahead', 'unfriended', 'petname set'],
  },
  {
    name: 'removal',
    devices: ['A', 'B', 'X'],
    hostile: true,
    budgets: { remove: 1, stranger: 1, gap: 1, proto: 1 },
    forges: [{ op: 'unfriendF', stamp: 'current' }],
    reach: [
      'removed',
      'every device knew of the removal',
      'forged entry taken',
      'an entry past a gap held',
      'an entry of a kind named like an object property held',
    ],
  },
  {
    name: 'room',
    devices: ['A', 'B', 'X'],
    hostile: true,
    budgets: { remove: 1, fork: 1, meet: 2, gap: 1, proto: 1 },
    forges: [{ op: 'renameF', stamp: 'early' }],
    reach: [
      'forged entry taken',
      'devices hold different entries under one number',
      'every device knew of the removal',
    ],
  },
  {
    name: 'race',
    devices: ['A', 'B'],
    hostile: false,
    budgets: { unfriend: 1, add: 2 },
    who: { unfriend: ['A'], add: ['A', 'B'] },
    targets: ['F'],
    adds: ['F'],
    reach: ['F paired twice at once', 'unfriended'],
  },
  {
    name: 'skewremoval',
    devices: ['A', 'B', 'X'],
    hostile: false,
    budgets: { skew: 1, pet: 1, unfriend: 1, remove: 1 },
    who: { skew: ['X'], pet: ['X'], unfriend: ['X'] },
    targets: ['F'],
    reach: ['a clock ran ahead', 'removed', 'unfriended', 'petname set'],
  },
  {
    name: 'link',
    devices: ['A', 'B', 'X'],
    hostile: true,
    budgets: { remove: 1, link: 1, pet: 1, lose: 1 },
    who: { pet: ['B'] },
    targets: ['F'],
    reach: ['C linked', 'letter lost', 'removed'],
  },
  {
    // A removed device stamps a rename just under the cap, and another above it: once its removal
    // is heard, neither raises anyone's stamps, and the one above the cap is kept and counted,
    // never sent again.
    name: 'capped',
    devices: ['A', 'B', 'X'],
    hostile: true,
    budgets: { remove: 1, pet: 2 },
    who: { pet: ['A', 'B'] },
    targets: ['F'],
    forges: [
      { op: 'renameF', stamp: 'cap' },
      { op: 'renameF', stamp: 'over' },
    ],
    reach: ['every device knew of the removal', 'an entry above the cap held', 'petname set'],
  },
  {
    // A device that only reads while another changes things in bursts larger than one letter:
    // every page must reach it, and the newest change with the last.
    name: 'passive',
    devices: ['A', 'B'],
    hostile: false,
    budgets: { burst: 2, pet: 2, lose: 1 },
    who: { burst: ['A'], pet: ['A'] },
    targets: ['F'],
    reach: ['more entries than one letter holds', 'petname set', 'letter lost'],
  },
  {
    name: 'newer',
    devices: ['A', 'B'],
    hostile: false,
    budgets: { future: 1, pet: 1, add: 1 },
    who: { future: ['B'], add: ['B'], pet: ['A'] },
    reach: ['unreadable entry held', 'G live on A'],
  },
]

/** Walks per scenario, and their longest. */
const WALKS = 60
const WALK_LENGTH = 24

interface Found {
  readonly violation: Violation
  readonly path: readonly string[]
}

/** One walk: random steps from the start, every invariant checked along the way. */
async function walk(
  s: Scenario,
  next: () => number,
  reached: Set<string>,
): Promise<Found | undefined> {
  let world: World = await initialWorld(s)
  const path: string[] = []
  for (let i = 0; i < WALK_LENGTH; i++) {
    const options: Step[] = steps(world, s)
    if (options.length === 0) break
    const chosen = options[Math.floor(next() * options.length)]
    if (chosen === undefined) break
    const after = await apply(world, s, chosen)
    path.push(chosen[0])
    const broken = [...safety(after, s), ...tombsHold(world, chosen[0], after, s)]
    const calm = await settle(after, s)
    broken.push(...settled(calm, s))
    for (const flag of flags(calm, s)) reached.add(flag)
    for (const flag of flags(after, s)) reached.add(flag)
    const [first] = broken
    if (first !== undefined) return { violation: first, path: [...path, 'settle'] }
    world = after
  }
  return undefined
}

describe('the shared log against the your-data model', () => {
  for (const s of SCENARIOS)
    it(`${s.name}: every invariant holds`, async () => {
      const next = random(138)
      const reached = new Set<string>()
      for (let i = 0; i < WALKS; i++) {
        const found = await walk(s, next, reached)
        if (found !== undefined)
          expect.fail(
            `${found.violation.id}: ${found.violation.message} after ${found.path.join(' > ')}`,
          )
      }
      for (const flag of s.reach) expect([...reached], `never reached ${flag}`).toContain(flag)
    }, 60_000)
})
