// What every MailStore must do, as tests any store can run against itself: the memory store
// here, and the SQLite stores in the Node and Worker runners.
import { describe, expect, it } from 'vitest'
import type { MailStore, StoredBlob } from './store.ts'

const key = (n: number) => String.fromCharCode(97 + (n % 26)).repeat(52)

export const sampleBlob = (
  n: number,
  extra: Partial<Omit<StoredBlob, 'seq' | 'used'>> = {},
): Omit<StoredBlob, 'seq' | 'used'> => ({
  id: key(n),
  tag: key(100 + (n % 3)),
  blob: 'AQID',
  size: 3,
  cost: 10,
  expires: 1000,
  drops: [key(200 + n), key(300 + n)],
  ...extra,
})

export function describeMailStore(name: string, make: () => Promise<MailStore> | MailStore) {
  describe(`${name} (MailStore)`, () => {
    it('stores a blob once, and lists it under its tag in the order it came', async () => {
      const store = await make()
      expect(await store.put(sampleBlob(1), 0)).toBe('stored')
      expect(await store.put(sampleBlob(1), 0)).toBe('exists')
      await store.put(sampleBlob(4, { tag: sampleBlob(1).tag }), 0)
      await store.put(sampleBlob(2), 0)
      const page = await store.list([sampleBlob(1).tag], 0, 10, 0)
      expect(page.items.map((item) => item.id)).toEqual([key(1), key(4)])
      expect(page.items[0]).toEqual({ id: key(1), tag: sampleBlob(1).tag, size: 3 })
      expect(page.more).toBe(false)
      expect((await store.list([sampleBlob(1).tag], page.cursor, 10, 0)).items).toEqual([])
    })

    it('lists several tags at once, oldest first, paging from the cursor', async () => {
      const store = await make()
      for (const [n, tag] of [
        [3, 150],
        [6, 151],
        [9, 150],
        [12, 151],
      ] as const)
        await store.put(sampleBlob(n, { tag: key(tag) }), 0)
      const first = await store.list([key(150), key(151)], 0, 3, 0)
      expect(first.items.map((item) => item.id)).toEqual([key(3), key(6), key(9)])
      expect(first.more).toBe(true)
      const second = await store.list([key(150), key(151)], first.cursor, 3, 0)
      expect(second.items.map((item) => item.id)).toEqual([key(12)])
      expect(second.more).toBe(false)
    })

    it('pages past mail that expired between the blobs it lists', async () => {
      const store = await make()
      await store.put(sampleBlob(3, { tag: key(150) }), 0)
      await store.put(sampleBlob(6, { tag: key(150), expires: 10 }), 0)
      await store.put(sampleBlob(9, { tag: key(150) }), 0)
      const page = await store.list([key(150)], 0, 2, 20)
      expect(page.items.map((item) => item.id)).toEqual([key(3), key(9)])
      expect(page.more).toBe(false)
    })

    it('never gives a new blob a seq at or below one it gave before', async () => {
      const store = await make()
      await store.put(sampleBlob(1, { tag: key(150), drops: [key(201)] }), 0)
      const first = await store.list([key(150)], 0, 10, 0)
      await store.useDrop(key(1), key(201), 0)
      await store.put(sampleBlob(2, { tag: key(150) }), 0)
      const after = await store.list([key(150)], first.cursor, 10, 0)
      expect(after.items.map((item) => item.id)).toEqual([key(2)])
    })

    it('replaces mail that expired but was not swept yet, so it lists again', async () => {
      const store = await make()
      await store.put(sampleBlob(1, { tag: key(150), expires: 10 }), 0)
      const first = await store.list([key(150)], 0, 10, 0)
      expect(await store.put(sampleBlob(1, { tag: key(150), expires: 100 }), 20)).toBe('stored')
      expect((await store.get(key(1), 20))?.expires).toBe(100)
      expect((await store.list([key(150)], first.cursor, 10, 20)).items).toHaveLength(1)
      expect(await store.totalBytes()).toBe(10)
    })

    it('keeps a blob until every drop is used, each once', async () => {
      const store = await make()
      const blob = sampleBlob(1)
      await store.put(blob, 0)
      const [first = '', second = ''] = blob.drops
      expect(await store.useDrop(blob.id, first, 0)).toEqual({ kind: 'used', remaining: 1 })
      expect(await store.useDrop(blob.id, first, 0)).toEqual({ kind: 'wrong' })
      expect(await store.useDrop(blob.id, key(9), 0)).toEqual({ kind: 'wrong' })
      expect((await store.get(blob.id, 0))?.used).toEqual([first])
      expect(await store.useDrop(blob.id, second, 0)).toEqual({ kind: 'used', remaining: 0 })
      expect(await store.get(blob.id, 0)).toBeUndefined()
      expect(await store.useDrop(blob.id, second, 0)).toEqual({ kind: 'unknown' })
      expect(await store.totalBytes()).toBe(0)
    })

    it('lets one drop succeed once when two come at once', async () => {
      const store = await make()
      const blob = sampleBlob(1)
      await store.put(blob, 0)
      const [first = ''] = blob.drops
      const outcomes = await Promise.all([
        store.useDrop(blob.id, first, 0),
        store.useDrop(blob.id, first, 0),
      ])
      expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['used', 'wrong'])
    })

    it('treats mail as gone from the moment it expires, and counts what it holds', async () => {
      const store = await make()
      await store.put(sampleBlob(1, { expires: 50, cost: 10 }), 0)
      await store.put(sampleBlob(2, { expires: 500, cost: 20 }), 0)
      expect(await store.totalBytes()).toBe(30)
      expect(await store.get(key(1), 50)).toBeUndefined()
      expect((await store.list([sampleBlob(1).tag], 0, 10, 50)).items).toEqual([])
      expect(await store.useDrop(key(1), sampleBlob(1).drops[0] ?? '', 50)).toEqual({
        kind: 'unknown',
      })
      expect(await store.expire(50)).toBe(1)
      expect(await store.totalBytes()).toBe(20)
    })
  })
}
