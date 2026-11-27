// The model of a pair made before pair secrets moving to one, when your side has the lower id and
// two devices (A and B) and the friend has one (h). Each of your devices that meets the friend in
// the old room, named from both ids, makes a secret if it has none and sends `pair-secret`; the
// friend keeps the first it takes, moves, and answers `pair-secret-ok` to everyone in the room.
//
// - With an answer that doesn't say which secret it confirms, every device of yours that hears
//   it moves to its own, and one ends on a secret the friend doesn't hold.
// - With the answer naming the secret, a device whose own wasn't taken stays put. It can't learn
//   the secret from the old room, which anyone who knows both ids can enter, so it takes it from
//   your other device, sealed in your shared log, which is where device sync comes in.
import { canon, copy } from './canon.ts'
import type { Invariant, Model } from './explore.ts'

type Mine = 'A' | 'B'

interface Side {
  secret?: string
  moved: boolean
}

export interface LegacyState {
  mine: Record<Mine, Side & { dirty: boolean }>
  friend: Side
  /** Friend records your devices have sent each other and not yet taken. */
  mail: { from: Mine; to: Mine; record: Side }[]
}

export interface LegacyRules {
  /** `pair-secret-ok` names the secret it confirms, and only its sender moves. */
  readonly namedOk: boolean
  /** A device that hasn't moved takes the secret another device of yours moved to. */
  readonly takeFromSibling: boolean
}

export const LEGACY_DESIGN: LegacyRules = { namedOk: true, takeFromSibling: true }

const other = (d: Mine): Mine => (d === 'A' ? 'B' : 'A')

/** Some of your devices meet the friend in the old room; `first` is whose secret it takes. */
function meetOld(rules: LegacyRules, s: LegacyState, present: Mine[], first: Mine): void {
  if (s.friend.moved) return
  for (const d of present) s.mine[d].secret ??= `s${d}`
  s.friend.secret = s.mine[first].secret ?? `s${first}`
  s.friend.moved = true
  for (const d of present) {
    const mine = s.mine[d]
    if (mine.moved) continue
    if (!rules.namedOk || mine.secret === s.friend.secret) {
      mine.moved = true
      mine.dirty = true
    }
  }
}

function check(rules: LegacyRules, s: LegacyState, d: Mine): void {
  const mine = s.mine[d]
  for (const letter of s.mail.filter((l) => l.to === d)) {
    const theirs = letter.record
    if (rules.takeFromSibling && !mine.moved && theirs.moved && theirs.secret) {
      mine.secret = theirs.secret
      mine.moved = true
      mine.dirty = true
    }
  }
  s.mail = s.mail.filter((l) => l.to !== d)
  if (mine.dirty) {
    mine.dirty = false
    s.mail.push({
      from: d,
      to: other(d),
      record: { ...(mine.secret ? { secret: mine.secret } : {}), moved: mine.moved },
    })
  }
}

function steps(rules: LegacyRules, s: LegacyState): (readonly [string, LegacyState])[] {
  const out: (readonly [string, LegacyState])[] = []
  const meets: [string, Mine[], Mine][] = [
    ['A meets the friend in the old room', ['A'], 'A'],
    ['B meets the friend in the old room', ['B'], 'B'],
    ['A and B meet the friend in the old room; A is heard first', ['A', 'B'], 'A'],
    ['A and B meet the friend in the old room; B is heard first', ['A', 'B'], 'B'],
  ]
  for (const [label, present, first] of meets) {
    if (s.friend.moved || present.some((d) => s.mine[d].moved)) continue
    const next = copy(s)
    meetOld(rules, next, present, first)
    out.push([label, next])
  }
  for (const d of ['A', 'B'] as const) {
    const next = copy(s)
    check(rules, next, d)
    if (canon(next) !== canon(s)) out.push([`${d} checks mail`, next])
  }
  return out
}

function settle(rules: LegacyRules, state: LegacyState): LegacyState {
  const s = copy(state)
  for (let i = 0; i < 10; i++) {
    const before = canon(s)
    check(rules, s, 'A')
    check(rules, s, 'B')
    if (canon(s) === before) break
  }
  return s
}

const oneSecret: Invariant<LegacyState> = {
  id: 'P3 one pair secret per friend',
  check: (s) => {
    if (!s.friend.moved) return undefined
    const wrong = (['A', 'B'] as const).filter(
      (d) => !s.mine[d].moved || s.mine[d].secret !== s.friend.secret,
    )
    return wrong.length
      ? `the friend is on ${s.friend.secret}; ${wrong.map((d) => `${d} on ${s.mine[d].secret ?? 'nothing'}${s.mine[d].moved ? '' : ', not moved'}`).join('; ')}`
      : undefined
  },
}

export function legacyModel(name: string, rules: LegacyRules): Model<LegacyState> {
  return {
    name,
    init: {
      mine: { A: { moved: false, dirty: false }, B: { moved: false, dirty: false } },
      friend: { moved: false },
      mail: [],
    },
    steps: (s) => steps(rules, s),
    safety: [],
    settle: (s) => settle(rules, s),
    settled: [oneSecret],
    flags: (s) => [
      ...(s.friend.moved ? ['friend moved'] : []),
      ...(s.mine.A.secret && s.mine.B.secret && s.mine.A.secret !== s.mine.B.secret
        ? ['two secrets made']
        : []),
    ],
  }
}

export const LEGACY_CASES: readonly { name: string; rules: LegacyRules; caughtBy?: string }[] = [
  { name: 'moving to pair secrets with two devices', rules: LEGACY_DESIGN },
  {
    name: 'moving to pair secrets [defect: an ok that names no secret, as today]',
    rules: { ...LEGACY_DESIGN, namedOk: false },
    caughtBy: 'P3 one pair secret per friend',
  },
  {
    name: 'moving to pair secrets [defect: a named ok, but no device sync]',
    rules: { ...LEGACY_DESIGN, takeFromSibling: false },
    caughtBy: 'P3 one pair secret per friend',
  },
]
