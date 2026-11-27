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

/**
 * The contract, for the store `make` gives. A store that keeps mail across restarts passes
 * `reopen`, which closes the store it's given and opens its database again as a new store.
 */
export function describeMailStore(
  name: string,
  make: () => Promise<MailStore> | MailStore,
  reopen?: (store: MailStore) => Promise<MailStore> | MailStore,
): void {
  describe(`${name} (MailStore)`, () => {
    it('keeps its total right through puts, replacements, drops and expiry', async () => {
      const store = await make()
      expect(await store.totalBytes()).toBe(0)
      await store.put(sampleBlob(1, { cost: 10, expires: 50 }), 0)
      await store.put(sampleBlob(2, { cost: 20, drops: [key(202)] }), 0)
      await store.put(sampleBlob(3, { cost: 40 }), 0)
      // Held already: nothing more is counted.
      expect(await store.put(sampleBlob(3, { cost: 40 }), 0)).toBe('exists')
      expect(await store.totalBytes()).toBe(70)
      // An expired blob put again replaces the old one's cost with its own.
      await store.put(sampleBlob(1, { cost: 15, expires: 500 }), 60)
      expect(await store.totalBytes()).toBe(75)
      await store.useDrop(key(2), key(202), 60)
      expect(await store.totalBytes()).toBe(55)
      // A drop that leaves copies to fetch keeps the blob, and its cost.
      await store.useDrop(key(3), sampleBlob(3).drops[0] ?? '', 60)
      expect(await store.totalBytes()).toBe(55)
      expect(await store.expire(1000)).toBe(2)
      expect(await store.totalBytes()).toBe(0)
    })

    if (reopen !== undefined)
      it('still knows its total after a restart', async () => {
        const store = await make()
        await store.put(sampleBlob(1, { cost: 10 }), 0)
        await store.put(sampleBlob(2, { cost: 20, drops: [key(202)] }), 0)
        await store.useDrop(key(2), key(202), 0)
        const again = await reopen(store)
        expect(await again.totalBytes()).toBe(10)
        await again.put(sampleBlob(3, { cost: 5 }), 0)
        expect(await again.totalBytes()).toBe(15)
        expect(await again.expire(1000)).toBe(2)
        expect(await (await reopen(again)).totalBytes()).toBe(0)
      })

    it('names the live blobs after a seq, oldest first, with their tags', async () => {
      const store = await make()
      await store.put(sampleBlob(1), 0)
      await store.put(sampleBlob(2, { expires: 50 }), 0)
      await store.put(sampleBlob(3), 0)
      await store.put(sampleBlob(4), 0)
      const all = await store.after(0, 0, 10)
      expect(all.map((blob) => blob.tag)).toEqual([1, 2, 3, 4].map((n) => sampleBlob(n).tag))
      const first = all[0]?.seq ?? 0
      // Expired ones aren't news to anyone; the limit keeps the oldest.
      expect((await store.after(first, 60, 10)).map((blob) => blob.tag)).toEqual(
        [3, 4].map((n) => sampleBlob(n).tag),
      )
      expect(await store.after(first, 60, 1)).toHaveLength(1)
      expect(await store.after(all.at(-1)?.seq ?? 0, 0, 10)).toEqual([])
    })

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

    it("keeps a tag's claimed blobs to their first owner while one is held", async () => {
      const store = await make()
      const tag = key(150)
      expect(await store.put(sampleBlob(1, { tag }), 0)).toBe('stored')
      expect(await store.put(sampleBlob(2, { tag, owner: key(160), expires: 500 }), 0)).toBe(
        'stored',
      )
      // Another owner can't add to them; the same owner, or an ordinary put, can.
      expect(await store.put(sampleBlob(3, { tag, owner: key(161) }), 0)).toBe('taken')
      expect(await store.put(sampleBlob(4, { tag, owner: key(160) }), 0)).toBe('stored')
      expect(await store.put(sampleBlob(5, { tag }), 0)).toBe('stored')
      // A claim under another tag is its own.
      expect(await store.put(sampleBlob(6, { tag: key(151), owner: key(161) }), 0)).toBe('stored')
      const claimed = await store.list([tag], 0, 10, 0, true)
      expect(claimed.items.map((item) => item.id)).toEqual([key(2), key(4)])
      expect(claimed.items[0]).toEqual({ id: key(2), tag, size: 3 })
      const all = await store.list([tag], 0, 10, 0)
      expect(all.items.map((item) => item.id)).toEqual([key(1), key(2), key(4), key(5)])
      expect((await store.get(key(2), 0))?.owner).toBe(key(160))
      expect((await store.get(key(1), 0))?.owner).toBeUndefined()
      // Once every claimed blob is gone, the claim is free again.
      await store.useDrop(key(4), sampleBlob(4).drops[0] ?? '', 0)
      await store.useDrop(key(4), sampleBlob(4).drops[1] ?? '', 0)
      expect(await store.put(sampleBlob(7, { tag, owner: key(161) }), 0)).toBe('taken')
      expect(await store.put(sampleBlob(7, { tag, owner: key(161) }), 600)).toBe('stored')
      expect((await store.list([tag], 0, 10, 600, true)).items.map((item) => item.id)).toEqual([
        key(7),
      ])
    })

    it('pages claimed blobs past the ordinary ones between them', async () => {
      const store = await make()
      const tag = key(150)
      for (let n = 1; n <= 9; n++)
        await store.put(sampleBlob(n, { tag, ...(n % 3 === 0 ? { owner: key(160) } : {}) }), 0)
      const first = await store.list([tag], 0, 2, 0, true)
      expect(first.items.map((item) => item.id)).toEqual([key(3), key(6)])
      expect(first.more).toBe(true)
      const second = await store.list([tag], first.cursor, 2, 0, true)
      expect(second.items.map((item) => item.id)).toEqual([key(9)])
      expect(second.more).toBe(false)
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

    it('lists across more tags than one query can bind, still oldest first', async () => {
      const store = await make()
      const tag = (n: number) => `${String(n).padStart(4, '0')}${'t'.repeat(48)}`
      // Blobs under tags far apart in the list, put out of the list's order.
      for (const n of [210, 5, 150, 99, 0])
        await store.put(
          sampleBlob(n, { id: `${String(n).padStart(4, '0')}${'i'.repeat(48)}`, tag: tag(n) }),
          0,
        )
      const tags = Array.from({ length: 220 }, (_, n) => tag(n))
      const page = await store.list(tags, 0, 3, 0)
      expect(page.items.map((item) => item.tag)).toEqual([tag(210), tag(5), tag(150)])
      expect(page.more).toBe(true)
      const rest = await store.list(tags, page.cursor, 3, 0)
      expect(rest.items.map((item) => item.tag)).toEqual([tag(99), tag(0)])
      expect(rest.more).toBe(false)
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
