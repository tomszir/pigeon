// The chat-history model. B has just added friend F (on device f) and the two have already said
// something to each other in their pair room, which A never saw; A hears of the friendship
// through B's your-data letter. Then anyone writes, letters wait or expire, devices check mail
// in any order, and the friend's device and B may also meet live. Once mail has settled, with
// nobody online at the same time, A must hold every message, once each, in the same order as
// everyone else.
import { canon, copy, uniq } from './canon.ts'
import type { Invariant, Model } from './explore.ts'

type Who = 'A' | 'B' | 'f'
const OWN: readonly Who[] = ['A', 'B']

interface ChatEntry {
  readonly author: Who
  readonly seq: number
  readonly lamport: number
}

interface ChatDevice {
  /** The friendship is on this device, so it has the chat. */
  live: boolean
  /** Entry ids, in the order the chat shows them. */
  chat: string[]
  lamport: number
  seq: number
  /** Per other device of yours, the entries it is known to have or has been sent. */
  sent: Partial<Record<Who, string[]>>
}

interface ChatLetter {
  readonly id: number
  readonly kind: 'friend' | 'letter' | 'copy' | 'history'
  readonly from: Who
  pending: Who[]
  readonly entries: string[]
}

export interface ChatState {
  devs: Record<Who, ChatDevice>
  entries: Record<string, ChatEntry>
  mail: ChatLetter[]
  left: { write: Partial<Record<Who, number>>; expire: number; meet: number }
  nextLetter: number
}

export interface ChatRules {
  /** A letter for a chat this device doesn't have yet is left, and taken once it has. */
  readonly leaveUnknown: boolean
  /** Your devices send each other the chat entries they're not known to have, a page a letter. */
  readonly backfill: boolean
  /** An entry already held is taken once. */
  readonly dedupe: boolean
  /** The chat shows entries by (Lamport time, author, sequence), not by when they arrived. */
  readonly sorted: boolean
}

export const CHAT_DESIGN: ChatRules = {
  leaveUnknown: true,
  backfill: true,
  dedupe: true,
  sorted: true,
}

const idOf = (e: ChatEntry) => `${e.author}${e.seq}`

function order(state: ChatState, ids: readonly string[]): string[] {
  const key = (id: string) => state.entries[id]
  return [...ids].sort((a, b) => {
    const x = key(a)
    const y = key(b)
    if (!x || !y) return 0
    return (
      x.lamport - y.lamport || (x.author < y.author ? -1 : x.author > y.author ? 1 : x.seq - y.seq)
    )
  })
}

function take(rules: ChatRules, state: ChatState, d: Who, ids: readonly string[]): void {
  const dev = state.devs[d]
  for (const id of ids) {
    if (rules.dedupe && dev.chat.includes(id)) continue
    dev.chat.push(id)
    dev.lamport = Math.max(dev.lamport, state.entries[id]?.lamport ?? 0)
  }
  if (rules.sorted) dev.chat = order(state, dev.chat)
}

function letter(
  state: ChatState,
  kind: ChatLetter['kind'],
  from: Who,
  to: Who[],
  entries: string[],
) {
  state.mail.push({ id: state.nextLetter++, kind, from, pending: [...to], entries })
}

const others = (d: Who): Who[] => OWN.filter((o) => o !== d)

/** A new message, sent at this device's next mail check. */
function write(state: ChatState, d: Who): void {
  const dev = state.devs[d]
  dev.lamport += 1
  dev.seq += 1
  const e: ChatEntry = { author: d, seq: dev.seq, lamport: dev.lamport }
  state.entries[idOf(e)] = e
  dev.chat.push(idOf(e))
}

/** Sends `to` the entries in `ids` it isn't known to have, and notes them as sent. */
function sendMissing(state: ChatState, d: Who, to: Who, kind: ChatLetter['kind'], ids: string[]) {
  const dev = state.devs[d]
  const missing = ids.filter((id) => !(dev.sent[to] ?? []).includes(id))
  if (missing.length === 0) return
  // History goes a page a letter; a letter to a friend, or its copy, carries a batch.
  if (kind === 'history') for (const id of missing) letter(state, kind, d, [to], [id])
  else letter(state, kind, d, [to], missing)
  dev.sent[to] = uniq([...(dev.sent[to] ?? []), ...missing])
}

/**
 * One mail check: take what can be taken, then send what others aren't known to have. A letter to
 * a friend carries only this device's own entries, with a copy for your other devices; with
 * history on, your devices send each other every entry the other lacks, whoever wrote it.
 */
function check(rules: ChatRules, state: ChatState, d: Who): void {
  const dev = state.devs[d]
  for (const l of state.mail) {
    if (!l.pending.includes(d)) continue
    if (l.kind === 'friend') {
      dev.live = true
      l.pending = l.pending.filter((p) => p !== d)
      continue
    }
    if (!dev.live && rules.leaveUnknown) continue
    l.pending = l.pending.filter((p) => p !== d)
    if (!dev.live) continue
    take(rules, state, d, l.entries)
    // What another device sent, it has.
    dev.sent[l.from] = uniq([...(dev.sent[l.from] ?? []), ...l.entries])
  }
  state.mail = state.mail.filter((l) => l.pending.length > 0)
  if (!dev.live) return
  const own = dev.chat.filter((id) => state.entries[id]?.author === d)
  if (d === 'f') {
    for (const o of OWN) sendMissing(state, d, o, 'letter', own)
    return
  }
  // Today a copy goes only with a letter to the friend; a message they had live has none.
  const mailed = own.filter((id) => !(dev.sent.f ?? []).includes(id))
  sendMissing(state, d, 'f', 'letter', own)
  for (const o of others(d))
    if (rules.backfill) sendMissing(state, d, o, 'history', dev.chat)
    else sendMissing(state, d, o, 'copy', mailed)
}

/** B and f meet live in their pair room and catch each other up. */
function meetLive(rules: ChatRules, state: ChatState): void {
  const b = state.devs.B
  const f = state.devs.f
  take(
    rules,
    state,
    'B',
    f.chat.filter((id) => !b.chat.includes(id)),
  )
  take(
    rules,
    state,
    'f',
    b.chat.filter((id) => !f.chat.includes(id)),
  )
}

function initial(writes: Partial<Record<Who, number>>, expire: number, meet: number): ChatState {
  const device = (live: boolean): ChatDevice => ({ live, chat: [], lamport: 0, seq: 0, sent: {} })
  const s: ChatState = {
    devs: { A: device(false), B: device(true), f: device(true) },
    entries: {},
    mail: [],
    left: { write: { ...writes }, expire, meet },
    nextLetter: 1,
  }
  // Said live in the pair room before A heard of the friendship: no letter carries these.
  write(s, 'B')
  write(s, 'f')
  meetLive(CHAT_DESIGN, s)
  // One device of a friend having caught up counts as all of theirs having it.
  s.devs.B.sent = { f: ['B1', 'f1'] }
  s.devs.f.sent = { A: ['B1', 'f1'], B: ['B1', 'f1'] }
  letter(s, 'friend', 'B', ['A'], [])
  return s
}

function steps(rules: ChatRules, state: ChatState): (readonly [string, ChatState])[] {
  const out: (readonly [string, ChatState])[] = []
  for (const d of ['A', 'B', 'f'] as const) {
    if ((state.left.write[d] ?? 0) > 0 && state.devs[d].live) {
      const next = copy(state)
      next.left.write[d] = (next.left.write[d] ?? 0) - 1
      write(next, d)
      out.push([`${d} writes`, next])
    }
    const next = copy(state)
    check(rules, next, d)
    if (canon(next) !== canon(state)) out.push([`${d} checks mail`, next])
  }
  // Your-data letters are put again until they're taken (the your-data model checks that), so
  // only chat letters expire here.
  if (state.left.expire > 0)
    for (const l of state.mail.filter((m) => m.kind !== 'friend')) {
      const next = copy(state)
      next.left.expire -= 1
      next.mail = next.mail.filter((m) => m.id !== l.id)
      // A letter that expired unreceipted was never heard: its entries aren't known to be there.
      for (const p of l.pending)
        next.devs[l.from].sent[p] = (next.devs[l.from].sent[p] ?? []).filter(
          (id) => !l.entries.includes(id),
        )
      out.push([`#${l.id} (${l.kind} from ${l.from}) expires`, next])
    }
  if (state.left.meet > 0) {
    const next = copy(state)
    next.left.meet -= 1
    meetLive(rules, next)
    if (canon(next) !== canon(state)) out.push(['B and f meet live', next])
  }
  return out
}

function settle(rules: ChatRules, state: ChatState): ChatState {
  const s = copy(state)
  for (let round = 0; round < 30; round++) {
    const before = canon(s)
    for (const d of ['A', 'B', 'f'] as const) check(rules, s, d)
    if (canon(s) === before) break
  }
  return s
}

const all: readonly Who[] = ['A', 'B', 'f']

const noDuplicates: Invariant<ChatState> = {
  id: 'H2 no message twice',
  check: (s) => {
    for (const d of all) {
      const twice = s.devs[d].chat.find((id, i, list) => list.indexOf(id) !== i)
      if (twice) return `${d} shows ${twice} twice`
    }
    return undefined
  },
}

const stableOrder: Invariant<ChatState> = {
  id: 'H3 order is stable',
  check: (s) => {
    for (const d of all) {
      const chat = s.devs[d].chat
      if (canon(chat) !== canon(order(s, chat))) return `${d} shows ${chat.join(',')}`
    }
    return undefined
  },
}

const noLoss: Invariant<ChatState> = {
  id: 'H1 no message lost',
  check: (s) => {
    for (const d of all) {
      const missing = Object.keys(s.entries).filter((id) => !s.devs[d].chat.includes(id))
      if (missing.length) return `${d} lacks ${missing.join(',')}`
    }
    return undefined
  },
}

const same: Invariant<ChatState> = {
  id: 'H4 every device shows the same chat',
  check: (s) => {
    const [a, ...rest] = all.map((d) => canon(s.devs[d].chat))
    return rest.every((c) => c === a)
      ? undefined
      : all.map((d) => `${d}: ${s.devs[d].chat}`).join('; ')
  },
}

export interface ChatConfig {
  readonly name: string
  readonly writes: Partial<Record<Who, number>>
  readonly expire: number
  readonly meet: number
  readonly rules: ChatRules
}

export const CHAT: ChatConfig = {
  name: 'chat: history on a device that learns of a friend',
  writes: { A: 1, B: 1, f: 1 },
  expire: 1,
  meet: 0,
  rules: CHAT_DESIGN,
}

/** The same with B and f meeting live as well, with fewer messages. */
export const CHAT_LIVE: ChatConfig = {
  name: 'chat: history, with the friend also met live',
  writes: { B: 1, f: 1 },
  expire: 1,
  meet: 1,
  rules: CHAT_DESIGN,
}

export function chatModel(cfg: ChatConfig): Model<ChatState> {
  return {
    name: cfg.name,
    init: initial(cfg.writes, cfg.expire, cfg.meet),
    steps: (s) => steps(cfg.rules, s),
    safety: [noDuplicates, stableOrder],
    settle: (s) => settle(cfg.rules, s),
    settled: [noLoss, same],
    flags: (s) => [
      ...(s.devs.A.live ? ['A has the friend'] : []),
      ...(s.devs.A.chat.length ? ['A shows messages'] : []),
      ...(s.mail.some((l) => l.kind === 'history') ? ['history page in the mail'] : []),
      ...(s.devs.A.lamport > 2 ? ['A wrote after catching up'] : []),
    ],
  }
}

export const CHAT_DEFECTS: readonly { name: string; rule: keyof ChatRules; caughtBy: string }[] = [
  { name: 'no history between your devices', rule: 'backfill', caughtBy: 'H1 no message lost' },
  { name: 'an entry taken twice', rule: 'dedupe', caughtBy: 'H2 no message twice' },
  { name: 'shown in arrival order', rule: 'sorted', caughtBy: 'H3 order is stable' },
]
