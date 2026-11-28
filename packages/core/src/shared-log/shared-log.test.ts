// The shared log's rules, one at a time: what an entry is signed over, which entries are taken,
// how two entries under one number settle, what a summary sends, and what counts in the fold.
import { describe, expect, it } from 'vitest'
import {
  appendDeviceEntry,
  type DeviceLog,
  emptyDeviceLog,
  recoverDeviceLog,
  removalsOf,
  setRecoveryKey,
  verifyDeviceLog,
} from '../devices/device-log.ts'
import { base32Encode } from '../encoding/bytes.ts'
import { canonicalBytes } from '../encoding/canonical.ts'
import { fakeCrypto, fakeSigner } from '../testing/testing.ts'
import { appendShared, blockOps, removalAt, settleOps, stampFor, unfriendOps } from './changes.ts'
import {
  isSharedEntry,
  MAX_SHARED_ENTRY_BYTES,
  readOp,
  SHARED_ENTRY_CONTEXT,
  type SharedEntry,
  type SharedOp,
  STAMP_CAP,
  verifyEntry,
} from './entry.ts'
import { type FoldContext, foldShared } from './fold.ts'
import {
  behindShared,
  emptySharedLog,
  inTurn,
  missingShared,
  readSharedSummary,
  type SharedLog,
  summarizeShared,
  takeSharedEntries,
} from './log.ts'
import { readSyncBody, syncBody, syncCounts } from './sync.ts'

const crypto = fakeCrypto
const first = fakeSigner('shared:first')
const phone = fakeSigner('shared:phone')
const laptop = fakeSigner('shared:laptop')
const stranger = fakeSigner('shared:stranger')
const friend = fakeSigner('shared:friend').id
const identity = first.id
const inc = (k: number) => base32Encode(new Uint8Array(16).fill(k))

async function deviceLog(removeLaptop = false, at = 50): Promise<DeviceLog> {
  let log = emptyDeviceLog(identity)
  for (const device of [phone, laptop]) {
    const added = await appendDeviceEntry(
      crypto,
      log,
      first,
      { kind: 'add', device: device.id, name: 'Device' },
      1,
    )
    if (!added.ok) throw new Error('add')
    log = added.log
  }
  if (removeLaptop) {
    const removed = await appendDeviceEntry(
      crypto,
      log,
      first,
      { kind: 'remove', device: laptop.id },
      at,
    )
    if (!removed.ok) throw new Error('remove')
    log = removed.log
  }
  return log
}

const everyone: FoldContext = {
  authors: new Set([first.id, phone.id, laptop.id]),
  removals: new Map(),
}

async function write(log: SharedLog, signer = first, op: SharedOp = petOp('Rook'), now = 10) {
  const next = await appendShared(log, signer, op, now, everyone)
  if (next === undefined) throw new Error('full')
  return next
}

const petOp = (name: string) => ({ kind: 'pet', friend, name }) as const

/** Signs whatever fields, as `signer`, outside the rules. */
async function raw(signer = first, fields: Record<string, unknown> = {}): Promise<SharedEntry> {
  const unsigned = {
    v: SHARED_ENTRY_CONTEXT,
    identity,
    device: signer.id,
    n: 1,
    stamp: 5,
    kind: 'pet',
    friend,
    name: 'Rook',
    ...fields,
  } as Record<string, unknown>
  for (const key of Object.keys(unsigned)) if (unsigned[key] === undefined) delete unsigned[key]
  const sig = base32Encode(await signer.sign(canonicalBytes(unsigned as never)))
  return { ...unsigned, sig } as SharedEntry
}

const take = (log: SharedLog, entries: readonly unknown[]) =>
  takeSharedEntries(crypto, log, entries, everyone.authors)

describe('an entry', () => {
  it('is signed over what it is for: the kind, whose log, which device and number', async () => {
    const { entry } = await write(emptySharedLog(identity))
    expect(await verifyEntry(crypto, entry)).toBe(true)
    for (const change of [{ kind: 'mute' }, { identity: phone.id }, { n: 2 }, { stamp: 11 }]) {
      const moved = { ...entry, ...change } as SharedEntry
      expect(await verifyEntry(crypto, moved)).toBe(false)
    }
    expect(entry.v).toBe(SHARED_ENTRY_CONTEXT)
  })

  it('belongs to one log: another identity’s entry is refused', async () => {
    const { entry } = await write(emptySharedLog(phone.id), first)
    expect(isSharedEntry(identity, entry)).toBe(false)
    expect((await take(emptySharedLog(identity), [entry])).taken).toEqual([])
  })

  it('is refused past its size or its number', async () => {
    const big = await raw(first, { kind: 'future', blob: 'x'.repeat(MAX_SHARED_ENTRY_BYTES) })
    const late = await raw(first, { n: 10_001 })
    const { taken } = await take(emptySharedLog(identity), [big, late])
    expect(taken).toEqual([])
  })

  it('is kept and counted in the summary above the cap, and counts for nothing', async () => {
    const over = await raw(phone, { stamp: STAMP_CAP + 1, name: 'Over' })
    const { log } = await take(emptySharedLog(identity), [over])
    expect(log.entries).toEqual([over])
    expect(await missingShared(crypto, log, await summarizeShared(crypto, log))).toEqual([])
    expect(foldShared(log, everyone).petnames.size).toBe(0)
    // And raises no stamp: a change after it is stamped by the clock.
    expect(stampFor(log, everyone, petOp('Mine'), 10)).toBe(10)
  })

  it('is read for its kind only with exactly its fields', async () => {
    const extra = await raw(first, { colour: 'red' })
    expect(isSharedEntry(identity, extra)).toBe(true)
    expect(readOp(extra)).toBeUndefined()
    expect(readOp(await raw(first, { kind: 'add', inc: inc(1), name: undefined }))).toBeDefined()
    expect(readOp(await raw(first, { kind: 'add', inc: 'short', name: undefined }))).toBeUndefined()
    const marked = await raw(first, { kind: 'add', inc: inc(1), name: undefined, before: true })
    expect(readOp(marked)).toBeUndefined()
  })

  it('reads a kind named like an object property as one it doesn’t know, and folds the rest', async () => {
    const odd = await Promise.all(
      ['constructor', '__proto__', 'toString', 'hasOwnProperty'].map((kind, i) =>
        raw(phone, { n: i + 1, kind, friend: undefined, name: undefined, extra: 'x' }),
      ),
    )
    for (const entry of odd) expect(readOp(entry)).toBeUndefined()
    const { log } = await take(emptySharedLog(identity), odd)
    expect(log.entries).toHaveLength(4)
    expect(foldShared(log, everyone).petnames.size).toBe(0)
    expect(await appendShared(log, first, petOp('Rook'), 10, everyone)).toBeDefined()
    const hostile = JSON.parse('{"__proto__":{"n":1,"digest":"x"},"toString":{"n":1,"digest":"x"}}')
    const summary = readSharedSummary(hostile)
    expect(Object.keys(summary)).toEqual([])
    expect(Object.getPrototypeOf(summary)).toBe(Object.prototype)
  })

  it('has its signature in one spelling', async () => {
    const entry = await raw()
    expect(isSharedEntry(identity, { ...entry, sig: entry.sig.toUpperCase() })).toBe(false)
  })
})

describe('taking entries', () => {
  it('takes only from devices ever on your device log', async () => {
    const { entry } = await write(emptySharedLog(identity), stranger)
    const { taken } = await take(emptySharedLog(identity), [entry])
    expect(taken).toEqual([])
  })

  it('keeps an entry of a kind it can’t read, and passes it on', async () => {
    const future = await raw(phone, { kind: 'future', friend: undefined, name: undefined })
    const { log } = await take(emptySharedLog(identity), [future])
    expect(log.entries).toHaveLength(1)
    expect(await missingShared(crypto, log, {})).toHaveLength(1)
    expect(foldShared(log, everyone).petnames.size).toBe(0)
  })

  it('settles two entries under one number on the lower signature, whatever the order', async () => {
    const a = await raw(phone, { name: 'A' })
    const b = await raw(phone, { name: 'B' })
    const one = (await take((await take(emptySharedLog(identity), [a])).log, [b])).log
    const two = (await take((await take(emptySharedLog(identity), [b])).log, [a])).log
    expect(one.entries).toEqual(two.entries)
    expect(one.entries).toHaveLength(1)
  })

  it('sends a device whose digest differs every entry of that device', async () => {
    const a = await raw(phone, { name: 'A' })
    const b = await raw(phone, { name: 'B' })
    const mine = (await take(emptySharedLog(identity), [a])).log
    const theirs = (await take(emptySharedLog(identity), [b])).log
    const summary = await summarizeShared(crypto, theirs)
    expect(await missingShared(crypto, mine, summary)).toEqual([a])
    // The same entries: nothing to send.
    expect(await missingShared(crypto, mine, await summarizeShared(crypto, mine))).toEqual([])
  })
})

describe('a device that skips numbers', () => {
  it('is described whole, so two devices holding the same entries send each other nothing', async () => {
    const held = [1, 2, 3, 5].map((n) =>
      raw(phone, { n, kind: 'future', friend: undefined, name: undefined }),
    )
    const entries = await Promise.all(held)
    const one = (await take(emptySharedLog(identity), entries)).log
    const two = (await take(emptySharedLog(identity), [...entries].reverse())).log
    expect(await missingShared(crypto, one, await summarizeShared(crypto, two))).toEqual([])
    expect(await behindShared(crypto, one, await summarizeShared(crypto, two))).toBe(false)
    // One without 5 is sent 5 alone; one with 4 instead is sent all, and sends its 4 back.
    const short = (await take(emptySharedLog(identity), entries.slice(0, 3))).log
    expect(await missingShared(crypto, one, await summarizeShared(crypto, short))).toEqual([
      entries[3],
    ])
    const four = await raw(phone, { n: 4, kind: 'future', friend: undefined, name: undefined })
    const other = (await take(short, [four])).log
    expect(await behindShared(crypto, other, await summarizeShared(crypto, one))).toBe(true)
    expect(await missingShared(crypto, one, await summarizeShared(crypto, other))).toHaveLength(4)
  })

  it('takes its turn with the others, after your devices on the list', () => {
    const e = (device: string, n: number) => ({ device, n }) as unknown as SharedEntry
    const flood = [1, 2, 3].map((n) => e('r', n))
    const order = inTurn([...flood, e('p', 1), e('q', 1), e('q', 2)], new Set(['p', 'q']))
    expect(order.map((x) => `${x.device}${x.n}`)).toEqual(['p1', 'q1', 'q2', 'r1', 'r2', 'r3'])
  })
})

describe('a summary from another device', () => {
  it('is read by its own keys only, never through what an object inherits', async () => {
    const entry = await raw(phone)
    const { log } = await take(emptySharedLog(identity), [entry])
    // A summary whose prototype claims the phone's entries: read as saying nothing of them.
    const inherited = Object.create({ [phone.id]: { n: 99, digest: 'x' } }) as never
    expect(await missingShared(crypto, log, inherited)).toEqual([entry])
    expect(await behindShared(crypto, log, inherited)).toBe(false)
  })
})

describe('stamps', () => {
  it('come after the clock and every entry about the same friend, never refused ahead', async () => {
    const ahead = (await write(emptySharedLog(identity), phone, petOp('Far'), 1_000_000)).log
    expect(stampFor(ahead, everyone, petOp('Near'), 10)).toBe(1_000_001)
    expect(stampFor(ahead, everyone, { kind: 'setting', key: 'relay', value: true }, 10)).toBe(10)
    const { log } = await take(emptySharedLog(identity), ahead.entries)
    expect(foldShared(log, everyone).petnames.get(friend)).toBe('Far')
  })
})

describe('stamps and a removed device', () => {
  it('follow only entries that count: a removed device’s from its removal on raise none', async () => {
    const near = (await write(emptySharedLog(identity), laptop, petOp('Near cap'), STAMP_CAP - 1))
      .log
    expect(stampFor(near, everyone, petOp('Mine'), 10)).toBe(STAMP_CAP)
    const removed = {
      authors: everyone.authors,
      removals: new Map([[laptop.id, { at: 50, by: first.id }]]),
    }
    expect(stampFor(near, removed, petOp('Mine'), 10)).toBe(10)
  })

  it('stop at the cap', async () => {
    expect(stampFor(emptySharedLog(identity), everyone, petOp('Late'), STAMP_CAP + 99)).toBe(
      STAMP_CAP,
    )
  })
})

describe('the fold', () => {
  it('ends a friendship for good with a tombstone, and shows the newer of two', async () => {
    let log = (await write(emptySharedLog(identity), first, { kind: 'add', friend, inc: inc(1) }))
      .log
    log = (await write(log, phone, { kind: 'add', friend, inc: inc(2) }, 20)).log
    expect(foldShared(log, everyone).shown.get(friend)?.inc).toBe(inc(2))
    for (const op of unfriendOps(log, everyone, friend)) log = (await write(log, first, op)).log
    log = (await write(log, laptop, { kind: 'add', friend, inc: inc(1) }, 99)).log
    expect(foldShared(log, everyone).friendships.size).toBe(0)
  })

  it('hides friendships added at or before a block, not those after', async () => {
    let log = (await write(emptySharedLog(identity), first, { kind: 'add', friend, inc: inc(1) }))
      .log
    for (const op of blockOps(log, everyone, friend, 'Rook'))
      log = (await write(log, first, op)).log
    expect(foldShared(log, everyone).blocked.get(friend)).toEqual({ name: 'Rook' })
    log = (await write(log, first, { kind: 'block', friend, on: false })).log
    log = (await write(log, phone, { kind: 'add', friend, inc: inc(3) }, 99)).log
    expect([...foldShared(log, everyone).friendships.keys()]).toEqual([inc(3)])
  })

  it('ends the other friendship once the friend is seen in one', async () => {
    let log = (await write(emptySharedLog(identity), first, { kind: 'add', friend, inc: inc(1) }))
      .log
    expect(settleOps(log, everyone, friend, inc(1))).toEqual([])
    log = (await write(log, phone, { kind: 'add', friend, inc: inc(2) }, 20)).log
    expect(settleOps(log, everyone, friend, inc(1))).toEqual([
      { kind: 'tomb', friend, inc: inc(2) },
    ])
  })

  it('discounts a removed device from its removal’s own at, stamped past what the writer held', async () => {
    const held = (await write(emptySharedLog(identity), laptop, petOp('Early'), 60)).log
    // The writer's clock says 50, but it held the laptop's entry stamped 60.
    const at = removalAt(held, [laptop.id], 50)
    expect(at).toBe(61)
    const context = {
      authors: everyone.authors,
      removals: new Map([[laptop.id, { at, by: first.id }]]),
    }
    expect(foldShared(held, context).petnames.get(friend)).toBe('Early')
    // What it stamps from its removal on counts for nothing.
    const later = (await write(held, laptop, petOp('Late'), 61)).log
    expect(foldShared(later, context).petnames.get(friend)).toBe('Early')
  })
})

describe('a device that stamps at the top of the safe integers while listed', () => {
  it('is still removed, and recovered away, at a time every Pigeon takes', async () => {
    const top = await raw(laptop, { stamp: Number.MAX_SAFE_INTEGER })
    const atCap = await raw(laptop, { n: 2, stamp: STAMP_CAP })
    const { log } = await take(emptySharedLog(identity), [top, atCap])
    expect(log.entries).toHaveLength(2)
    // Removed: the `at` skips the entry above the cap, and never goes past the cap itself.
    const at = removalAt(log, [laptop.id], 50)
    expect(at).toBe(STAMP_CAP)
    const removed = await appendDeviceEntry(
      crypto,
      await deviceLog(),
      first,
      { kind: 'remove', device: laptop.id },
      at,
    )
    if (!removed.ok) throw new Error(removed.error)
    expect(await verifyDeviceLog(crypto, removed.log)).toBe(true)
    // Recovered away: the recover's `at` holds too.
    const key = fakeSigner('shared:recovery-top')
    const committed = await setRecoveryKey(await deviceLog(), first, key.id, 2)
    if (committed === undefined) throw new Error('no key')
    const recovered = await recoverDeviceLog(
      identity,
      committed,
      key,
      { epoch: 1, writer: phone.id, keep: [{ device: phone.id, name: 'Phone' }], next: key.id },
      removalAt(log, [laptop.id, first.id], 60),
    )
    expect(recovered).toBeDefined()
    if (recovered !== undefined) expect(await verifyDeviceLog(crypto, recovered)).toBe(true)
  })

  it('is never signed into the device log at a time no Pigeon takes', async () => {
    const unsafe = await appendDeviceEntry(
      crypto,
      await deviceLog(),
      first,
      { kind: 'remove', device: laptop.id },
      2 ** 53,
    )
    expect(unsafe.ok).toBe(false)
    const key = fakeSigner('shared:recovery-unsafe')
    const committed = await setRecoveryKey(await deviceLog(), first, key.id, 2)
    if (committed === undefined) throw new Error('no key')
    const keep = [{ device: phone.id, name: 'Phone' }]
    const change = { epoch: 1, writer: phone.id, keep, next: key.id }
    expect(await recoverDeviceLog(identity, committed, key, change, 2 ** 53)).toBeUndefined()
  })
})

describe('who removed a device', () => {
  it('is the epoch’s writer, or the writer of the recover that left it off', async () => {
    const removed = await deviceLog(true, 50)
    expect(removalsOf(removed).get(laptop.id)).toEqual({ at: 50, by: first.id })
    expect(removalsOf(removed).has(phone.id)).toBe(false)
    const key = fakeSigner('shared:recovery')
    const committed = await setRecoveryKey(await deviceLog(), first, key.id, 2)
    if (committed === undefined) throw new Error('no key')
    const recovered = await recoverDeviceLog(
      identity,
      committed,
      key,
      { epoch: 1, writer: phone.id, keep: [{ device: phone.id, name: 'Phone' }], next: key.id },
      60,
    )
    if (recovered === undefined) throw new Error('no recover')
    const removals = removalsOf(recovered)
    expect(removals.get(laptop.id)).toEqual({ at: 60, by: phone.id })
    expect(removals.get(first.id)).toEqual({ at: 60, by: phone.id })
    expect(removals.has(phone.id)).toBe(false)
  })
})

describe('a mail:sync letter', () => {
  it('counts only from another device on the list as merged', async () => {
    const removed = await deviceLog(true)
    expect(syncCounts(removed, phone.id, first.id)).toBe(true)
    expect(syncCounts(removed, laptop.id, first.id)).toBe(false)
    expect(syncCounts(removed, first.id, first.id)).toBe(false)
  })

  it('is read entry by entry: what doesn’t hold stays behind, never the rest', async () => {
    const log = await deviceLog()
    const { entry } = await write(emptySharedLog(identity))
    const body = syncBody({ log, summary: {}, entries: [entry] }) as Record<string, unknown>
    const read = readSyncBody(identity, { ...body, entries: [42, entry], summary: 'nonsense' })
    expect(read?.entries).toEqual([42, entry])
    expect(read?.summary).toEqual({})
    expect((await take(emptySharedLog(identity), read?.entries ?? [])).taken).toEqual([entry])
    expect(readSyncBody(phone.id, body)).toBeUndefined()
  })
})
