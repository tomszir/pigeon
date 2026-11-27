// The invite-links model: a link made on the phone (B, the link's maker), requests through it
// from one or two people (q1, q2), and your other devices (A, the writer, and X). It compares
// what other devices may do with a request:
//
// - (a) see it: B shares the link and its requests; only B adds or declines.
// - (b) ask the maker: another device records "add them" or "decline them" in your shared log,
//   naming the link, the request and the asker's key; B acts on it when it next runs, once, making
//   the pair secret itself and answering through the link as it always does.
// - (c) share the approval: another device adds them itself, making the pair secret and the
//   friend record; B, the only device whoever asked takes answers from, sends that secret.
//
// Under every option the asker takes answers only from the device the link names, and only the
// maker writes a link's `request` and `answer` entries.
import { canon, uniq } from './canon.ts'

export type D = 'A' | 'B' | 'X' | 'B2'
/** Two people asking, and one a hostile removed device makes up, with a key of its own. */
export type Q = 'q1' | 'q2' | 'qx'
type Option = 'a' | 'b' | 'c'
type Result = 'added' | 'declined' | 'busy'

export interface LinkEntry {
  readonly by: D
  readonly st: number
  readonly k: 'request' | 'answer' | 'approve' | 'decline' | 'add'
  /** The request it is about, and the asker's key: every entry but a bound-less approval has both. */
  readonly rid?: Q
  readonly key?: string
  readonly result?: Result
  /** For `add`: the pair secret the friend record holds. */
  readonly secret?: string
}

interface LinkDevice {
  /** `rmB`, `rmX`, `addB2`: the device log events it has merged. */
  log: string[]
  clock: number
  entries: LinkEntry[]
  dirty: boolean
}

interface LinkLetter {
  readonly id: number
  readonly kind: 'sync' | 'answer'
  readonly from: D
  pending: string[]
  readonly log: string[]
  readonly entries: LinkEntry[]
  readonly result?: Result
  readonly secret?: string
}

export interface LinksState {
  devs: Partial<Record<D, LinkDevice>>
  /** What each asker took: each distinct answer, as `result:secret:from`. */
  askers: Partial<Record<Q, string[]>>
  /** Requests waiting at B's ask tags, not fetched yet. */
  waiting: Q[]
  mail: LinkLetter[]
  /** Ghost: each pair secret made, by whom, and whether its maker knew X was removed. */
  secrets: Record<string, { by: D; knew: boolean }>
  /** Ghost: secrets X has read. */
  xHolds: string[]
  /** Ghost: requests a person approved, and on which device. */
  approved: { rid: Q; on: D }[]
  /** Ghost: each answer the maker gave, in order. */
  answers: { rid: Q; result: Result; onWordOf: D }[]
  /** Ghost: the maker acted on the word of a device it knew was removed. */
  actedOnRemoved?: D
  /** Ghost: the maker answered a request it never fetched from its ask tags. */
  answeredUnfetched?: Q
  left: {
    approve: number
    decline: number
    remove: number
    replace: number
    forge: number
    makerChecks: number
  }
  removalSt: number
  /** A hostile X has answered q1 itself. */
  xAnswered?: true
  nextLetter: number
  nextSecret: number
}

export interface LinksRules {
  readonly option: Option
  /** B acts on another device's decision only while that device is on B's list. */
  readonly approverOnList: boolean
  /** The asker takes answers only from the device the link names. */
  readonly makerOnly: boolean
  /** A decision names its request and the asker's key, and B acts on it only for that request. */
  readonly bound: boolean
  /** A request is answered once; a decision on an answered request is spent. */
  readonly answerOnce: boolean
  /** Only the maker's `request` and `answer` entries count. */
  readonly makerEntries: boolean
}

export interface LinksConfig {
  readonly name: string
  readonly rules: LinksRules
  /** X is hostile: it forges a decision, a request and an answer, and answers an asker itself. */
  readonly hostile: boolean
  /** What happens to the maker: it runs, stops running, is removed, or is replaced. */
  readonly maker: 'runs' | 'away' | 'removed' | 'replaced'
  readonly askers: readonly Q[]
  /** B answers `busy` to a request once this many wait unanswered. */
  readonly busyAfter?: number
  readonly approvals?: number
  readonly declines?: number
  /** X is honest but removed, after it may have approved. */
  readonly removeApprover?: boolean
}

const LIST: readonly D[] = ['A', 'B', 'X', 'B2']
export const KEYS: Record<Q, string> = { q1: 'k1', q2: 'k2', qx: 'kx' }

export function listOf(s: LinksState, d: D): D[] {
  const log = s.devs[d]?.log ?? []
  return LIST.filter((o) => s.devs[o] !== undefined)
    .filter((o) => o !== 'B2' || log.includes('addB2') || d === 'B2')
    .filter((o) => !log.includes(`rm${o}`))
}

export const onList = (s: LinksState): D[] => listOf(s, 'A')
export const honest = (cfg: LinksConfig, s: LinksState): D[] =>
  onList(s).filter((d) => !(d === 'X' && cfg.hostile))

export function write(s: LinksState, d: D, entry: Omit<LinkEntry, 'by' | 'st'>): void {
  const dev = s.devs[d]
  if (!dev) return
  dev.clock += 1
  dev.entries = [...dev.entries, { by: d, st: dev.clock, ...entry }]
  dev.dirty = true
}

export function newSecret(s: LinksState, by: D): string {
  const id = `s${s.nextSecret++}`
  // X knows when it was removed; any other device, once it has merged the log saying so.
  const log = s.devs[by === 'X' ? 'A' : by]?.log ?? []
  s.secrets[id] = { by, knew: log.includes('rmX') }
  return id
}

export function send(s: LinksState, d: D): void {
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

/** Whether an entry counts on `d`: a removed X's entries stamped from its removal on don't. */
export function counts(cfg: LinksConfig, s: LinksState, d: D, e: LinkEntry): boolean {
  if (cfg.rules.makerEntries && (e.k === 'request' || e.k === 'answer') && e.by !== 'B')
    return false
  const log = s.devs[d]?.log ?? []
  return !(e.by === 'X' && log.includes('rmX') && e.st >= s.removalSt)
}

/** The requests device `d` shows, each with the maker's answer if it has one. */
export function requestsOn(
  cfg: LinksConfig,
  s: LinksState,
  d: D,
): Record<string, Result | 'waiting'> {
  const out: Record<string, Result | 'waiting'> = {}
  const entries = (s.devs[d]?.entries ?? []).filter((e) => counts(cfg, s, d, e))
  for (const e of entries) if (e.k === 'request' && e.rid) out[e.rid] ??= 'waiting'
  for (const e of entries) if (e.k === 'answer' && e.rid && e.result) out[e.rid] = e.result
  return out
}

/** The maker answers a request through the link, once. */
function answer(s: LinksState, rid: Q, result: Result, onWordOf: D, secret?: string): void {
  const b = s.devs.B
  if (!b) return
  if (onWordOf !== 'B' && b.log.includes(`rm${onWordOf}`)) s.actedOnRemoved = onWordOf
  if (!b.entries.some((e) => e.by === 'B' && e.k === 'request' && e.rid === rid))
    s.answeredUnfetched = rid
  s.answers.push({ rid, result, onWordOf })
  write(s, 'B', { k: 'answer', rid, key: KEYS[rid], result })
  if (result === 'added' && secret) write(s, 'B', { k: 'add', rid, key: KEYS[rid], secret })
  s.mail.push({
    id: s.nextLetter++,
    kind: 'answer',
    from: 'B',
    pending: [rid],
    log: [],
    entries: [],
    result,
    ...(secret ? { secret } : {}),
  })
}

/** The maker carries out the decisions its log holds, for requests it hasn't answered. */
function makerActs(cfg: LinksConfig, s: LinksState): void {
  const b = s.devs.B
  if (!b) return
  const list = listOf(s, 'B')
  const entries = b.entries.filter((e) => counts(cfg, s, 'B', e))
  const answered = new Set(
    entries.flatMap((e) => (e.k === 'answer' && e.by === 'B' && e.rid ? [e.rid] : [])),
  )
  const open = entries.flatMap((e) =>
    e.k === 'request' && e.rid && !answered.has(e.rid) ? [e] : [],
  )
  const spent = new Set<string>()
  for (const req of open) {
    if (cfg.rules.answerOnce && answered.has(req.rid as Q)) continue
    const decision = entries.find(
      (e) =>
        (e.k === 'approve' ||
          e.k === 'decline' ||
          (cfg.rules.option === 'c' && e.k === 'add' && e.by !== 'B')) &&
        !spent.has(`${e.by}${e.st}`) &&
        (cfg.rules.bound ? e.rid === req.rid && e.key === req.key : true) &&
        (!cfg.rules.approverOnList || list.includes(e.by)) &&
        (cfg.rules.option !== 'a' || e.by === 'B'),
    )
    if (!decision || !req.rid) continue
    spent.add(`${decision.by}${decision.st}`)
    answered.add(req.rid)
    if (decision.k === 'decline') answer(s, req.rid, 'declined', decision.by)
    else if (decision.k === 'add' && decision.secret)
      answer(s, req.rid, 'added', decision.by, decision.secret)
    else answer(s, req.rid, 'added', decision.by, newSecret(s, 'B'))
  }
  if (!cfg.rules.answerOnce)
    // The defect: a decision is applied again to a request already answered.
    for (const req of entries.filter((e) => e.k === 'request' && e.rid && answered.has(e.rid)))
      for (const d of entries.filter(
        (e) => (e.k === 'approve' || e.k === 'decline') && e.rid === req.rid,
      ))
        if (
          !s.answers.some(
            (a) =>
              a.rid === req.rid &&
              a.onWordOf === d.by &&
              a.result === (d.k === 'decline' ? 'declined' : 'added'),
          )
        )
          answer(
            s,
            req.rid as Q,
            d.k === 'decline' ? 'declined' : 'added',
            d.by,
            d.k === 'approve' ? newSecret(s, 'B') : undefined,
          )
}

/** One mail check by `d`; the maker also fetches what waits at its ask tags. */
export function check(cfg: LinksConfig, s: LinksState, d: D): void {
  const dev = s.devs[d]
  if (!dev) return
  if (d === 'B')
    for (const rid of s.waiting) {
      const unanswered = Object.values(requestsOn(cfg, s, 'B')).filter(
        (r) => r === 'waiting',
      ).length
      write(s, 'B', { k: 'request', rid, key: KEYS[rid] })
      if (cfg.busyAfter !== undefined && unanswered >= cfg.busyAfter) answer(s, rid, 'busy', 'B')
    }
  if (d === 'B') s.waiting = []
  // Every device log in the mail is merged before anything else in it is acted on.
  const before = canon(dev)
  for (const l of s.mail) if (l.pending.includes(d)) dev.log = uniq([...dev.log, ...l.log])
  for (const l of s.mail) {
    if (!l.pending.includes(d)) continue
    l.pending = l.pending.filter((p) => p !== d)
    if (!listOf(s, d).includes(l.from)) continue
    for (const e of l.entries)
      if (!dev.entries.some((h) => canon(h) === canon(e))) dev.entries.push(e)
    for (const e of l.entries) dev.clock = Math.max(dev.clock, e.st)
  }
  if (canon(dev) !== before) dev.dirty = true
  s.mail = s.mail.filter((l) => l.pending.length > 0)
  if (d === 'B') makerActs(cfg, s)
  send(s, d)
}

/** The askers take their answers, from the device the link names only (unless a defect). */
export function askersCheck(cfg: LinksConfig, s: LinksState): void {
  for (const l of s.mail)
    for (const q of l.pending.filter((p): p is Q => p === 'q1' || p === 'q2' || p === 'qx')) {
      l.pending = l.pending.filter((p) => p !== q)
      if (l.kind !== 'answer' || !l.result || (cfg.rules.makerOnly && l.from !== 'B')) continue
      s.askers[q] = uniq([...(s.askers[q] ?? []), `${l.result}:${l.secret ?? ''}:${l.from}`])
    }
  s.mail = s.mail.filter((l) => l.pending.length > 0)
}

/** The pair secret an asker was added on, if it was. */
export function addedOn(s: LinksState, q: Q): string | undefined {
  const added = (s.askers[q] ?? []).find((a) => a.startsWith('added:'))
  return added?.split(':')[1]
}

/** A hostile X reads everything sealed to it at once. */
export function xReads(cfg: LinksConfig, s: LinksState): LinksState {
  if (!cfg.hostile) return s
  // The made-up asker is X: its answers are X's to read.
  for (const l of s.mail) if (l.pending.includes('qx')) l.pending = [...l.pending, 'X']
  for (const l of s.mail)
    if (l.pending.includes('X')) {
      l.pending = l.pending.filter((p) => p !== 'X')
      if (l.secret) s.xHolds = uniq([...s.xHolds, l.secret])
      s.xHolds = uniq([...s.xHolds, ...l.entries.flatMap((e) => (e.secret ? [e.secret] : []))])
    }
  s.mail = s.mail.filter((l) => l.pending.length > 0)
  return s
}
