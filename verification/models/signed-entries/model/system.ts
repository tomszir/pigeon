// Pigeons on different releases signing entries, handing them to each other, reloading into the
// current release, and someone putting each signature they see on other entries. Every history
// up to a small bound is explored, and the invariants of verification/specs/signed-entries.md
// are checked in each state.
import {
  atLeast,
  bytes,
  CURRENT,
  canonical,
  type Entry,
  FIRST_TYPED_TAKER,
  FORMS,
  OTHER_SIGNED,
  RELEASES,
  RULES,
  type Rules,
  releaseOf,
  type Signature,
  sign,
  takes,
  type Writer,
} from './entries.ts'

/** The ids the model's entries use; a test of the code passes its own. */
export interface Ids {
  readonly identity: string
  readonly device: string
  /** The writer a recovery named for epoch 1. */
  readonly writer: string
  readonly author: string
  readonly log: string
  readonly otherLog: string
  /**
   * In each epoch, the signature of its first entry (adding `device` named Phone), which a
   * second entry names as `prev`.
   */
  readonly prev: readonly [string, string]
}

export const MODEL_IDS: Ids = {
  identity: 'I',
  device: 'D',
  writer: 'W',
  author: 'A',
  log: 'L',
  otherLog: 'M',
  prev: ['P0', 'P1'],
}

/** Who signs an entry, with these ids: its author, or its epoch's writer. */
export const writerOf =
  (ids: Ids): Writer =>
  (entry) =>
    entry.kind === 'chat'
      ? entry.fields.author
      : entry.fields.epoch === 0
        ? ids.identity
        : ids.writer

/**
 * The entries the model signs and forges: chat entries in two chats, and device-log entries of
 * each kind in epoch 0 and epoch 1, some differing only in their kind.
 */
export function domain(ids: Ids): Entry[] {
  const chat = (log: string, seq: number, text: string): Entry => ({
    kind: 'chat',
    fields: { log, author: ids.author, seq, lamport: seq, at: 1000 + seq, text },
  })
  const out: Entry[] = [
    chat(ids.log, 1, 'hi'),
    chat(ids.log, 2, 'hi'),
    chat(ids.otherLog, 1, 'hi'),
    chat(ids.log, 1, ''),
  ]
  // Each one a chain could hold, in the shape an entry has (a name for `add` and `name`, none
  // for `remove`): a first entry adding the device, or a second after that one.
  for (const epoch of [0, 1]) {
    const first = { identity: ids.identity, epoch, seq: 1, prev: '', device: ids.device, at: 1000 }
    const second = { ...first, seq: 2, prev: ids.prev[epoch] as string, at: 1001 }
    out.push(
      { kind: 'device', fields: { ...first, kind: 'add', name: 'Phone' } },
      { kind: 'device', fields: { ...second, kind: 'name', name: 'Tablet' } },
      { kind: 'device', fields: { ...second, kind: 'remove' } },
    )
  }
  return out
}

/**
 * What someone might put a signature on: every entry of `domain`, and each device-log entry
 * again with its kind swapped for another and nothing else changed but what that kind's shape
 * asks (a name kept, or dropped for `remove`).
 */
export function forgeries(ids: Ids): Entry[] {
  const out = domain(ids)
  for (const entry of domain(ids)) {
    if (entry.kind !== 'device') continue
    const { name, ...rest } = entry.fields
    for (const kind of ['add', 'name', 'remove'] as const) {
      if (kind === entry.fields.kind) continue
      const named = kind === 'remove' ? {} : { name: name ?? 'Phone' }
      out.push({ kind: 'device', fields: { ...rest, kind, ...named } })
    }
  }
  return out
}

interface Message {
  readonly entry: number
  readonly signature: Signature
  /** The release that signed it. */
  readonly by: string
}

export interface State {
  /** Each Pigeon's release. */
  readonly pigeons: Readonly<Record<string, string>>
  readonly messages: readonly Message[]
  /** "pigeon message" for each hand-over, with whether it was taken. */
  readonly handed: Readonly<Record<string, boolean>>
  readonly signs: number
  readonly reloads: readonly string[]
}

export interface Setup {
  readonly pigeons: Readonly<Record<string, string>>
  readonly signs: number
  /** The entries the Pigeons sign, by their place in `domain`: a chat entry, and a device-log entry in each epoch. */
  readonly signed: readonly number[]
}

export const SETUP: Setup = {
  pigeons: { a: '0.8.1', b: '0.8.3', c: CURRENT },
  signs: 2,
  signed: [0, 4, 7],
}

/**
 * What's wrong with `messages` themselves, by invariant, whoever they're handed to: E1 to E5 hold
 * or fail for a message whatever happened before it, so they're checked over every message any
 * release could sign (`everyMessage`) rather than in each state.
 */
export function checkMessages(
  messages: readonly Message[],
  rules: Rules = RULES,
  ids: Ids = MODEL_IDS,
): [string, string][] {
  const entries = domain(ids)
  const writer = writerOf(ids)
  const broken: [string, string][] = []
  for (const [index, message] of messages.entries()) {
    const entry = entries[message.entry] as Entry
    const name = `m${index} (${entry.kind}, signed on ${message.by})`
    // E1: what the current release signs, every release from the first typed taker on takes.
    if (message.by === CURRENT)
      for (const release of RELEASES)
        if (
          atLeast(release.version, FIRST_TYPED_TAKER) &&
          !takes(release.version, entry, message.signature, writer, rules)
        )
          broken.push(['E1 taken from 0.8.2 on', `${release.version} refuses ${name}`])
    // E2: an entry signed untyped, by any release, the current one still takes.
    if (
      releaseOf(message.by).signs === 'untyped' &&
      !takes(CURRENT, entry, message.signature, writer, rules)
    )
      broken.push(['E2 old entries still verify', `${CURRENT} refuses ${name}`])
    // E3 and E4: the signature, put on any other entry, is taken by no release.
    for (const [other, forged] of forgeries(ids).entries()) {
      // A kind swapped back can be the very entry signed: that's no forgery.
      if (canonical(forged) === canonical(entry)) continue
      for (const release of RELEASES)
        if (takes(release.version, forged, message.signature, writer, rules)) {
          const swapped =
            forged.kind !== entry.kind ||
            (forged.kind === 'device' &&
              entry.kind === 'device' &&
              forged.fields.kind !== entry.fields.kind)
          broken.push([
            swapped ? 'E4 no kind swapped' : 'E3 one meaning',
            `${release.version} takes ${name}'s signature for entry ${other}`,
          ])
        }
    }
  }
  // E3: nothing else Pigeon signs passes as an entry, whoever signed it.
  for (const other of OTHER_SIGNED)
    for (const entry of entries)
      for (const release of RELEASES)
        if (takes(release.version, entry, { by: writer(entry), over: other }, writer, rules))
          broken.push(['E3 one meaning', `${release.version} takes ${other} as an entry`])
  // E5: one byte string per entry and form, the same when read back and written again.
  for (const entry of entries)
    for (const form of FORMS) {
      const once = bytes(entry, form, rules)
      if (canonical(JSON.parse(once)) !== once || bytes(entry, form, rules) !== once)
        broken.push(['E5 one encoding per form', `${entry.kind} ${form} spelled two ways`])
    }
  return broken
}

/** What's wrong with what was handed over in `state`: each Pigeon's verdict as its release gives it. */
export function checkState(state: State): [string, string][] {
  const broken: [string, string][] = []
  for (const [key, taken] of Object.entries(state.handed)) {
    const [pigeon = '', index = ''] = key.split(' ')
    const message = state.messages[Number(index)]
    const version = state.pigeons[pigeon] ?? ''
    if (message === undefined) continue
    if (message.by === CURRENT && atLeast(version, FIRST_TYPED_TAKER) && !taken)
      broken.push(['E1 taken from 0.8.2 on', `${pigeon} on ${version} refused m${index}`])
    if (releaseOf(message.by).signs === 'untyped' && version === CURRENT && !taken)
      broken.push(['E2 old entries still verify', `${pigeon} on ${version} refused m${index}`])
    // L1: a tab from before typed entries refuses the current release's until it reloads.
    if (message.by === CURRENT && !atLeast(version, FIRST_TYPED_TAKER) && taken)
      broken.push(['L1 the limit, as it is', `${pigeon} on ${version} took m${index}`])
  }
  return broken
}

export function initial(setup: Setup = SETUP): State {
  return {
    pigeons: setup.pigeons,
    messages: [],
    handed: {},
    signs: setup.signs,
    reloads: [],
  }
}

/** Every step from `state`, each with its label. */
export function steps(
  state: State,
  rules: Rules = RULES,
  ids: Ids = MODEL_IDS,
  signed: readonly number[] = SETUP.signed,
): [string, State][] {
  const entries = domain(ids)
  const writer = writerOf(ids)
  const out: [string, State][] = []
  const next = (label: string, change: Partial<State>) => {
    const after = { ...state, ...change }
    out.push([label, after])
  }
  for (const [pigeon, version] of Object.entries(state.pigeons)) {
    if (state.signs > 0)
      for (const index of signed) {
        const entry = entries[index] as Entry
        next(`${pigeon} on ${version} signs entry ${index}`, {
          messages: [
            ...state.messages,
            { entry: index, signature: sign(version, entry, writer, rules), by: version },
          ],
          signs: state.signs - 1,
        })
      }
    if (version !== CURRENT && !state.reloads.includes(pigeon))
      next(`${pigeon} reloads into ${CURRENT}`, {
        pigeons: { ...state.pigeons, [pigeon]: CURRENT },
        reloads: [...state.reloads, pigeon],
        // What it refused before, it's handed again after.
        handed: Object.fromEntries(
          Object.entries(state.handed).filter(([key]) => !key.startsWith(`${pigeon} `)),
        ),
      })
    for (const [index, message] of state.messages.entries()) {
      const key = `${pigeon} ${index}`
      if (key in state.handed) continue
      const entry = entries[message.entry] as Entry
      next(`m${index} handed to ${pigeon}`, {
        handed: { ...state.handed, [key]: takes(version, entry, message.signature, writer, rules) },
      })
    }
  }
  return out
}

export interface Explored {
  readonly states: number
  readonly depth: number
  /** What the exploration got to, so a test can tell it didn't pass by never getting there. */
  readonly reached: readonly string[]
  readonly violations: readonly {
    readonly id: string
    readonly message: string
    readonly path: readonly string[]
  }[]
}

/** What a state shows, for `Explored.reached`. */
function flags(state: State): string[] {
  const out: string[] = []
  for (const [key, taken] of Object.entries(state.handed)) {
    const [pigeon = '', index = ''] = key.split(' ')
    const message = state.messages[Number(index)]
    if (message?.by !== CURRENT) continue
    if (!taken) out.push('an old tab refused a current entry')
    if (taken && state.reloads.includes(pigeon)) out.push('a reloaded tab took a current entry')
    if (taken && state.pigeons[pigeon] === '0.8.3') out.push('a 0.8.3 tab took a current entry')
  }
  if (state.messages.some((m) => m.by !== CURRENT) && state.messages.some((m) => m.by === CURRENT))
    out.push('entries signed on old and current releases')
  return out
}

/**
 * Every message any release could sign, each entry of the domain by each release, checked as one
 * state: the invariants that don't depend on history, over the whole domain.
 */
export function everyMessage(rules: Rules = RULES, ids: Ids = MODEL_IDS): State {
  const entries = domain(ids)
  const writer = writerOf(ids)
  const messages = RELEASES.flatMap((release) =>
    entries.map((entry, index) => ({
      entry: index,
      signature: sign(release.version, entry, writer, rules),
      by: release.version,
    })),
  )
  return { ...initial(), messages }
}

/** The messages of `everyMessage`, for `checkMessages`. */
const allMessages = (rules: Rules, ids: Ids): readonly Message[] =>
  everyMessage(rules, ids).messages

/**
 * Every message checked at once, then every state reachable from the start, breadth first, with
 * the first history to each broken invariant.
 */
export function explore(
  rules: Rules = RULES,
  setup: Setup = SETUP,
  ids: Ids = MODEL_IDS,
): Explored {
  const violations: { id: string; message: string; path: readonly string[] }[] = []
  const found = new Set<string>()
  for (const [id, message] of checkMessages(allMessages(rules, ids), rules, ids))
    if (!found.has(id)) {
      found.add(id)
      violations.push({ id, message, path: ['every release signs every entry'] })
    }
  const start = initial(setup)
  const seen = new Map<string, readonly string[]>([[canonical(start), []]])
  let frontier: [State, readonly string[]][] = [[start, []]]
  let depth = 0
  const reached = new Set<string>()
  while (frontier.length > 0) {
    const after: [State, readonly string[]][] = []
    for (const [state, path] of frontier)
      for (const [label, nextState] of steps(state, rules, ids, setup.signed)) {
        const key = canonical({ ...nextState, broken: [] })
        if (seen.has(key)) continue
        const nextPath = [...path, label]
        seen.set(key, nextPath)
        for (const flag of flags(nextState)) reached.add(flag)
        for (const [id, message] of checkState(nextState))
          if (!found.has(id)) {
            found.add(id)
            violations.push({ id, message, path: nextPath })
          }
        after.push([nextState, nextPath])
      }
    if (after.length > 0) depth += 1
    frontier = after
  }
  return { states: seen.size, depth, violations, reached: [...reached].sort() }
}
