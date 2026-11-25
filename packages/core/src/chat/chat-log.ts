// A chat as signed append-only logs, one per author. Peers trade summaries of
// the highest contiguous sequence they hold per author and send each other what's missing; the
// view is the union sorted by Lamport time.
import { base32DecodeExact, base32Encode } from '../encoding/bytes.ts'
import { canonicalBytes } from '../encoding/canonical.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import type { PeerId } from '../identity/identity.ts'

/** Longest message, in UTF-16 units: a screenful, and well inside one 64 KB envelope. */
export const MAX_TEXT_LENGTH = 4000

export interface LogEntry {
  readonly author: PeerId
  /** 1, 2, 3... per author, with no gaps. */
  readonly seq: number
  readonly lamport: number
  /** The author's clock in ms, for display only; ordering never trusts it. */
  readonly at: number
  readonly text: string
  /** base32 signature over the entry and the log it belongs to. */
  readonly sig: string
}

export interface ChatLog {
  /** The room name, signed into every entry so an entry can't be replayed into another chat. */
  readonly id: string
  /** Sorted by (lamport, author, seq). */
  readonly entries: readonly LogEntry[]
}

/** Per author, the highest seq held with nothing missing below it. */
export type LogSummary = Readonly<Record<PeerId, number>>

export const emptyLog = (id: string): ChatLog => ({ id, entries: [] })

const signedBytes = (log: string, entry: Omit<LogEntry, 'sig'>): Uint8Array =>
  canonicalBytes({
    log,
    author: entry.author,
    seq: entry.seq,
    lamport: entry.lamport,
    at: entry.at,
    text: entry.text,
  })

const compare = (a: LogEntry, b: LogEntry): number =>
  a.lamport - b.lamport || (a.author < b.author ? -1 : a.author > b.author ? 1 : a.seq - b.seq)

export function summarize(log: ChatLog): LogSummary {
  const seqs = new Map<PeerId, Set<number>>()
  for (const entry of log.entries) {
    const set = seqs.get(entry.author) ?? new Set<number>()
    set.add(entry.seq)
    seqs.set(entry.author, set)
  }
  const summary: Record<PeerId, number> = {}
  for (const [author, set] of seqs) {
    let high = 0
    while (set.has(high + 1)) high += 1
    summary[author] = high
  }
  return summary
}

/** What `log` holds that a peer with `theirs` lacks, oldest first. */
export function missingFrom(log: ChatLog, theirs: LogSummary): readonly LogEntry[] {
  return log.entries.filter((entry) => entry.seq > (theirs[entry.author] ?? 0))
}

/** Signs and appends a message by `signer`. */
export async function appendMessage(
  log: ChatLog,
  signer: Signer,
  text: string,
  at: number,
): Promise<{ log: ChatLog; entry: LogEntry }> {
  const seq = (summarize(log)[signer.id] ?? 0) + 1
  const lamport = log.entries.reduce((high, entry) => Math.max(high, entry.lamport), 0) + 1
  const unsigned = { author: signer.id, seq, lamport, at, text }
  const sig = base32Encode(await signer.sign(signedBytes(log.id, unsigned)))
  const entry: LogEntry = { ...unsigned, sig }
  return { log: { ...log, entries: [...log.entries, entry].sort(compare) }, entry }
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Shape check for an entry that arrived over the wire. Signatures are checked separately. */
export function isLogEntry(value: unknown): value is LogEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry['author'] === 'string' &&
    isCount(entry['seq']) &&
    (entry['seq'] as number) >= 1 &&
    isCount(entry['lamport']) &&
    isCount(entry['at']) &&
    typeof entry['text'] === 'string' &&
    (entry['text'] as string).length <= MAX_TEXT_LENGTH &&
    typeof entry['sig'] === 'string'
  )
}

export async function verifyEntry(crypto: Crypto, log: string, entry: LogEntry): Promise<boolean> {
  const sig = base32DecodeExact(entry.sig)
  if (!sig.ok) return false
  return crypto.verify(entry.author, sig.value, signedBytes(log, entry))
}

/**
 * Adds entries that verify, are by one of `authors` (or that `authors` takes), and aren't
 * already held. A second, different entry for a seq already held is dropped: first seen wins.
 */
export async function mergeEntries(
  crypto: Crypto,
  log: ChatLog,
  incoming: readonly LogEntry[],
  authors: ReadonlySet<PeerId> | ((entry: LogEntry) => boolean),
): Promise<ChatLog> {
  const takes =
    typeof authors === 'function' ? authors : (entry: LogEntry) => authors.has(entry.author)
  const held = new Set(log.entries.map((entry) => `${entry.author}/${entry.seq}`))
  const added: LogEntry[] = []
  for (const entry of incoming) {
    const key = `${entry.author}/${entry.seq}`
    if (held.has(key) || !takes(entry)) continue
    if (!(await verifyEntry(crypto, log.id, entry))) continue
    held.add(key)
    added.push(entry)
  }
  if (added.length === 0) return log
  return { ...log, entries: [...log.entries, ...added].sort(compare) }
}

/** Splits entries into `log-entries` batches whose entries total at most `maxBytes`. */
export function batchEntries(
  entries: readonly LogEntry[],
  maxBytes: number,
): readonly (readonly LogEntry[])[] {
  const batches: LogEntry[][] = []
  let batch: LogEntry[] = []
  let size = 0
  for (const entry of entries) {
    const bytes = canonicalBytes({ ...entry }).length
    if (batch.length > 0 && size + bytes > maxBytes) {
      batches.push(batch)
      batch = []
      size = 0
    }
    batch.push(entry)
    size += bytes
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}
