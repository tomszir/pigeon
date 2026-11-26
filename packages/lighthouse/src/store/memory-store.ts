// A MailStore in memory: for tests, and for a Lighthouse that's happy to forget on restart. It
// keeps an index by tag and a running total, so neither listing nor putting walks every blob.
import type { DropOutcome, ListedPage, MailStore, StoredBlob } from './store.ts'

export function createMemoryStore(): MailStore {
  const blobs = new Map<string, StoredBlob>()
  /** Ids under each tag, in the order they came. */
  const byTag = new Map<string, string[]>()
  let seq = 0
  let total = 0

  const remove = (id: string) => {
    const blob = blobs.get(id)
    if (blob === undefined) return
    blobs.delete(id)
    total -= blob.cost
    const ids = (byTag.get(blob.tag) ?? []).filter((other) => other !== id)
    if (ids.length === 0) byTag.delete(blob.tag)
    else byTag.set(blob.tag, ids)
  }
  const live = (id: string, now: number) => {
    const blob = blobs.get(id)
    return blob !== undefined && blob.expires > now ? blob : undefined
  }

  return {
    async put(blob, now) {
      if (live(blob.id, now) !== undefined) return 'exists'
      if (blob.owner !== undefined)
        for (const id of byTag.get(blob.tag) ?? []) {
          const owner = live(id, now)?.owner
          if (owner !== undefined && owner !== blob.owner) return 'taken'
        }
      remove(blob.id)
      seq += 1
      const { owner, ...rest } = blob
      blobs.set(blob.id, {
        ...rest,
        drops: [...blob.drops],
        used: [],
        seq,
        ...(owner === undefined ? {} : { owner }),
      })
      byTag.set(blob.tag, [...(byTag.get(blob.tag) ?? []), blob.id])
      total += blob.cost
      return 'stored'
    },
    async list(tags, cursor, limit, now, claimed = false): Promise<ListedPage> {
      const found: StoredBlob[] = []
      for (const tag of new Set(tags))
        for (const id of byTag.get(tag) ?? []) {
          const blob = live(id, now)
          if (blob !== undefined && blob.seq > cursor && (!claimed || blob.owner !== undefined))
            found.push(blob)
        }
      found.sort((a, b) => a.seq - b.seq)
      const page = found.slice(0, limit)
      return {
        items: page.map(({ id, tag, size }) => ({ id, tag, size })),
        cursor: page.at(-1)?.seq ?? cursor,
        more: found.length > limit,
      }
    },
    async get(id, now) {
      return live(id, now)
    },
    async useDrop(id, hash, now): Promise<DropOutcome> {
      const blob = live(id, now)
      if (blob === undefined) return { kind: 'unknown' }
      if (!blob.drops.includes(hash) || blob.used.includes(hash)) return { kind: 'wrong' }
      const used = [...blob.used, hash]
      const remaining = blob.drops.length - used.length
      if (remaining === 0) remove(id)
      else blobs.set(id, { ...blob, used })
      return { kind: 'used', remaining }
    },
    async expire(now) {
      const gone = [...blobs.values()].filter((blob) => blob.expires <= now)
      for (const blob of gone) remove(blob.id)
      return gone.length
    },
    async totalBytes() {
      return total
    },
  }
}
