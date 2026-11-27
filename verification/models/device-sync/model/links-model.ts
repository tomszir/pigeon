// The invite-links model's steps, invariants and configurations (links.ts has its state and
// rules). People approve or decline on any device the option allows, the maker may run, stop,
// be removed or be replaced, a device that approved may be removed before the maker acts, and a
// hostile removed device forges decisions, requests and answers and answers an asker itself.
import { canon, copy } from './canon.ts'
import type { Invariant, Model } from './explore.ts'
import {
  addedOn,
  askersCheck,
  check,
  counts,
  type D,
  honest,
  KEYS,
  type LinkEntry,
  type LinksConfig,
  type LinksRules,
  type LinksState,
  listOf,
  newSecret,
  onList,
  type Q,
  requestsOn,
  send,
  write,
  xReads,
} from './links.ts'

type Step = readonly [string, LinksState]

function decide(cfg: LinksConfig, s: LinksState, d: D, rid: Q, approve: boolean): void {
  if (approve) s.approved.push({ rid, on: d })
  const bound = cfg.rules.bound ? { rid, key: KEYS[rid] } : {}
  if (d === 'B') {
    s.waiting = s.waiting.filter((w) => w !== rid)
    if (approve) write(s, 'B', { k: 'approve', ...bound })
    else write(s, 'B', { k: 'decline', ...bound })
  } else if (!approve) write(s, d, { k: 'decline', ...bound })
  else if (cfg.rules.option === 'c') write(s, d, { k: 'add', ...bound, secret: newSecret(s, d) })
  else write(s, d, { k: 'approve', ...bound })
  if (d === 'B') check(cfg, s, 'B')
  else send(s, d)
}

function personSteps(cfg: LinksConfig, s: LinksState): Step[] {
  const out: Step[] = []
  for (const d of honest(cfg, s)) {
    if (d !== 'B' && cfg.rules.option === 'a') continue
    if (d === 'B' && cfg.maker === 'away' && s.left.makerChecks <= 0) continue
    const mine = s.devs[d]?.entries ?? []
    for (const [rid, state] of Object.entries(requestsOn(cfg, s, d))) {
      if (state !== 'waiting' || rid === 'qx') continue
      if (mine.some((e) => e.by === d && e.rid === rid && e.k !== 'request')) continue
      for (const approve of [true, false]) {
        const budget = approve ? 'approve' : 'decline'
        if (s.left[budget] <= 0) continue
        const next = copy(s)
        next.left[budget] -= 1
        decide(cfg, next, d, rid as Q, approve)
        out.push([`${d}: person ${approve ? 'approves' : 'declines'} ${rid}`, xReads(cfg, next)])
      }
    }
  }
  return out
}

function removeSteps(cfg: LinksConfig, s: LinksState): Step[] {
  const out: Step[] = []
  const a = s.devs.A
  if (!a) return out
  const remove = (label: string, events: string[], extra?: (next: LinksState) => void) => {
    const next = copy(s)
    const writer = next.devs.A
    if (!writer) return
    writer.log = [...writer.log, ...events]
    writer.clock += 1
    writer.dirty = true
    if (events.includes('rmX')) next.removalSt = writer.clock
    extra?.(next)
    out.push([label, xReads(cfg, next)])
  }
  if (s.left.remove > 0 && cfg.maker === 'removed' && !a.log.includes('rmB'))
    remove('A removes B, the maker', ['rmB'], (n) => {
      n.left.remove -= 1
    })
  if (s.left.replace > 0 && cfg.maker === 'replaced' && !a.log.includes('rmB'))
    remove('A removes B and links B2 in its place', ['rmB', 'addB2'], (n) => {
      n.left.replace -= 1
      const writer = n.devs.A
      if (writer)
        n.devs.B2 = {
          log: [...writer.log],
          clock: writer.clock,
          entries: [...writer.entries],
          dirty: false,
        }
    })
  if ((cfg.hostile || cfg.removeApprover) && !a.log.includes('rmX')) remove('A removes X', ['rmX'])
  return out
}

/** X forges a decision for q1, a request from an asker it made up, and a no for q1. */
function forged(cfg: LinksConfig, s: LinksState): LinkEntry[] {
  const decision: LinkEntry =
    cfg.rules.option === 'c'
      ? { by: 'X', st: 1, k: 'add', rid: 'q1', key: KEYS.q1, secret: newSecret(s, 'X') }
      : { by: 'X', st: 1, k: 'approve', rid: 'q1', key: KEYS.q1 }
  return [
    decision,
    { by: 'X', st: 1, k: 'request', rid: 'qx', key: KEYS.qx },
    { by: 'X', st: 1, k: 'answer', rid: 'q1', key: KEYS.q1, result: 'declined' },
  ]
}

function hostileSteps(cfg: LinksConfig, s: LinksState): Step[] {
  const out: Step[] = []
  if (!cfg.hostile) return out
  if (s.left.forge > 0) {
    const next = copy(s)
    next.left.forge -= 1
    const entries = forged(cfg, next)
    // A decision X signs is yours while it's on the list, and the maker may take it as yours.
    next.approved.push({ rid: 'q1', on: 'X' })
    next.xHolds = [...next.xHolds, ...entries.flatMap((e) => (e.secret ? [e.secret] : []))]
    next.mail.push({
      id: next.nextLetter++,
      kind: 'sync',
      from: 'X',
      pending: ['A', 'B'],
      log: [],
      entries,
    })
    out.push(['X forges a decision, a request and an answer, and sends them', xReads(cfg, next)])
  }
  if (!s.xAnswered && !s.answers.length) {
    const next = copy(s)
    next.xAnswered = true
    const secret = newSecret(next, 'X')
    next.xHolds = [...next.xHolds, secret]
    next.mail.push({
      id: next.nextLetter++,
      kind: 'answer',
      from: 'X',
      pending: ['q1'],
      log: [],
      entries: [],
      result: 'added',
      secret,
    })
    out.push(['X answers q1 itself', xReads(cfg, next)])
  }
  return out
}

function steps(cfg: LinksConfig, s: LinksState): Step[] {
  const out: Step[] = []
  for (const d of honest(cfg, s)) {
    if (d === 'B' && cfg.maker === 'away' && s.left.makerChecks <= 0) continue
    const next = copy(s)
    if (d === 'B') next.left.makerChecks -= 1
    check(cfg, next, d)
    if (canon(next.devs) !== canon(s.devs) || canon(next.mail) !== canon(s.mail))
      out.push([`${d} checks mail`, xReads(cfg, next)])
  }
  out.push(...personSteps(cfg, s), ...removeSteps(cfg, s), ...hostileSteps(cfg, s))
  if (s.mail.some((l) => l.kind === 'answer' && l.pending.some((p) => p.startsWith('q')))) {
    const next = copy(s)
    askersCheck(cfg, next)
    out.push(['the askers check mail', xReads(cfg, next)])
  }
  return out
}

function settle(cfg: LinksConfig, state: LinksState): LinksState {
  const s = copy(state)
  for (let round = 0; round < 20; round++) {
    const before = canon(s)
    for (const d of honest(cfg, s)) if (d !== 'B' || cfg.maker !== 'away') check(cfg, s, d)
    askersCheck(cfg, s)
    xReads(cfg, s)
    const alive = new Set<string>([...honest(cfg, s), 'q1', 'q2', 'qx', 'X'])
    for (const l of s.mail) l.pending = l.pending.filter((p) => alive.has(p))
    s.mail = s.mail.filter((l) => l.pending.length > 0)
    if (canon(s) === before) break
  }
  return s
}

/** The secret device `d` shows asker `q` as a friend on: the maker's own record, once it acted. */
function friendOn(cfg: LinksConfig, s: LinksState, d: D, q: Q): string | undefined {
  const adds = (s.devs[d]?.entries ?? []).filter(
    (e) => e.k === 'add' && e.rid === q && counts(cfg, s, d, e),
  )
  return (adds.find((e) => e.by === 'B') ?? adds[0])?.secret
}

const ASKERS: readonly Q[] = ['q1', 'q2']

const K1: Invariant<LinksState> = {
  id: 'K1 the asker is added only by the maker',
  check: (s) => {
    for (const q of ASKERS) {
      const other = (s.askers[q] ?? []).find((a) => !a.endsWith(':B'))
      if (other) return `${q} took ${other}`
    }
    return undefined
  },
}

const K2: Invariant<LinksState> = {
  id: 'K2 no removed device holds a new friend’s secret',
  check: (s) => {
    for (const q of ASKERS) {
      const secret = addedOn(s, q)
      if (secret && s.secrets[secret]?.knew && s.xHolds.includes(secret))
        return `${q} is on ${secret}, made by ${s.secrets[secret]?.by}, which X holds`
    }
    return undefined
  },
}

const K3: Invariant<LinksState> = {
  id: 'K3 the maker acts only on a device still on its list',
  check: (s) =>
    s.actedOnRemoved
      ? `B acted on the word of ${s.actedOnRemoved}, which it knew was removed`
      : undefined,
}

const K6: Invariant<LinksState> = {
  id: 'K6 the maker answers only requests it fetched',
  check: (s) =>
    s.answeredUnfetched ? `B answered ${s.answeredUnfetched}, which it never fetched` : undefined,
}

const K7: Invariant<LinksState> = {
  id: 'K7 each request is answered once',
  check: (s) => {
    for (const q of ASKERS)
      if ((s.askers[q] ?? []).length > 1) return `${q} took ${s.askers[q]?.join(' and ')}`
    return undefined
  },
}

const K8: Invariant<LinksState> = {
  id: 'K8 an asker is added only on their own approval',
  check: (s) => {
    for (const q of ASKERS)
      if (addedOn(s, q) && !s.approved.some((a) => a.rid === q))
        return `${q} was added, and nobody approved ${q}`
    return undefined
  },
}

const K4 = (cfg: LinksConfig): Invariant<LinksState> => ({
  id: 'K4 an approval is carried out while the maker runs',
  check: (s) => {
    if (cfg.maker !== 'runs') return undefined
    for (const a of s.approved) {
      if (!listOf(s, 'B').includes(a.on) || (a.on === 'X' && cfg.hostile)) continue
      if (!s.answers.some((x) => x.rid === a.rid))
        return `${a.rid}, approved on ${a.on}, was never answered`
    }
    return undefined
  },
})

const K5 = (cfg: LinksConfig): Invariant<LinksState> => ({
  id: 'K5 both sides agree on the friendship',
  check: (s) => {
    if (cfg.maker !== 'runs') return undefined
    for (const d of honest(cfg, s))
      for (const q of ASKERS) {
        const mine = friendOn(cfg, s, d, q)
        if (mine !== addedOn(s, q))
          return `${d} shows ${q} on ${mine ?? 'nothing'}, ${q} is on ${addedOn(s, q) ?? 'nothing'}`
      }
    return undefined
  },
})

/** What the maker really answered each request it fetched, from its own ghost. */
function truth(s: LinksState): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of s.devs.B?.entries ?? [])
    if (e.by === 'B' && e.k === 'request' && e.rid) out[e.rid] = 'waiting'
  for (const a of s.answers) out[a.rid] = a.result
  return out
}

const K9 = (cfg: LinksConfig): Invariant<LinksState> => ({
  id: 'K9 every device shows each request as the maker answered it',
  check: (s) => {
    if (cfg.maker !== 'runs') return undefined
    const want = canon(truth(s))
    for (const d of honest(cfg, s)) {
      const shown = canon(requestsOn(cfg, s, d))
      if (shown !== want) return `${d} shows ${shown}, the maker answered ${want}`
    }
    return undefined
  },
})

function initial(cfg: LinksConfig): LinksState {
  const dev = () => ({ log: [], clock: 1, entries: [], dirty: false })
  return {
    devs: { A: dev(), B: dev(), X: dev() },
    askers: {},
    waiting: [...cfg.askers],
    mail: [],
    secrets: {},
    xHolds: [],
    approved: [],
    answers: [],
    left: {
      approve: cfg.approvals ?? 1,
      decline: cfg.declines ?? 0,
      remove: cfg.maker === 'removed' ? 1 : 0,
      replace: cfg.maker === 'replaced' ? 1 : 0,
      forge: cfg.hostile ? 1 : 0,
      makerChecks: cfg.maker === 'away' ? 1 : 99,
    },
    removalSt: 0,
    nextLetter: 1,
    nextSecret: 1,
  }
}

export function linksModel(cfg: LinksConfig): Model<LinksState> {
  return {
    name: cfg.name,
    init: initial(cfg),
    steps: (s) => steps(cfg, s),
    safety: [K1, K2, K3, K6, K7, K8],
    settle: (s) => settle(cfg, s),
    settled: [K4(cfg), K5(cfg), K9(cfg)],
    flags: (s) => [
      ...(ASKERS.some((q) => addedOn(s, q)) ? ['added'] : []),
      ...(honest(cfg, s).some((d) => ASKERS.some((q) => friendOn(cfg, s, d, q) !== addedOn(s, q)))
        ? ['one side only']
        : []),
      ...s.approved.map((a) => `approved on ${a.on}`),
      ...(s.answers.some((a) => a.result === 'declined') ? ['declined'] : []),
      ...(s.answers.some((a) => a.result === 'busy') ? ['busy'] : []),
      ...(s.approved.length > 1 ? ['two approvals'] : []),
      ...(s.approved.some((a) => a.on === 'X' && !onList(s).includes('X'))
        ? ['approver removed']
        : []),
      ...((s.devs.A?.log ?? []).includes('rmX') ? ['X removed'] : []),
      ...(s.xHolds.length ? ['X holds a secret'] : []),
    ],
  }
}

const RULES = (option: LinksRules['option']): LinksRules => ({
  option,
  approverOnList: true,
  makerOnly: true,
  bound: true,
  answerOnce: true,
  makerEntries: true,
})

const one = ['q1'] as const
const two = ['q1', 'q2'] as const

/** Every option under every condition, and option (b) in the harder cases, side by side. */
export function linkConfigs(): LinksConfig[] {
  const out: LinksConfig[] = []
  for (const option of ['a', 'b', 'c'] as const)
    for (const maker of ['runs', 'away', 'removed', 'replaced'] as const)
      out.push({
        name: `links (${option}), maker ${maker}`,
        rules: RULES(option),
        hostile: false,
        maker,
        askers: one,
      })
  out.push(
    {
      name: 'links (b), two askers, one approved, one declined',
      rules: RULES('b'),
      hostile: false,
      maker: 'runs',
      askers: two,
      declines: 1,
    },
    {
      name: 'links (b), two askers, the second busy',
      rules: RULES('b'),
      hostile: false,
      maker: 'runs',
      askers: two,
      busyAfter: 1,
    },
    {
      name: 'links (b), approved twice and declined at once',
      rules: RULES('b'),
      hostile: false,
      maker: 'runs',
      askers: one,
      approvals: 2,
      declines: 1,
    },
    {
      name: 'links (b), the approving device removed',
      rules: RULES('b'),
      hostile: false,
      maker: 'runs',
      askers: one,
      removeApprover: true,
    },
    { name: 'links (b), hostile X', rules: RULES('b'), hostile: true, maker: 'runs', askers: one },
    { name: 'links (c), hostile X', rules: RULES('c'), hostile: true, maker: 'runs', askers: one },
  )
  return out
}

const named = (name: string): LinksConfig => {
  const cfg = linkConfigs().find((c) => c.name === name)
  if (!cfg) throw new Error(`no configuration ${name}`)
  return cfg
}

const defect = (
  base: string,
  rule: keyof Omit<LinksRules, 'option'>,
  what: string,
): LinksConfig => {
  const cfg = named(base)
  return { ...cfg, name: `${cfg.name} [defect: ${what}]`, rules: { ...cfg.rules, [rule]: false } }
}

export const LINK_DEFECTS: readonly { name: string; cfg: LinksConfig; caughtBy: string }[] = [
  {
    name: 'answers taken from any of your devices',
    cfg: defect('links (b), hostile X', 'makerOnly', 'answers taken from any device'),
    caughtBy: 'K1 the asker is added only by the maker',
  },
  {
    name: 'the maker acts on a removed device’s approval',
    cfg: defect('links (b), hostile X', 'approverOnList', 'approvals counted by stamp'),
    caughtBy: 'K3 the maker acts only on a device still on its list',
  },
  {
    name: 'an approval not bound to its request',
    cfg: defect(
      'links (b), two askers, one approved, one declined',
      'bound',
      'approvals name no request',
    ),
    caughtBy: 'K8 an asker is added only on their own approval',
  },
  {
    name: 'a decision applied to an answered request',
    cfg: defect(
      'links (b), approved twice and declined at once',
      'answerOnce',
      'decisions not spent',
    ),
    caughtBy: 'K7 each request is answered once',
  },
  {
    name: 'requests and answers taken from any of your devices',
    cfg: defect('links (b), hostile X', 'makerEntries', 'request and answer entries from anyone'),
    caughtBy: 'K9 every device shows each request as the maker answered it',
  },
]
