import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { MailStore } from '@pigeon/lighthouse'
import { describeMailStore, sampleBlob } from '@pigeon/lighthouse/testing'
import { describe, expect, it } from 'vitest'
import { createSqliteStore } from './sqlite-store.ts'

describeMailStore('the SQLite store', () => createSqliteStore(':memory:'))

// The same, on a file each, so a store can be closed and its file opened again.
const files = new WeakMap<MailStore, string>()
const onFile = (path = join(mkdtempSync(join(tmpdir(), 'lh-store-')), 'mail.sqlite')) => {
  const store = createSqliteStore(path)
  files.set(store, path)
  return store
}
describeMailStore(
  'the SQLite store on a file',
  () => onFile(),
  (store) => {
    ;(store as ReturnType<typeof createSqliteStore>).close()
    return onFile(files.get(store))
  },
)

describe('the SQLite store', () => {
  it('works out the total of a database from before it was kept', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'lh-store-')), 'mail.sqlite')
    onFile(path).close()
    const db = new DatabaseSync(path)
    for (const [n, cost] of [
      [1, 10],
      [2, 32],
    ] as const) {
      const blob = sampleBlob(n, { cost })
      db.prepare(
        'INSERT INTO blobs (id, tag, blob, size, cost, expires, drops) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(blob.id, blob.tag, blob.blob, blob.size, blob.cost, blob.expires, '[]')
    }
    db.exec('DROP TABLE totals')
    db.close()
    return expect(onFile(path).totalBytes()).resolves.toBe(42)
  })

  it('sums the total afresh at each start, so a crash mid-change leaves it right', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'lh-store-')), 'mail.sqlite')
    onFile(path).close()
    const db = new DatabaseSync(path)
    const blob = sampleBlob(1, { cost: 10 })
    db.prepare(
      'INSERT INTO blobs (id, tag, blob, size, cost, expires, drops) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(blob.id, blob.tag, blob.blob, blob.size, blob.cost, blob.expires, '[]')
    // As if the process died after deleting mail but before taking its cost off the total.
    db.exec('UPDATE totals SET value = 999999')
    db.close()
    return expect(onFile(path).totalBytes()).resolves.toBe(10)
  })

  it('adds the claim column to a database from before claims, keeping its mail', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'lh-store-')), 'mail.sqlite')
    const db = new DatabaseSync(path)
    db.exec(`CREATE TABLE blobs (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      tag TEXT NOT NULL,
      blob TEXT NOT NULL,
      size INTEGER NOT NULL,
      cost INTEGER NOT NULL,
      expires INTEGER NOT NULL,
      drops TEXT NOT NULL,
      used TEXT NOT NULL DEFAULT '[]'
    )`)
    const old = sampleBlob(1)
    db.prepare(
      'INSERT INTO blobs (id, tag, blob, size, cost, expires, drops) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(old.id, old.tag, old.blob, old.size, old.cost, old.expires, '[]')
    db.close()
    const store = onFile(path)
    expect((await store.get(old.id, 0))?.owner).toBeUndefined()
    const claimed = sampleBlob(4, { tag: old.tag, owner: old.id })
    expect(await store.put(claimed, 0)).toBe('stored')
    expect((await store.list([old.tag], 0, 10, 0, true)).items.map((item) => item.id)).toEqual([
      claimed.id,
    ])
    store.close()
    // Opening it again finds the column there and leaves it be.
    expect((await onFile(path).get(claimed.id, 0))?.owner).toBe(old.id)
  })
})
