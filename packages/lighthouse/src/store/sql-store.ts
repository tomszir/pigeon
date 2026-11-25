// A MailStore over SQL, shared by the runners (decision 0037): the Node Lighthouse runs it on
// node:sqlite, the Worker on its Durable Object's SQLite. Each hands in a SqlDatabase, the one
// call both have: run a statement with values, get rows back and how many it changed.
import type { DropOutcome, ListedPage, MailStore, StoredBlob } from './store.ts'

export type SqlValue = string | number | null

export interface SqlDatabase {
  /** Runs one statement. Every value is bound, never spliced into the text. */
  exec(
    query: string,
    ...values: SqlValue[]
  ): {
    readonly rows: readonly Readonly<Record<string, SqlValue>>[]
    readonly changes: number
  }
}

/**
 * Values bound in one statement at most. Durable Objects allow 100; staying under it keeps a
 * `list` of many tags to several small queries.
 */
export const MAX_BOUND_VALUES = 90

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS blobs (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    tag TEXT NOT NULL,
    blob TEXT NOT NULL,
    size INTEGER NOT NULL,
    cost INTEGER NOT NULL,
    expires INTEGER NOT NULL,
    drops TEXT NOT NULL,
    used TEXT NOT NULL DEFAULT '[]'
  )`,
  'CREATE INDEX IF NOT EXISTS blobs_by_tag ON blobs (tag, seq)',
  'CREATE INDEX IF NOT EXISTS blobs_by_expiry ON blobs (expires)',
]

const num = (value: SqlValue | undefined): number => Number(value ?? 0)
const text = (value: SqlValue | undefined): string => String(value ?? '')

const toBlob = (row: Readonly<Record<string, SqlValue>>): StoredBlob => ({
  id: text(row['id']),
  tag: text(row['tag']),
  blob: text(row['blob']),
  size: num(row['size']),
  cost: num(row['cost']),
  expires: num(row['expires']),
  drops: JSON.parse(text(row['drops'])) as string[],
  used: JSON.parse(text(row['used'])) as string[],
  seq: num(row['seq']),
})

/**
 * A MailStore on `db`, making its table if there isn't one. Every method runs its statements
 * with no await between them, so on one connection no other call comes between a check and the
 * write that follows it.
 */
export function createSqlStore(db: SqlDatabase): MailStore {
  for (const statement of SCHEMA) db.exec(statement)
  const live = (id: string, now: number) =>
    db.exec('SELECT * FROM blobs WHERE id = ? AND expires > ?', id, now).rows[0]

  return {
    async put(blob, now) {
      const held = db.exec('SELECT expires FROM blobs WHERE id = ?', blob.id).rows[0]
      if (held !== undefined && num(held['expires']) > now) return 'exists'
      // Expired but not swept: replaced, with a new seq, so it lists again. AUTOINCREMENT means
      // a seq is never given twice, even after the highest row is deleted.
      if (held !== undefined) db.exec('DELETE FROM blobs WHERE id = ?', blob.id)
      db.exec(
        'INSERT INTO blobs (id, tag, blob, size, cost, expires, drops) VALUES (?, ?, ?, ?, ?, ?, ?)',
        blob.id,
        blob.tag,
        blob.blob,
        blob.size,
        blob.cost,
        blob.expires,
        JSON.stringify(blob.drops),
      )
      return 'stored'
    },
    async list(tags, cursor, limit, now): Promise<ListedPage> {
      // In chunks under the bound-value limit, each the first limit + 1 rows past the cursor,
      // merged in seq order: the page is the same as one query over every tag would give.
      const unique = [...new Set(tags)]
      const size = MAX_BOUND_VALUES - 3
      const rows: Readonly<Record<string, SqlValue>>[] = []
      for (let at = 0; at < unique.length; at += size) {
        const chunk = unique.slice(at, at + size)
        const marks = chunk.map(() => '?').join(', ')
        rows.push(
          ...db.exec(
            `SELECT id, tag, size, seq FROM blobs WHERE tag IN (${marks}) AND seq > ? AND expires > ? ORDER BY seq LIMIT ?`,
            ...chunk,
            cursor,
            now,
            limit + 1,
          ).rows,
        )
      }
      rows.sort((a, b) => num(a['seq']) - num(b['seq']))
      const page = rows.slice(0, limit)
      const last = page.at(-1)
      return {
        items: page.map((row) => ({
          id: text(row['id']),
          tag: text(row['tag']),
          size: num(row['size']),
        })),
        cursor: last === undefined ? cursor : num(last['seq']),
        more: rows.length > limit,
      }
    },
    async get(id, now) {
      const row = live(id, now)
      return row === undefined ? undefined : toBlob(row)
    },
    async useDrop(id, hash, now): Promise<DropOutcome> {
      const row = live(id, now)
      if (row === undefined) return { kind: 'unknown' }
      const blob = toBlob(row)
      if (!blob.drops.includes(hash) || blob.used.includes(hash)) return { kind: 'wrong' }
      const used = [...blob.used, hash]
      const remaining = blob.drops.length - used.length
      if (remaining === 0) db.exec('DELETE FROM blobs WHERE id = ?', id)
      else db.exec('UPDATE blobs SET used = ? WHERE id = ?', JSON.stringify(used), id)
      return { kind: 'used', remaining }
    },
    async expire(now) {
      return db.exec('DELETE FROM blobs WHERE expires <= ?', now).changes
    },
    async totalBytes() {
      return num(db.exec('SELECT COALESCE(SUM(cost), 0) AS total FROM blobs').rows[0]?.['total'])
    },
  }
}
