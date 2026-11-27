// How the your-data model's letters are made and taken: sealed to a list, carrying the sender's
// device log, entries and pair secrets; opened by merging the log first, then counting the rest
// only from a device on the list that results.
import { uniq } from './canon.ts'
import {
  byEntry,
  type DataConfig,
  type DataState,
  type Dev,
  type Entry,
  entryKey,
  everKnown,
  type FriendId,
  type Letter,
  type LetterKind,
  type LogEvent,
  listOf,
  REMOVED,
  type Secret,
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

export function newLetter(
  cfg: DataConfig,
  state: DataState,
  kind: LetterKind,
  from: Dev,
  to: readonly string[],
  entries: readonly Entry[],
  secrets: Partial<Record<FriendId, Secret>>,
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
    secrets: { ...secrets },
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

/** Takes the later round of each pair secret. A device never moves back to an earlier one. */
export function takeSecrets(
  mine: Partial<Record<FriendId, Secret>>,
  incoming: Partial<Record<FriendId, Secret>>,
): { secrets: Partial<Record<FriendId, Secret>>; changed: boolean } {
  const out = { ...mine }
  let changed = false
  for (const fr of Object.keys(incoming) as FriendId[]) {
    const theirs = incoming[fr]
    const own = out[fr]
    if (theirs && (!own || theirs.round > own.round)) {
      out[fr] = theirs
      changed = true
    }
  }
  return { secrets: out, changed }
}

const secretIds = (secrets: Partial<Record<FriendId, Secret>>): string[] =>
  Object.values(secrets).flatMap((s) => (s ? [s.id] : []))

/** Device `r` takes letter `letter` (its index in the mail). */
export function deliver(cfg: DataConfig, state: DataState, index: number, r: string): void {
  const letter = state.mail[index]
  if (!letter) return
  letter.pending = letter.pending.filter((p) => p !== r)
  if (r === 'F' || r === 'G') {
    const friend = state.friends[r]
    const secret = letter.secrets[r]
    if (!friend || !secret) return
    friend.learned = uniq([...friend.learned, secret.id])
    if (secret.round > friend.secret.round) friend.secret = secret
    return
  }
  const d = r as Dev
  const dev = state.devs[d]
  if (!dev) return
  if (d === REMOVED && cfg.hostile) {
    // A hostile removed device reads whatever was sealed to it, and keeps it.
    dev.learned = uniq([...dev.learned, ...secretIds(letter.secrets)])
    return
  }
  if (d === REMOVED && dev.log.includes('rmX')) return
  const before = dev.log.length
  dev.log = uniq([...dev.log, ...letter.log])
  let changed = dev.log.length !== before
  if (cfg.rules.senderOnList && !listOf(state, d).includes(letter.from)) {
    if (changed) dev.dirty = true
    return
  }
  if (!cfg.rules.perEntry && letter.entries.some((e) => e.op.k === 'future')) {
    if (changed) dev.dirty = true
    return
  }
  const entries = takeEntries(cfg, dev.entries, letter.entries)
  dev.entries = entries.entries
  for (const e of letter.entries) dev.clock = Math.max(dev.clock, e.st)
  const secrets = takeSecrets(dev.secrets, letter.secrets)
  dev.secrets = secrets.secrets
  dev.learned = uniq([...dev.learned, ...secretIds(letter.secrets)])
  changed = changed || entries.changed || secrets.changed
  if (changed) dev.dirty = true
}

/** Two devices in the self room: each merges the other's log, then takes from it if it counts. */
export function meet(cfg: DataConfig, state: DataState, a: Dev, b: Dev): void {
  const da = state.devs[a]
  const db = state.devs[b]
  if (!da || !db) return
  const hides = (d: Dev) => d === REMOVED && cfg.hostile
  const logA = hides(a) ? da.log.filter((e) => e !== 'rmX') : da.log
  const logB = hides(b) ? db.log.filter((e) => e !== 'rmX') : db.log
  const merged = uniq([...logA, ...logB])
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
      dst.learned = uniq([...dst.learned, ...secretIds(src.secrets)])
      return
    }
    const entries = takeEntries(cfg, dst.entries, src.entries)
    const secrets = takeSecrets(dst.secrets, src.secrets)
    dst.entries = entries.entries
    dst.secrets = secrets.secrets
    for (const e of src.entries) dst.clock = Math.max(dst.clock, e.st)
    dst.learned = uniq([...dst.learned, ...secretIds(src.secrets)])
    if (entries.changed || secrets.changed) dst.dirty = true
  }
  pass(a, b)
  pass(b, a)
}
