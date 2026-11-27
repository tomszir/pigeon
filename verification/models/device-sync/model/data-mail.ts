// How the your-data model's letters are made and taken. A letter is sealed to a list and carries
// the sender's device log, the entries the recipients aren't known to hold, the pair-secret
// proposals, and the sender's summary. Whoever opens it merges the log first, and counts the rest
// only from a device on the list that results.
import { uniq } from './canon.ts'
import { friendTakes } from './data-friend.ts'
import { dropEnded, propIds, takeProps } from './data-secrets.ts'
import {
  byEntry,
  type DataConfig,
  type DataState,
  type Dev,
  type Entry,
  entryKey,
  everKnown,
  type Letter,
  type LetterKind,
  type LogEvent,
  listOf,
  type Proposal,
  REMOVED,
  type Summary,
} from './data-state.ts'

/** Whom a letter from `d` is sealed to. */
export function sealTo(cfg: DataConfig, state: DataState, d: Dev): Dev[] {
  const to = cfg.rules.sealToList ? listOf(state, d) : everKnown(state, d)
  return to.filter((other) => other !== d)
}

/** The list a device whose log holds `log` would seal to. */
export function listFor(state: DataState, log: readonly LogEvent[], from: Dev): Dev[] {
  return (Object.keys(state.devs) as Dev[])
    .filter((d) => d !== 'C' || log.includes('addC'))
    .filter((d) => d !== REMOVED || !log.includes('rmX'))
    .filter((d) => d !== from)
    .sort()
}

/**
 * Per author, the highest entry number held with none missing below it and, under the design, a
 * digest of those entries' signatures. Two devices holding different entries under one number
 * have the same number and different digests, so each sends the other that author's entries.
 */
export function summaryOf(cfg: DataConfig, entries: readonly Entry[]): Summary {
  const out: Summary = {}
  for (const by of uniq(entries.map((e) => e.by))) {
    const mine = entries.filter((e) => e.by === by).sort(byEntry)
    let n = 0
    while (mine.some((e) => e.n === n + 1)) n++
    const digest = cfg.rules.forkDigest ? digestOf(mine, n) : ''
    out[by] = { n, digest }
  }
  return out
}

const digestOf = (entries: readonly Entry[], n: number): string =>
  entries
    .filter((e) => e.n <= n)
    .map((e) => e.sig)
    .join(',')

/** The entries a device holding `held` sends one whose summary is `theirs`. */
export function toSend(
  cfg: DataConfig,
  held: readonly Entry[],
  theirs: Summary | undefined,
): Entry[] {
  if (!theirs) return [...held]
  return held.filter((e) => {
    const them = theirs[e.by]
    if (!them || e.n > them.n) return true
    if (!cfg.rules.forkDigest) return false
    // A device ahead of this one checks the shorter prefix itself, so nothing is resent to it.
    const ours = summaryOf(cfg, held)[e.by]
    if (ours && them.n > ours.n) return false
    const mine = held.filter((h) => h.by === e.by)
    return digestOf(mine, them.n) !== them.digest
  })
}

export function newLetter(
  cfg: DataConfig,
  state: DataState,
  kind: LetterKind,
  from: Dev,
  to: readonly string[],
  entries: readonly Entry[],
  props: Readonly<Record<string, readonly Proposal[]>>,
  put: boolean,
): Letter {
  const dev = state.devs[from]
  const log = dev ? [...dev.log] : []
  const letter: Letter = {
    id: state.nextLetter++,
    kind,
    from,
    to: uniq(to),
    pending: uniq(to),
    lost: [],
    put,
    knew: log.includes('rmX'),
    sealedWith: log,
    log: cfg.rules.logFirst ? log : [],
    entries: [...entries],
    props: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, [...v]])),
    summary: dev ? summaryOf(cfg, dev.entries) : {},
  }
  state.mail.push(letter)
  return letter
}

/**
 * Adds incoming entries to those held. Two different entries with one author and number (only a
 * device that signs both can make them) are settled by the lower signature, so every device
 * keeps the same one whatever order they came in.
 */
export function takeEntries(
  cfg: DataConfig,
  held: readonly Entry[],
  incoming: readonly Entry[],
): { entries: Entry[]; changed: boolean } {
  const out = [...held]
  let changed = false
  for (const e of incoming) {
    const at = out.findIndex((h) => entryKey(h) === entryKey(e))
    if (at < 0) {
      out.push(e)
      changed = true
    } else if (out[at]?.sig !== e.sig && cfg.rules.lowerSigWins && e.sig < (out[at]?.sig ?? '')) {
      out[at] = e
      changed = true
    }
  }
  return { entries: cfg.rules.stampOrder ? out.sort(byEntry) : out, changed }
}

/** Device `r` takes letter `index` of the mail. */
export function deliver(cfg: DataConfig, state: DataState, index: number, r: string): void {
  const letter = state.mail[index]
  if (!letter) return
  letter.pending = letter.pending.filter((p) => p !== r)
  if (r === 'F' || r === 'G') {
    friendTakes(cfg, state, letter, r)
    return
  }
  const d = r as Dev
  const dev = state.devs[d]
  if (!dev) return
  if (letter.kind === 'friend-rekey' && !(d === REMOVED && cfg.hostile)) {
    // A friend's proposal: counted by the proposal rules, whatever your list says of the sender.
    dev.log = uniq([...dev.log, ...letter.log])
    if (takeProps(state, d, letter.props)) dev.dirty = true
    return
  }
  if (d === REMOVED && cfg.hostile) {
    // A hostile removed device reads whatever was sealed to it, and keeps it.
    dev.learned = uniq([...dev.learned, ...propIds(letter.props)])
    return
  }
  if (d === REMOVED && dev.log.includes('rmX')) return
  const before = dev.log.length
  dev.log = uniq([...dev.log, ...letter.log])
  let changed = dev.log.length !== before
  if (cfg.rules.senderOnList && !listOf(state, d).includes(letter.from as Dev)) {
    if (changed) dev.dirty = true
    return
  }
  if (!cfg.rules.perEntry && letter.entries.some((e) => e.op.k === 'future')) {
    if (changed) dev.dirty = true
    return
  }
  dev.known[letter.from as Dev] = letter.summary
  const entries = takeEntries(cfg, dev.entries, letter.entries)
  // A sender that lacks something this device holds is sent it at this device's next letter.
  if (toSend(cfg, entries.entries, letter.summary).length > 0) changed = true
  dev.entries = entries.entries
  const props = takeProps(state, d, letter.props)
  changed = changed || entries.changed || props
  dropEnded(cfg.rules, state, d)
  if (changed) dev.dirty = true
}

/**
 * Two devices in the self room: each merges the other's log, then, if the other is on its list,
 * swaps summaries and takes what it lacks.
 */
export function meet(cfg: DataConfig, state: DataState, a: Dev, b: Dev): void {
  const da = state.devs[a]
  const db = state.devs[b]
  if (!da || !db) return
  const hides = (d: Dev) => d === REMOVED && cfg.hostile
  const logA = hides(a) ? da.log.filter((e) => e !== 'rmX') : da.log
  const logB = hides(b) ? db.log.filter((e) => e !== 'rmX') : db.log
  const merged = uniq([...logA, ...logB])
  const summaries = { [a]: summaryOf(cfg, da.entries), [b]: summaryOf(cfg, db.entries) }
  const pass = (from: Dev, to: Dev) => {
    const src = state.devs[from]
    const dst = state.devs[to]
    if (!src || !dst) return
    if (!hides(to)) {
      const before = dst.log.length
      dst.log = merged
      if (dst.log.length !== before) dst.dirty = true
    }
    if (!listOf(state, to).includes(from) || !listOf(state, from).includes(to)) return
    if (hides(to)) {
      dst.learned = uniq([...dst.learned, ...propIds(src.props)])
      return
    }
    const sent = toSend(cfg, src.entries, summaries[to])
    const entries = takeEntries(cfg, dst.entries, sent)
    dst.entries = entries.entries
    dst.known[from] = summaries[from] ?? {}
    const props = takeProps(state, to, src.props)
    if (entries.changed || props) dst.dirty = true
  }
  pass(a, b)
  pass(b, a)
}
