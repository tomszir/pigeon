// The waiting model's scenarios, invariants and planted defects. Each scenario runs on the Node
// and on the Worker Lighthouse; each defect turns off one rule and names the invariant that must
// catch it, in the scenario where it shows.
import type { Invariant, Model, StepInvariant } from './explore.ts'
import { isIdle, RULES, type Rules, type Variant, type WaitLimits } from './lighthouse.ts'
import {
  type Budget,
  CLIENT_RULES,
  type ClientRules,
  initial,
  type Setup,
  type Sys,
  settle,
  steps,
} from './system.ts'

/** The limits, scaled down: a minute is 60 ticks, a lease and the idle time a few. */
export const LIMITS: WaitLimits = {
  maxTags: 3,
  maxSeconds: 3,
  tagsPerRange: 4,
  tagsPer48: 6,
  maxWaitedTags: 8,
  readsPerMinute: 40,
  idleSeconds: 3,
  maxConnections: 4,
  connectionsPerRange: 4,
  pageSize: 2,
}

const NONE: Budget = {
  puts: 0,
  own: 0,
  ticks: 0,
  looks: 0,
  cues: 0,
  drops: 0,
  silences: 0,
  days: 0,
  sleeps: 0,
  crashes: 0,
  switches: 0,
  faults: 0,
  joins: 0,
  reopens: 0,
}

type ScenarioSetup = Omit<Setup, 'variant'> & { readonly variants?: readonly Variant[] }

export const SCENARIOS: Readonly<Record<string, ScenarioSetup>> = {
  cycle: {
    name: 'look, wait, a put, a cue, a drop and a reopen',
    limits: LIMITS,
    clients: { a: { range: 'r1' } },
    budget: { ...NONE, puts: 2, looks: 2, cues: 1, own: 1, drops: 1, reopens: 1, ticks: 3 },
  },
  sleep: {
    name: 'the Worker sleeps and resets between a put and its wakes',
    variants: ['worker'],
    limits: LIMITS,
    clients: { a: { range: 'r1' } },
    budget: { ...NONE, puts: 2, looks: 1, cues: 1, sleeps: 2, crashes: 1, ticks: 1 },
  },
  fault: {
    name: 'a Lighthouse whose gets fail',
    limits: LIMITS,
    clients: { a: { range: 'r1' } },
    budget: { ...NONE, puts: 1, looks: 2, cues: 4, faults: 1 },
  },
  reads: {
    name: 'waits and lists share a range’s reads',
    limits: { ...LIMITS, readsPerMinute: 3 },
    clients: { a: { range: 'r1' } },
    budget: { ...NONE, puts: 1, looks: 3, cues: 1 },
  },
  midnight: {
    name: 'the UTC day turns between a look and a wait sent again',
    limits: LIMITS,
    clients: { a: { range: 'r1' } },
    budget: { ...NONE, puts: 2, looks: 1, days: 2, drops: 1, reopens: 1 },
  },
  switch: {
    name: 'waiting turned off with a wait standing',
    limits: LIMITS,
    clients: { a: { range: 'r1' } },
    budget: { ...NONE, puts: 1, looks: 1, switches: 1, ticks: 1 },
  },
  room: {
    name: 'a full Lighthouse closes a waiter for a newcomer',
    limits: { ...LIMITS, maxConnections: 1 },
    clients: { a: { range: 'r1' }, b: { range: 'r2' } },
    latecomers: ['b'],
    budget: { ...NONE, joins: 1, looks: 2, reopens: 1, drops: 1 },
  },
  quiet: {
    name: 'a waiting connection that goes silent',
    // Idle before its lease ends, as 120 seconds are before 600.
    limits: { ...LIMITS, tagsPerRange: 1, idleSeconds: 2 },
    clients: { a: { range: 'r1' } },
    budget: { ...NONE, silences: 1, reopens: 1, looks: 2, ticks: 2 },
  },
  lull: {
    name: 'a quiet Worker leaves an ended lease unanswered',
    variants: ['worker'],
    limits: LIMITS,
    clients: { a: { range: 'r1' } },
    budget: { ...NONE, puts: 1, looks: 1, ticks: 6 },
  },
  shared: {
    name: 'three Pigeons behind one IPv4 address',
    limits: { ...LIMITS, tagsPerRange: 3, maxWaitedTags: 3 },
    clients: { a: { range: 'r1' }, b: { range: 'r1' }, c: { range: 'r1' } },
    budget: { ...NONE, looks: 3, puts: 1 },
  },
}

const LH_INVARIANTS = [
  'W1 one reply',
  'W2 never lost',
  'W3 at once',
  'W4 put alone',
  'W5 wait moves nothing',
  'W6 reveals nothing',
  'L1 one wait',
  'L2 shape',
  'L3 read',
  'L4 tag limits',
  'L5 no self or stale wake',
  'L7 refusal justified',
  'K1 keepalive',
  'E1 eviction',
  'O1 reply first',
] as const

const fromEvents: Invariant<Sys>[] = LH_INVARIANTS.map((id) => ({
  id,
  check: (s) => s.broken.find(([which]) => which === id)?.[1],
}))

const clientChecks = (limits: WaitLimits): Invariant<Sys>[] => [
  {
    id: 'C4 quiet',
    check: (s) => (s.cueRun > 2 ? `${s.cueRun} looks on cues with no new mail` : undefined),
  },
  {
    id: 'C5 off means off',
    check: (s) => {
      for (const [who, c] of Object.entries(s.clients)) {
        if (c.on) continue
        for (const [id, conn] of Object.entries(s.lh.conns))
          if (
            id.startsWith(who) &&
            /^\d+$/.test(id.slice(who.length)) &&
            conn.open &&
            conn.wait !== null &&
            !isIdle(conn, s.lh.now, limits)
          )
            return `${who} turned waiting off and ${id} still waits`
      }
      return undefined
    },
  },
  {
    id: 'C6 no churn',
    check: (s) =>
      s.reopenedEvicted ? 'a client closed for room reopened before its next look' : undefined,
  },
  {
    id: 'C8 waits until the next look',
    check: (s) => {
      for (const [who, c] of Object.entries(s.clients))
        if (c.on && c.waiting && c.conn !== null && !c.cue && c.waitReq === null)
          return `${who}'s wait ended before its next look, and nothing waits in its place`
      return undefined
    },
  },
  {
    id: 'C7 nothing new revealed',
    check: (s) =>
      s.strayTag !== null ? `a wait named ${s.strayTag}, which its look didn't list` : undefined,
  },
]

const noLostMail: Invariant<Sys> = {
  id: 'C1 no lost mail',
  check: (s) => {
    for (const entry of s.sent) {
      const [id = '', who = ''] = entry.split(' ')
      if (!s.waitingToJoin.includes(who) && !s.clients[who]?.taken.includes(id))
        return `${who} never took ${id}`
    }
    return undefined
  },
}

const cursorOnlyInLooks: StepInvariant<Sys> = {
  id: 'C2 a wait moves no cursor',
  check: (before, label, after) => {
    if (label.includes('looks')) return undefined
    for (const [who, c] of Object.entries(after.clients)) {
      const was = before.clients[who]
      if (was !== undefined && (was.cursor !== c.cursor || was.taken.join() !== c.taken.join()))
        return `${who}'s cursor or mail changed on "${label}"`
    }
    return undefined
  },
}

export interface Defect {
  readonly name: string
  readonly rules?: Partial<Rules>
  readonly client?: Partial<ClientRules>
  readonly scenario: string
  readonly variant: Variant
  readonly catches: string
}

export const DEFECTS: readonly Defect[] = [
  {
    name: 'a new wait leaves the old one unanswered',
    rules: { endsStandingWait: false },
    scenario: 'cycle',
    variant: 'node',
    catches: 'W1 one reply',
  },
  {
    name: 'no answer at once for mail already there',
    rules: { answersAtOnce: false },
    scenario: 'cycle',
    variant: 'node',
    catches: 'W3 at once',
  },
  {
    name: "a put wakes its own connection's wait",
    rules: { skipsOwnPut: false },
    scenario: 'cycle',
    variant: 'node',
    catches: 'L5 no self or stale wake',
  },
  {
    name: 'the Worker notices leases only by a timer it lacks',
    rules: { sweepsFirst: false, checksLease: false },
    scenario: 'cycle',
    variant: 'worker',
    catches: 'L5 no self or stale wake',
  },
  {
    name: 'waits not counted as reads',
    rules: { countsWaitAsRead: false },
    scenario: 'reads',
    variant: 'node',
    catches: 'L3 read',
  },
  {
    name: 'the index not rebuilt when the Worker wakes',
    rules: { rebuildsIndex: false },
    scenario: 'sleep',
    variant: 'worker',
    catches: 'W2 never lost',
  },
  {
    name: 'nothing woken again after a reset',
    rules: { rechecksAfterReset: false },
    scenario: 'sleep',
    variant: 'worker',
    catches: 'W2 never lost',
  },
  {
    name: 'a silent connection’s wait still counted',
    rules: { skipsDeadWaits: false },
    scenario: 'quiet',
    variant: 'worker',
    catches: 'L7 refusal justified',
  },
  {
    name: 'keepalives not counted as hearing from a connection',
    rules: { pingsKeepAlive: false },
    scenario: 'cycle',
    variant: 'node',
    catches: 'K1 keepalive',
  },
  {
    name: "wakes sent before the put's reply",
    rules: { replyBeforeWakes: false },
    scenario: 'cycle',
    variant: 'node',
    catches: 'O1 reply first',
  },
  {
    name: 'puts refused while waits fill the index',
    rules: { putIgnoresWaits: false },
    scenario: 'shared',
    variant: 'node',
    catches: 'W4 put alone',
  },
  {
    name: 'the answer names the tag',
    rules: { bareAnswer: false },
    scenario: 'cycle',
    variant: 'node',
    catches: 'W6 reveals nothing',
  },
  {
    name: 'no waiter closed for a newcomer',
    rules: { evictsWaiters: false },
    scenario: 'room',
    variant: 'node',
    catches: 'E1 eviction',
  },
  {
    name: 'waits counted per connection, not by tags',
    rules: { countsTagsPerRange: false },
    scenario: 'shared',
    variant: 'worker',
    catches: 'L7 refusal justified',
  },
  {
    name: 'a wait after a look that failed',
    client: { waitsOnlyAfterFullLook: false },
    scenario: 'fault',
    variant: 'node',
    catches: 'C4 quiet',
  },
  {
    name: "today's tags named when waiting again",
    client: { reusesLookTags: false },
    scenario: 'midnight',
    variant: 'node',
    catches: 'C7 nothing new revealed',
  },
  {
    name: 'waiting left standing when turned off',
    client: { closesOnSwitch: false },
    scenario: 'switch',
    variant: 'worker',
    catches: 'C5 off means off',
  },
  {
    name: 'reopened at once after a close for room',
    client: { holdsOffAfterEviction: false },
    scenario: 'room',
    variant: 'worker',
    catches: 'C6 no churn',
  },
  {
    name: 'no wait again after a lease that ended before the next look',
    client: { renewsAfterLease: false },
    scenario: 'cycle',
    variant: 'node',
    catches: 'C8 waits until the next look',
  },
  {
    name: 'a renewal that sends nothing',
    client: { renewalSends: false },
    scenario: 'cycle',
    variant: 'node',
    catches: 'C8 waits until the next look',
  },
  {
    name: 'a wait given up past its lease taken as a drop',
    client: { renewsAfterTimeout: false },
    scenario: 'lull',
    variant: 'worker',
    catches: 'C8 waits until the next look',
  },
  {
    name: 'a cue moves the cursor',
    client: { cueOnly: false },
    scenario: 'cycle',
    variant: 'node',
    catches: 'C2 a wait moves no cursor',
  },
]

/** The model of one scenario on one Lighthouse, with any rules turned off. */
export function waitModel(
  key: string,
  variant: Variant,
  rules: Rules = RULES,
  client: ClientRules = CLIENT_RULES,
): Model<Sys> {
  const scenario = SCENARIOS[key]
  if (scenario === undefined) throw new Error(`no scenario ${key}`)
  const setup: Setup = { ...scenario, variant }
  return {
    name: `${scenario.name} (${variant})`,
    init: initial(setup),
    steps: (s) => steps(s, setup, rules, client),
    safety: [...fromEvents, ...clientChecks(setup.limits)],
    stepChecks: [cursorOnlyInLooks],
    settle: (s) => settle(s, setup, rules, client),
    settled: [noLostMail],
    flags: (s) => [
      ...(s.sent.length > 0 ? ['mail put'] : []),
      ...(Object.values(s.clients).some((c) => c.cue) ? ['cued'] : []),
      ...(Object.values(s.lh.conns).some((c) => c.wait !== null) ? ['a wait stands'] : []),
      ...(s.ghost.owed.length > 0 ? ['a wake owed across a reset'] : []),
      ...(s.reopenedEvicted ? ['reopened after eviction'] : []),
      ...(Object.values(s.clients).some((c) => c.evicted) ? ['evicted'] : []),
      ...(s.renewed ? ['a wait sent again after its lease'] : []),
      ...(s.timedOut ? ['a wait given up past its lease'] : []),
    ],
  }
}

export const withDefect = (defect: Defect): Model<Sys> =>
  waitModel(
    defect.scenario,
    defect.variant,
    { ...RULES, ...defect.rules },
    { ...CLIENT_RULES, ...defect.client },
  )
