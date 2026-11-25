// The Node Lighthouse's MailStore, in SQLite (node:sqlite, no dependency). One table of blobs;
// what's stored is what the MailStore interface says, and nothing about who put or fetched it.
import { DatabaseSync } from 'node:sqlite'
import type { DropOutcome, ListedPage, MailStore, StoredBlob } from '@pigeon/lighthouse'

interface Row {
  readonly id: string
  readonly tag: string
  readonly blob: string
  readonly size: number
  readonly cost: number
  readonly expires: number
  readonly drops: string
  readonly used: string
  readonly seq: number
}

const toBlob = (row: Row): StoredBlob => ({
  id: row.id,
  tag: row.tag,
  blob: row.blob,
  size: row.size,
  cost: row.cost,
  expires: row.expires,
  drops: JSON.parse(row.drops) as string[],
  used: JSON.parse(row.used) as string[],
  seq: row.seq,
})

/** `path` is a file, or ':memory:' for a store that forgets on restart. */
export function createSqliteStore(path: string): MailStore & { close(): void } {
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS blobs (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      tag TEXT NOT NULL,
      blob TEXT NOT NULL,
      size INTEGER NOT NULL,
      cost INTEGER NOT NULL,
      expires INTEGER NOT NULL,
      drops TEXT NOT NULL,
      used TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS blobs_by_tag ON blobs (tag, seq);
    CREATE INDEX IF NOT EXISTS blobs_by_expiry ON blobs (expires);
  `)
  const insert = db.prepare(
    'INSERT INTO blobs (id, tag, blob, size, cost, expires, drops) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const held = db.prepare('SELECT expires FROM blobs WHERE id = ?')
  const byId = db.prepare('SELECT * FROM blobs WHERE id = ? AND expires > ?')
  const setUsed = db.prepare('UPDATE blobs SET used = ? WHERE id = ?')
  const remove = db.prepare('DELETE FROM blobs WHERE id = ?')
  const expired = db.prepare('DELETE FROM blobs WHERE expires <= ?')
  const bytes = db.prepare('SELECT COALESCE(SUM(cost), 0) AS total FROM blobs')

  return {
    async put(blob, now) {
      // No await between the check and the write, so no other put comes between them.
      const existing = held.get(blob.id) as { expires: number } | undefined
      if (existing !== undefined && existing.expires > now) return 'exists'
      // Expired but not swept: replaced, with a new seq, so it lists again. AUTOINCREMENT means
      // a seq is never given twice, even after the highest row is deleted.
      if (existing !== undefined) remove.run(blob.id)
      insert.run(
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
      // At most MAX_LIST_TAGS placeholders, and limit + 1 rows to see if there's more.
      const unique = [...new Set(tags)]
      const marks = unique.map(() => '?').join(', ')
      const rows = db
        .prepare(
          `SELECT id, tag, size, seq FROM blobs WHERE tag IN (${marks}) AND seq > ? AND expires > ? ORDER BY seq LIMIT ?`,
        )
        .all(...unique, cursor, now, limit + 1) as unknown as Pick<
        Row,
        'id' | 'tag' | 'size' | 'seq'
      >[]
      const page = rows.slice(0, limit)
      return {
        items: page.map(({ id, tag, size }) => ({ id, tag, size })),
        cursor: page.at(-1)?.seq ?? cursor,
        more: rows.length > limit,
      }
    },
    async get(id, now) {
      const row = byId.get(id, now) as Row | undefined
      return row === undefined ? undefined : toBlob(row)
    },
    async useDrop(id, hash, now): Promise<DropOutcome> {
      const row = byId.get(id, now) as Row | undefined
      if (row === undefined) return { kind: 'unknown' }
      const blob = toBlob(row)
      if (!blob.drops.includes(hash) || blob.used.includes(hash)) return { kind: 'wrong' }
      const used = [...blob.used, hash]
      const remaining = blob.drops.length - used.length
      if (remaining === 0) remove.run(id)
      else setUsed.run(JSON.stringify(used), id)
      return { kind: 'used', remaining }
    },
    async expire(now) {
      return Number(expired.run(now).changes)
    },
    async totalBytes() {
      return Number((bytes.get() as { total: number }).total)
    },
    close: () => db.close(),
  }
}
