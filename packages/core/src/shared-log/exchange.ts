// Deciding what a `mail:sync` letter carries, and to whom it's due: the same code whether it runs
// in the Messenger or in the model-based test.
//
// Per other device, a device keeps the summary that device last sent, the entries it has already
// carried to it since that summary changed, and its own summary as it last told it. A letter is
// due when some device lacks an entry not already carried to it, or when this device's summary
// has news for one that isn't known to hold the same. Carried entries aren't sent again, so a
// summary gone stale never fills a letter with what the other already holds, and a letter too big
// for one page goes on with the next. That holds because no letter takes another's place and the
// outbox puts each again until it's taken. Only a summary that holds less than the one before
// (a device that lost what it had) makes what was carried be forgotten and worked out again.
//
// A device that takes a letter whose summary shows the sender holds more than it now does answers
// with its own summary, even if it told the sender that summary before, so the sender learns what
// it lacks. Two devices holding the same entries send each other nothing.
import { canonicalJson, type Json } from '../encoding/canonical.ts'
import type { Crypto } from '../identity/crypto.ts'
import type { PeerId } from '../identity/identity.ts'
import type { SharedEntry } from './entry.ts'
import {
  batchShared,
  inTurn,
  missingShared,
  type SharedLog,
  type SharedSummary,
  summarizeShared,
  summaryOf,
} from './log.ts'
import { MAX_SYNC_ENTRIES } from './sync.ts'

/** The most entries' bytes one letter carries, leaving room for the device log and summary. */
export const SYNC_LETTER_BYTES = 30_000

/** What a device keeps about another of your devices, to decide what to mail it. */
export interface PeerSync {
  /** The summary it last sent, if any. */
  readonly known: SharedSummary | undefined
  /** Entries already carried to it since that summary changed. */
  readonly carried: ReadonlySet<string>
  /** This device's summary as it last told it, or undefined when it's owed an answer. */
  readonly told: string | undefined
}

export const newPeer = (known?: SharedSummary): PeerSync => ({
  known,
  carried: new Set(),
  told: undefined,
})

const keyOf = (entry: SharedEntry): string => `${entry.device}/${entry.n}/${entry.sig}`
const spelled = (summary: SharedSummary | undefined): string | undefined =>
  summary === undefined ? undefined : canonicalJson(summary as unknown as Json)

/**
 * Another device's summary arrived. `behind`: it holds more than this device does now, so it's
 * owed an answer whatever it was told before.
 */
export function heardFrom(
  peer: PeerSync | undefined,
  summary: SharedSummary,
  behind: boolean,
): PeerSync {
  const before = peer?.known ?? {}
  const lost = Object.entries(before).some(
    ([device, held]) => (summaryOf(summary, device)?.n ?? 0) < held.n,
  )
  return {
    known: summary,
    carried: lost || peer === undefined ? new Set() : peer.carried,
    told: behind ? undefined : peer?.told,
  }
}

export interface Letter {
  readonly entries: readonly SharedEntry[]
  readonly summary: SharedSummary
  /** What each device keeps once the letter is queued, and only then. */
  readonly peers: ReadonlyMap<PeerId, PeerSync>
  /** Entries were left for a later letter. */
  readonly more: boolean
}

/**
 * The letter due to `peers`, your other devices that read `mail:sync`, or undefined when none is.
 * Its entries are each device's in turn, those in `listed` (your devices on the list) first, up
 * to `limits`.
 */
export async function planLetter(
  crypto: Crypto,
  log: SharedLog,
  peers: ReadonlyMap<PeerId, PeerSync>,
  listed: ReadonlySet<PeerId>,
  limits: { readonly entries: number; readonly bytes: number } = {
    entries: MAX_SYNC_ENTRIES,
    bytes: SYNC_LETTER_BYTES,
  },
): Promise<Letter | undefined> {
  const summary = await summarizeShared(crypto, log)
  const ours = spelled(summary)
  const wanted = new Map<string, SharedEntry>()
  const lacking = new Map<PeerId, ReadonlySet<string>>()
  let due = false
  for (const [device, peer] of peers) {
    const lack = (await missingShared(crypto, log, peer.known)).filter(
      (entry) => !peer.carried.has(keyOf(entry)),
    )
    lacking.set(device, new Set(lack.map(keyOf)))
    for (const entry of lack) wanted.set(keyOf(entry), entry)
    const news = peer.told !== ours && log.entries.length > 0 && spelled(peer.known) !== ours
    if (lack.length > 0 || news) due = true
  }
  if (!due) return undefined
  const ordered = inTurn(
    log.entries.filter((entry) => wanted.has(keyOf(entry))),
    listed,
  )
  const [page = []] = batchShared(ordered.slice(0, limits.entries), limits.bytes)
  const sent = page.map(keyOf)
  const next = new Map<PeerId, PeerSync>()
  for (const [device, peer] of peers) {
    const lack = lacking.get(device) ?? new Set()
    next.set(device, {
      known: peer.known,
      carried: new Set([...peer.carried, ...sent.filter((key) => lack.has(key))]),
      told: ours,
    })
  }
  return { entries: page, summary, peers: next, more: page.length < ordered.length }
}
