// The invite-links model: a link made on the phone (B, the link's maker), a request through it
// from someone (q), and your other devices (A, the writer, and X). It compares what other devices
// may do with that request:
//
// - (a) see it: B shares the link and its requests; only B can add or decline.
// - (b) ask the maker: another device records "add them" in your shared log; B acts on it when it
//   next runs, making the pair secret itself and answering through the link as it always does.
// - (c) share the approval: another device adds them itself, making the pair secret and the
//   friend record; B, the only device whoever asked takes answers from, sends that secret in its
//   `added` when it next runs.
//
// Under every option the asker takes answers only from the device the link names, as today.
import { canon, copy, uniq } from './canon.ts'
import type { Invariant, Model } from './explore.ts'

type D = 'A' | 'B' | 'X' | 'B2'
type Option = 'a' | 'b' | 'c'

interface LinkEntry {
  readonly by: D
  readonly st: number
  readonly k: 'request' | 'approve' | 'add'
  /** For `add`: the pair secret the friend record holds. */
  readonly secret?: string
}

interface LinkDevice {
  /** `rmB`, `rmX`, `addB2`: the device log events it has merged. */
  log: string[]
  clock: number
  entries: LinkEntry[]
  dirty: boolean
  /** The maker: answers it has sent through the link (the secret of its `added`). */
  answered?: string
}

interface LinkLetter {
  readonly id: number
  readonly kind: 'sync' | 'added'
  readonly from: D
  pending: string[]
  readonly log: string[]
  readonly entries: LinkEntry[]
  readonly secret?: string
}

export interface LinksState {
  devs: Partial<Record<D, LinkDevice>>
  /** The person asking: whether their request waits, and the friend they took from an answer. */
  q: { friend?: { secret: string; from: D } }
  /** The request waits at B's ask tags until B fetches it. */
  requestWaiting: boolean
  mail: LinkLetter[]
  /** Ghost: each pair secret made, by whom, and whether its maker knew X was removed. */
  secrets: Record<string, { by: D; knew: boolean }>
  /** Ghost: secrets X has read. */
  xHolds: string[]
  /** Ghost: devices on the list a person approved on. */
  approvedOn: D[]
  /** Ghost: on whose word B added them (B itself, or the device whose approval it acted on). */
  addedOnWordOf?: D
  /** Ghost: B knew that device was removed when it acted on its word. */
  actedOnRemoved?: true
  /** Stamp of X's removal on the writer's log, 0 while X is on it. */
  removalSt: number
  /** A hostile X has answered the request itself. */
  xAnswered?: true
  left: { approve: number; remove: number; replace: number; forge: number; makerChecks: number }
  nextLetter: number
  nextSecret: number
}

export interface LinksRules {
  readonly option: Option
  /** B acts on another device's approval only while that device is on B's list. */
  readonly approverOnList: boolean
  /** The asker takes answers only from the device the link names. */
  readonly makerOnly: boolean
}

export interface LinksConfig {
  readonly name: string
  readonly rules: LinksRules
  /** X is hostile: it forges an approval at an early stamp, then is removed. */
  readonly hostile: boolean
  /** What happens to the maker: it runs, stops running, is removed, or is replaced. */
  readonly maker: 'runs' | 'away' | 'removed' | 'replaced'
}

const LIST: readonly D[] = ['A', 'B', 'X', 'B2']

function listOf(s: LinksState, d: D): D[] {
  const log = s.devs[d]?.log ?? []
  return LIST.filter((o) => s.devs[o] !== undefined)
    .filter((o) => o !== 'B2' || log.includes('addB2') || d === 'B2')
    .filter((o) => !log.includes(`rm${o}`))
}

/** The real list: the writer's. */
const onList = (s: LinksState): D[] => listOf(s, 'A')
const honest = (cfg: LinksConfig, s: LinksState): D[] =>
  onList(s).filter((d) => !(d === 'X' && cfg.hostile))

function write(s: LinksState, d: D, entry: Omit<LinkEntry, 'by' | 'st'>, st?: number): void {
  const dev = s.devs[d]
  if (!dev) return
  dev.clock += 1
  dev.entries = [...dev.entries, { by: d, st: st ?? dev.clock, ...entry }]
  dev.dirty = true
}

function newSecret(s: LinksState, by: D): string {
  const id = `s${s.nextSecret++}`
  const log = s.devs[by === 'X' ? 'A' : by]?.log ?? []
  s.secrets[id] = { by, knew: log.includes('rmX') }
  return id
}

/** Sends this device's log entries to the devices on its list. */
function send(s: LinksState, d: D): void {
  const dev = s.devs[d]
  if (!dev?.dirty) return
  dev.dirty = false
  const to = listOf(s, d).filter((o) => o !== d)
  s.mail.push({
    id: s.nextLetter++,
    kind: 'sync',
    from: d,
    pending: to,
    log: [...dev.log],
    entries: dev.entries,
  })
}

/** Whether an entry counts on `d`: entries a removed device stamped after its removal don't. */
function counts(s: LinksState, d: D, e: LinkEntry): boolean {
  const log = s.devs[d]?.log ?? []
  return !(e.by === 'X' && log.includes('rmX') && e.st >= s.removalSt)
}

/** The maker acts on what its log holds: an approval to act on, or a friend record to answer for. */
function makerActs(cfg: LinksConfig, s: LinksState): void {
  const b = s.devs.B
  if (!b || b.answered !== undefined || !b.entries.some((e) => e.k === 'request')) return
  const list = listOf(s, 'B')
  if (cfg.rules.option === 'b') {
    const ask = b.entries.find(
      (e) =>
        e.k === 'approve' &&
        counts(s, 'B', e) &&
        (!cfg.rules.approverOnList || list.includes(e.by)),
    )
    if (!ask) return
    const secret = newSecret(s, 'B')
    write(s, 'B', { k: 'add', secret })
    answer(s, secret, ask.by)
  }
  if (cfg.rules.option === 'c') {
    const add = b.entries.find((e) => e.k === 'add' && counts(s, 'B', e) && e.secret)
    if (add?.secret) answer(s, add.secret, add.by)
  }
}

function answer(s: LinksState, secret: string, onWordOf: D): void {
  const b = s.devs.B
  if (!b) return
  b.answered = secret
  s.addedOnWordOf = onWordOf
  if (onWordOf !== 'B' && b.log.includes(`rm${onWordOf}`)) s.actedOnRemoved = true
  s.mail.push({
    id: s.nextLetter++,
    kind: 'added',
    from: 'B',
    pending: ['q'],
    log: [],
    entries: [],
    secret,
  })
}

/** One mail check by `d`. The maker also fetches requests under its ask tags. */
function check(cfg: LinksConfig, s: LinksState, d: D): void {
  const dev = s.devs[d]
  if (!dev) return
  if (d === 'B' && s.requestWaiting) {
    s.requestWaiting = false
    write(s, 'B', { k: 'request' })
  }
  // Every device log in the mail is merged before anything else in it is acted on.
  const before = canon(dev)
  for (const l of s.mail) if (l.pending.includes(d)) dev.log = uniq([...dev.log, ...l.log])
  if (canon(dev) !== before) dev.dirty = true
  for (const l of s.mail) {
    if (!l.pending.includes(d)) continue
    l.pending = l.pending.filter((p) => p !== d)
    const before = canon(dev)
    if (!listOf(s, d).includes(l.from)) continue
    for (const e of l.entries)
      if (!dev.entries.some((h) => canon(h) === canon(e))) dev.entries.push(e)
    for (const e of l.entries) dev.clock = Math.max(dev.clock, e.st)
    if (canon(dev) !== before) dev.dirty = true
  }
  s.mail = s.mail.filter((l) => l.pending.length > 0)
  if (d === 'B') makerActs(cfg, s)
  send(s, d)
}

/** The asker takes its answers: only from the device the link names, as today. */
function askerChecks(cfg: LinksConfig, s: LinksState): void {
  for (const l of s.mail)
    if (l.kind === 'added' && l.pending.includes('q')) {
      l.pending = []
      if (!s.q.friend && l.secret && (l.from === 'B' || !cfg.rules.makerOnly))
        s.q.friend = { secret: l.secret, from: l.from }
    }
  s.mail = s.mail.filter((l) => l.pending.length > 0)
}

/** A hostile X reads everything sealed to it at once. */
function xReads(cfg: LinksConfig, s: LinksState): LinksState {
  if (!cfg.hostile) return s
  for (const l of s.mail)
    if (l.pending.includes('X')) {
      l.pending = l.pending.filter((p) => p !== 'X')
      s.xHolds = uniq([...s.xHolds, ...l.entries.flatMap((e) => (e.secret ? [e.secret] : []))])
    }
  s.mail = s.mail.filter((l) => l.pending.length > 0)
  return s
}

const sees = (s: LinksState, d: D) => (s.devs[d]?.entries ?? []).some((e) => e.k === 'request')

function steps(cfg: LinksConfig, s: LinksState): (readonly [string, LinksState])[] {
  const out: (readonly [string, LinksState])[] = []
  const push = (label: string, next: LinksState) => out.push([label, xReads(cfg, next)])
  for (const d of honest(cfg, s)) {
    if (d === 'B' && s.left.makerChecks <= 0) continue
    const next = copy(s)
    if (d === 'B' && cfg.maker === 'away') next.left.makerChecks -= 1
    check(cfg, next, d)
    if (canon(next) !== canon(s)) push(`${d} checks mail`, next)
  }
  for (const d of honest(cfg, s))
    if (s.left.approve > 0 && sees(s, d) && !s.approvedOn.length) {
      if (d !== 'B' && cfg.rules.option === 'a') continue
      const next = copy(s)
      next.left.approve -= 1
      next.approvedOn = [d]
      if (d === 'B') {
        const secret = newSecret(next, 'B')
        write(next, 'B', { k: 'add', secret })
        answer(next, secret, 'B')
        send(next, 'B')
      } else if (cfg.rules.option === 'b') write(next, d, { k: 'approve' })
      else write(next, d, { k: 'add', secret: newSecret(next, d) })
      push(`${d}: person approves`, next)
    }
  const a = s.devs.A
  if (a && s.left.remove > 0 && cfg.maker === 'removed' && !a.log.includes('rmB')) {
    const next = copy(s)
    next.left.remove -= 1
    next.devs.A?.log.push('rmB')
    if (next.devs.A) next.devs.A.dirty = true
    push('A removes B, the maker', next)
  }
  if (a && s.left.replace > 0 && cfg.maker === 'replaced' && !a.log.includes('rmB')) {
    const next = copy(s)
    next.left.replace -= 1
    const writer = next.devs.A
    if (writer) {
      writer.log.push('rmB', 'addB2')
      writer.dirty = true
      next.devs.B2 = {
        log: [...writer.log],
        clock: writer.clock,
        entries: [...writer.entries],
        dirty: false,
      }
    }
    push('A removes B and links B2 in its place', next)
  }
  if (cfg.hostile && a && !a.log.includes('rmX')) {
    const next = copy(s)
    next.devs.A?.log.push('rmX')
    if (next.devs.A) {
      next.devs.A.clock += 1
      next.devs.A.dirty = true
      next.removalSt = next.devs.A.clock
    }
    push('A removes X', next)
  }
  if (cfg.hostile && s.left.forge > 0) {
    // X read the request, sealed to it with the rest of the card's devices. It forges an
    // approval at an early stamp (option b), or a friend record with a secret it made (option
    // c), and sends it to your other devices.
    const next = copy(s)
    next.left.forge -= 1
    const entry: LinkEntry =
      cfg.rules.option === 'c'
        ? { by: 'X', st: 1, k: 'add', secret: newSecret(next, 'X') }
        : { by: 'X', st: 1, k: 'approve' }
    if (entry.secret) next.xHolds = uniq([...next.xHolds, entry.secret])
    next.mail.push({
      id: next.nextLetter++,
      kind: 'sync',
      from: 'X',
      pending: ['A', 'B'],
      log: [],
      entries: [entry],
    })
    push('X forges an approval and sends it', next)
  }
  if (cfg.hostile && !s.xAnswered && !s.q.friend) {
    // X read the request, sealed to every device on the card, and answers it itself.
    const next = copy(s)
    next.xAnswered = true
    const secret = newSecret(next, 'X')
    next.xHolds = uniq([...next.xHolds, secret])
    next.mail.push({
      id: next.nextLetter++,
      kind: 'added',
      from: 'X',
      pending: ['q'],
      log: [],
      entries: [],
      secret,
    })
    push('X answers q itself', next)
  }
  if (s.mail.some((l) => l.kind === 'added' && l.pending.includes('q'))) {
    const next = copy(s)
    askerChecks(cfg, next)
    push('q checks mail', next)
  }
  return out
}

function settle(cfg: LinksConfig, state: LinksState): LinksState {
  const s = copy(state)
  for (let round = 0; round < 20; round++) {
    const before = canon(s)
    for (const d of honest(cfg, s)) if (d !== 'B' || cfg.maker !== 'away') check(cfg, s, d)
    askerChecks(cfg, s)
    xReads(cfg, s)
    const alive = new Set<string>([...honest(cfg, s), 'q'])
    for (const l of s.mail) l.pending = l.pending.filter((p) => alive.has(p) || p === 'X')
    s.mail = s.mail.filter((l) => l.pending.length > 0)
    if (canon(s) === before) break
  }
  return s
}

/** Which devices show them as a friend: one holding an `add` entry that counts. */
function friendOn(s: LinksState, d: D): string | undefined {
  return s.devs[d]?.entries.find((e) => e.k === 'add' && counts(s, d, e))?.secret
}

const K1: Invariant<LinksState> = {
  id: 'K1 the asker is added only by the maker',
  check: (s) =>
    s.q.friend && s.q.friend.from !== 'B' ? `q took an answer from ${s.q.friend.from}` : undefined,
}

const K2: Invariant<LinksState> = {
  id: 'K2 no removed device holds a new friend’s secret',
  check: (s) => {
    const secret = s.q.friend?.secret
    if (!secret || !s.secrets[secret]?.knew || !s.xHolds.includes(secret)) return undefined
    return `q is on ${secret}, made by ${s.secrets[secret]?.by}, which X holds`
  },
}

const K3: Invariant<LinksState> = {
  id: 'K3 the maker acts only on a device still on its list',
  check: (s) =>
    s.actedOnRemoved
      ? `B added q on the word of ${s.addedOnWordOf}, which it knew was removed`
      : undefined,
}

export interface LinksOutcome {
  readonly added: boolean
  readonly dangling: boolean
}

/** Once settled: whether they were added, and whether a device of yours shows a friend they never got. */
export function outcome(s: LinksState): LinksOutcome {
  const devices = onList(s)
  return {
    added: s.q.friend !== undefined,
    dangling: devices.some((d) => friendOn(s, d) !== undefined) && s.q.friend === undefined,
  }
}

const K4 = (cfg: LinksConfig): Invariant<LinksState> => ({
  id: 'K4 an approval is carried out while the maker runs',
  check: (s) => {
    const approved = s.approvedOn.some((d) => d !== 'X')
    if (!approved || cfg.maker !== 'runs' || s.q.friend) return undefined
    return `approved on ${s.approvedOn.join(',')}, and q was never added`
  },
})

const K5 = (cfg: LinksConfig): Invariant<LinksState> => ({
  id: 'K5 both sides agree on the friendship',
  check: (s) => {
    if (cfg.maker !== 'runs') return undefined
    for (const d of honest(cfg, s)) {
      const mine = friendOn(s, d)
      if (mine !== s.q.friend?.secret)
        return `${d} shows q on ${mine ?? 'nothing'}, q is on ${s.q.friend?.secret ?? 'nothing'}`
    }
    return undefined
  },
})

function initial(cfg: LinksConfig): LinksState {
  const dev = (): LinkDevice => ({ log: [], clock: 1, entries: [], dirty: false })
  return {
    devs: { A: dev(), B: dev(), X: dev() },
    q: {},
    requestWaiting: true,
    mail: [],
    secrets: {},
    xHolds: [],
    approvedOn: [],
    left: {
      approve: 1,
      remove: cfg.maker === 'removed' ? 1 : 0,
      replace: cfg.maker === 'replaced' ? 1 : 0,
      forge: cfg.hostile ? 1 : 0,
      makerChecks: cfg.maker === 'away' ? 1 : 99,
    },
    nextLetter: 1,
    nextSecret: 1,
    removalSt: 0,
  }
}

export function linksModel(cfg: LinksConfig): Model<LinksState> {
  return {
    name: cfg.name,
    init: initial(cfg),
    steps: (s) => steps(cfg, s),
    safety: [K1, K2, K3],
    settle: (s) => settle(cfg, s),
    settled: [K4(cfg), K5(cfg)],
    flags: (s) => [
      ...(s.q.friend ? ['added'] : []),
      ...(honest(cfg, s).some((d) => friendOn(s, d) !== s.q.friend?.secret)
        ? ['one side only']
        : []),
      ...(s.approvedOn.length ? [`approved on ${s.approvedOn.join(',')}`] : []),
      ...(sees(s, 'A') ? ['A sees the request'] : []),
      ...((s.devs.A?.log ?? []).includes('rmX') ? ['X removed'] : []),
      ...(s.xHolds.length ? ['X holds a secret'] : []),
    ],
  }
}

const RULES: Record<Option, LinksRules> = {
  a: { option: 'a', approverOnList: true, makerOnly: true },
  b: { option: 'b', approverOnList: true, makerOnly: true },
  c: { option: 'c', approverOnList: true, makerOnly: true },
}

/** Every option under every condition, for the side-by-side comparison. */
export function linkConfigs(): LinksConfig[] {
  const out: LinksConfig[] = []
  for (const option of ['a', 'b', 'c'] as const)
    for (const maker of ['runs', 'away', 'removed', 'replaced'] as const)
      out.push({
        name: `links (${option}), maker ${maker}`,
        rules: RULES[option],
        hostile: false,
        maker,
      })
  for (const option of ['b', 'c'] as const)
    out.push({
      name: `links (${option}), hostile X`,
      rules: RULES[option],
      hostile: true,
      maker: 'runs',
    })
  return out
}

export const LINK_DEFECTS: readonly { name: string; cfg: LinksConfig; caughtBy: string }[] = [
  {
    name: 'answers taken from any of your devices',
    cfg: {
      name: 'links (b), hostile X [defect: answers taken from any device]',
      rules: { ...RULES.b, makerOnly: false },
      hostile: true,
      maker: 'runs',
    },
    caughtBy: 'K1 the asker is added only by the maker',
  },
  {
    name: 'the maker acts on a removed device\u2019s approval',
    cfg: {
      name: 'links (b), hostile X [defect: approvals counted by stamp]',
      rules: { ...RULES.b, approverOnList: false },
      hostile: true,
      maker: 'runs',
    },
    caughtBy: 'K3 the maker acts only on a device still on its list',
  },
]
