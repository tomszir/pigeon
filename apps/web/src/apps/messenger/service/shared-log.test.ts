// Your shared log on a device: kept, passed between your devices in the self room and by
// `mail:sync`, sealed only to devices that said they read it, and the threshold a removal's
// writer owes.
import {
  appendDeviceEntry,
  base32Encode,
  canonicalBytes,
  type DeviceLog,
  emptyDeviceLog,
  emptySharedLog,
  fakeCrypto,
  fakeSigner,
  flush,
  type Json,
  type Letter,
  type PeerId,
  readSyncBody,
  SHARED_ENTRY_CONTEXT,
  type SharedEntry,
  type Signer,
  takeSharedEntries,
} from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../../../platform/storage/memory-storage.ts'
import { fakeClock, NOON } from '../testing/messengers.ts'
import type { Recipient } from './mailbox.ts'
import { loadSharedLog, SYNC_PADS, SYNC_WAIT_MS } from './shared-log.ts'

const first = fakeSigner('keeper:laptop')
const phone = fakeSigner('keeper:phone')
const friend = fakeSigner('keeper:mika').id

async function ownLog(): Promise<DeviceLog> {
  const added = await appendDeviceEntry(
    fakeCrypto,
    emptyDeviceLog(first.id),
    first,
    { kind: 'add', device: phone.id, name: 'Phone' },
    1,
  )
  if (!added.ok) throw new Error('add')
  return added.log
}

const rogue = fakeSigner('keeper:rogue')

/** Your log with a third device that was added, and then removed. */
async function withRogue(): Promise<DeviceLog> {
  let log = await ownLog()
  for (const change of [
    { kind: 'add', device: rogue.id, name: 'Rogue' },
    { kind: 'remove', device: rogue.id },
  ] as const) {
    const next = await appendDeviceEntry(fakeCrypto, log, first, change, 2)
    if (!next.ok) throw new Error('change')
    log = next.log
  }
  return log
}

/** `count` entries `by` signed, of a kind only a newer Pigeon reads, from number `from` on. */
async function flood(count: number, by = rogue, from = 2, blob = 'x'): Promise<SharedEntry[]> {
  const out: SharedEntry[] = []
  for (let n = from; n < from + count; n++) {
    const unsigned = {
      v: SHARED_ENTRY_CONTEXT,
      identity: first.id,
      device: by.id,
      n,
      stamp: 1,
      kind: 'future',
      blob: blob.repeat(700),
    }
    const sig = base32Encode(await by.sign(canonicalBytes(unsigned)))
    out.push({ ...unsigned, sig } as SharedEntry)
  }
  return out
}

/** Takes entries into a keeper as the self room hands them over, a batch at a time. */
async function hand(into: Awaited<ReturnType<typeof keeper>>, from: PeerId, entries: unknown[]) {
  for (let i = 0; i < entries.length; i += 48)
    await into.shared.selfRoom.take(from, entries.slice(i, i + 48) as never)
}

/** Delivers what each mailed to the other, round after round, until both go quiet. */
async function exchange(
  a: Awaited<ReturnType<typeof keeper>>,
  b: Awaited<ReturnType<typeof keeper>>,
  rounds = 40,
) {
  for (let round = 0; round < rounds; round++) {
    let any = false
    for (const [from, to, by] of [
      [a, b, first.id],
      [b, a, phone.id],
    ] as const) {
      await from.clock.tick(SYNC_WAIT_MS)
      await flush()
      for (const letter of from.sent.splice(0)) {
        any = true
        await to.shared.takeLetter(letterFrom(by, letter.body))
      }
    }
    if (!any) return round
  }
  return rounds
}

async function keeper(signer: Signer, log: DeviceLog, sealable = () => true) {
  const clock = fakeClock(NOON)
  const sent: { body: Json; to: readonly PeerId[] }[] = []
  const shared = await loadSharedLog({
    crypto: fakeCrypto,
    signer,
    store: createMemoryStore(),
    clock,
    self: first.id,
    devices: { own: () => log, status: () => 'active' },
    stopped: () => false,
    mailbox: {
      send: async (_kind, to, body) => {
        sent.push({ body, to: to.keys.map((key) => key.device) })
        return true
      },
    },
    recipient: async (only) =>
      sealable()
        ? ({ identity: first.id, keys: only.map((device) => ({ device })) } as unknown as Recipient)
        : undefined,
  })
  return { shared, sent, clock }
}

const letterFrom = (from: PeerId, body: Json): Letter => ({
  kind: 'sync',
  sender: first.id,
  to: first.id,
  date: '2026-11-24',
  id: 'letter-1234',
  head: { epoch: 0, seq: 1 },
  from,
  at: NOON,
  body,
})

describe('your shared log on a device', () => {
  it('mails a change only to your devices that said they read mail:sync', async () => {
    const log = await ownLog()
    const laptop = await keeper(first, log)
    await laptop.shared.write([{ kind: 'pet', friend, name: 'Mika' }])
    await laptop.clock.tick(SYNC_WAIT_MS)
    await flush()
    // The phone said nothing yet, as a Pigeon from before the shared log wouldn't.
    expect(laptop.sent).toEqual([])
    await laptop.shared.heardReads(phone.id, ['sync'])
    await laptop.clock.tick(SYNC_WAIT_MS)
    await flush()
    expect(laptop.sent.map((letter) => letter.to)).toEqual([[phone.id]])
    const body = readSyncBody(first.id, laptop.sent[0]?.body)
    expect(body?.entries).toHaveLength(1)
    // Padded to one of three sizes.
    expect(SYNC_PADS).toContain(JSON.stringify(laptop.sent[0]?.body).length)
  })

  it('takes a letter from another of your devices, and not from a device off your list', async () => {
    const log = await ownLog()
    const laptop = await keeper(first, log)
    const other = await keeper(phone, log)
    await other.shared.heardReads(first.id, ['sync'])
    await other.shared.write([{ kind: 'pet', friend, name: 'Mika' }])
    await other.clock.tick(SYNC_WAIT_MS)
    await flush()
    const [letter] = other.sent
    if (letter === undefined) throw new Error('nothing sent')
    const stranger = fakeSigner('keeper:stranger').id
    expect(await laptop.shared.takeLetter(letterFrom(stranger, letter.body))).toBe(false)
    expect(laptop.shared.view().petnames.size).toBe(0)
    expect(await laptop.shared.takeLetter(letterFrom(phone.id, letter.body))).toBe(true)
    expect(laptop.shared.view().petnames.get(friend)).toBe('Mika')
  })

  it('passes what the other lacks in the self room, by summary', async () => {
    const log = await ownLog()
    const laptop = await keeper(first, log)
    const other = await keeper(phone, log)
    await laptop.shared.write([{ kind: 'mute', friend, until: -1 }])
    const batches = await laptop.shared.selfRoom.missing(
      phone.id,
      await other.shared.selfRoom.summary(),
    )
    for (const batch of batches) await other.shared.selfRoom.take(first.id, batch)
    expect(other.shared.view().mutes.get(friend)).toBe(-1)
    // And nothing again once it holds it.
    const again = await laptop.shared.selfRoom.missing(
      phone.id,
      await other.shared.selfRoom.summary(),
    )
    expect(again.flat()).toEqual([])
  })

  it('says it is behind when the other holds something it lacks', async () => {
    const log = await ownLog()
    const laptop = await keeper(first, log)
    const other = await keeper(phone, log)
    await laptop.shared.write([{ kind: 'mute', friend, until: -1 }])
    const theirs = await laptop.shared.selfRoom.summary()
    expect(await other.shared.selfRoom.behind(first.id, theirs)).toBe(true)
    expect(
      await laptop.shared.selfRoom.behind(phone.id, await other.shared.selfRoom.summary()),
    ).toBe(false)
  })
})

describe('a device that floods past a gap in its numbers', () => {
  it('never crowds out your devices’ own changes from a letter', async () => {
    const log = await withRogue()
    const laptop = await keeper(first, log)
    const entries = await flood(300)
    for (let i = 0; i < entries.length; i += 48)
      await laptop.shared.selfRoom.take(phone.id, entries.slice(i, i + 48))
    expect(laptop.shared.log().entries).toHaveLength(300)
    await laptop.shared.heardReads(phone.id, ['sync'])
    await laptop.shared.write([{ kind: 'block', friend, on: true }])
    await laptop.clock.tick(SYNC_WAIT_MS)
    await flush()
    const body = readSyncBody(first.id, laptop.sent.at(-1)?.body)
    const kinds = (body?.entries ?? []).map((entry) => (entry as SharedEntry).kind)
    expect(kinds[0]).toBe('block')
  })

  it('goes quiet once two devices hold the same entries, gap and all', async () => {
    const log = await withRogue()
    const laptop = await keeper(first, log)
    const other = await keeper(phone, log)
    const entries = await flood(5)
    await laptop.shared.selfRoom.take(phone.id, entries)
    await other.shared.selfRoom.take(first.id, entries)
    await laptop.shared.heardReads(phone.id, ['sync'])
    await other.shared.heardReads(first.id, ['sync'])
    await laptop.shared.write([{ kind: 'mute', friend, until: -1 }])
    // Each takes what the other mailed, round after round, until nobody has anything to send.
    for (let round = 0; round < 6; round++) {
      for (const [from, to, by] of [
        [laptop, other, first.id],
        [other, laptop, phone.id],
      ] as const) {
        await from.clock.tick(SYNC_WAIT_MS)
        await flush()
        for (const letter of from.sent.splice(0))
          await to.shared.takeLetter(letterFrom(by, letter.body))
      }
    }
    await laptop.clock.tick(SYNC_WAIT_MS)
    await other.clock.tick(SYNC_WAIT_MS)
    await flush()
    expect([...laptop.sent, ...other.sent]).toEqual([])
    expect(other.shared.view().mutes.get(friend)).toBe(-1)
  })
})

describe('a device that only reads', () => {
  it('gets every change, one at a time, even when nothing it sends arrives', async () => {
    const log = await ownLog()
    const laptop = await keeper(first, log)
    const other = await keeper(phone, log)
    await laptop.shared.heardReads(phone.id, ['sync'])
    await other.shared.heardReads(first.id, ['sync'])
    for (let i = 1; i <= 300; i++) {
      await laptop.shared.write([{ kind: 'pet', friend: fakeSigner(`f${i}`).id, name: `n${i}` }])
      await laptop.clock.tick(SYNC_WAIT_MS)
      await flush()
      for (const letter of laptop.sent.splice(0))
        await other.shared.takeLetter(letterFrom(first.id, letter.body))
      await other.clock.tick(SYNC_WAIT_MS)
      await flush()
      other.sent.splice(0)
    }
    expect(other.shared.log().entries).toHaveLength(300)
  }, 60_000)

  it('heals two entries under one number deep in a long log, held the other way on each', async () => {
    const log = await withRogue()
    const laptop = await keeper(first, log)
    const other = await keeper(phone, log)
    const [a, b] = await Promise.all([flood(1, rogue, 5, 'a'), flood(1, rogue, 5, 'b')])
    // The copy every device keeps is the one the log keeps of the two.
    const both = await takeSharedEntries(
      fakeCrypto,
      emptySharedLog(first.id),
      [...a, ...b],
      new Set([rogue.id]),
    )
    const lower = both.log.entries[0]?.sig === a[0]?.sig ? a : b
    const higher = lower === a ? b : a
    const rest = [...(await flood(3, rogue, 2)), ...(await flood(395, rogue, 6))]
    // The laptop is ahead, with the copy that loses; the phone holds the first 90 and the winner.
    await hand(laptop, phone.id, [...rest, ...higher])
    await hand(other, first.id, [...rest.slice(0, 89), ...lower])
    await laptop.shared.heardReads(phone.id, ['sync'])
    await other.shared.heardReads(first.id, ['sync'])
    await laptop.shared.write([{ kind: 'mute', friend, until: -1 }])
    expect(await exchange(laptop, other)).toBeLessThan(40)
    expect(other.shared.log().entries).toHaveLength(400)
    expect(laptop.shared.log().entries).toEqual(other.shared.log().entries)
    expect(laptop.shared.log().entries.find((e) => e.n === 5)?.sig).toBe(lower[0]?.sig)
  }, 60_000)
})

describe('a letter that can’t be sealed for now', () => {
  it('is sent once it can be, not marked as sent before', async () => {
    let sealable = false
    const log = await ownLog()
    const laptop = await keeper(first, log, () => sealable)
    await laptop.shared.heardReads(phone.id, ['sync'])
    await laptop.shared.write([{ kind: 'pet', friend, name: 'Mika' }])
    await laptop.clock.tick(SYNC_WAIT_MS)
    await flush()
    expect(laptop.sent).toEqual([])
    sealable = true
    await laptop.shared.flush()
    expect(readSyncBody(first.id, laptop.sent.at(-1)?.body)?.entries).toHaveLength(1)
  })
})

describe('a removal and your shared log', () => {
  it('is signed later than every entry the removed device delivered, so they keep counting', async () => {
    const log = await ownLog()
    const laptop = await keeper(first, log)
    const [far] = await flood(1, phone, 1)
    if (far === undefined) throw new Error('no entry')
    const ahead = { ...far, stamp: NOON + 60 * 60 * 1000 }
    const signed = await phone.sign(
      canonicalBytes(
        Object.fromEntries(Object.entries(ahead).filter(([k]) => k !== 'sig')) as never,
      ),
    )
    const entry = { ...ahead, sig: base32Encode(signed) } as SharedEntry
    await laptop.shared.selfRoom.take(phone.id, [entry] as never)
    expect(laptop.shared.log().entries).toHaveLength(1)
    // The laptop's clock says noon; the phone's entry is stamped an hour later.
    expect(laptop.shared.removalAt([phone.id])).toBe(entry.stamp + 1)
    expect(laptop.shared.removalAt([first.id])).toBe(NOON)
  })
})
