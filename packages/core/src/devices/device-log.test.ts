import { describe, expect, it } from 'vitest'
import { base32DecodeExact, base32Encode } from '../encoding/bytes.ts'
import type { Signer } from '../identity/crypto.ts'
import { flipS, isHighS, p256Crypto, p256Signer } from '../testing/p256.ts'
import { fakeCrypto, fakeSigner } from '../testing/testing.ts'
import {
  appendDeviceEntry,
  type DeviceEntryKind,
  type DeviceLog,
  deviceState,
  emptyDeviceLog,
  everDevices,
  lowSDeviceLog,
  MAX_DEVICE_ENTRIES,
  mergeDeviceLogs,
  recoverDeviceLog,
  setRecoveryKey,
  speakerIdentity,
  verifyDeviceLog,
  verifyOwnTail,
} from './device-log.ts'

const laptop = fakeSigner('toms-laptop')
const phone = fakeSigner('toms-phone')
const tablet = fakeSigner('toms-tablet')
const thief = fakeSigner('thief')

async function append(
  log: DeviceLog,
  kind: DeviceEntryKind,
  device: string,
  name?: string,
  at = 1,
) {
  const result = await appendDeviceEntry(
    fakeCrypto,
    log,
    laptop,
    { kind, device, ...(name === undefined ? {} : { name }) },
    at,
  )
  if (!result.ok) throw new Error(result.error)
  return result.log
}

const ids = (map: ReadonlyMap<string, unknown>) => [...map.keys()].sort()
const start = () => emptyDeviceLog(laptop.id)

describe('device logs', () => {
  it('start with the first device alone, which stays the identity', async () => {
    expect(ids(deviceState(start()).active)).toEqual([laptop.id])
    expect(await verifyDeviceLog(fakeCrypto, start())).toBe(true)
  })

  it('add, name and remove devices, all from the first device', async () => {
    let log = await append(start(), 'add', phone.id, 'Phone')
    log = await append(log, 'add', tablet.id, 'Tablet')
    log = await append(log, 'name', phone.id, 'My phone')
    expect(deviceState(log).active.get(phone.id)?.name).toBe('My phone')
    log = await append(log, 'remove', phone.id, undefined, 5)
    expect(ids(deviceState(log).active)).toEqual([laptop.id, tablet.id].sort())
    expect(deviceState(log).removedAt.get(phone.id)).toBe(5)
    expect(everDevices(log).has(phone.id)).toBe(true)
    expect(await verifyDeviceLog(fakeCrypto, log)).toBe(true)
  })

  it('let no other device change the list, stolen or not', async () => {
    const log = await append(start(), 'add', phone.id, 'Phone')
    const tries = [
      { kind: 'add', device: thief.id, name: 'Mine' },
      { kind: 'remove', device: laptop.id },
      { kind: 'name', device: laptop.id, name: 'Old' },
    ] as const
    for (const change of tries)
      expect((await appendDeviceEntry(fakeCrypto, log, phone, change, 2)).ok).toBe(false)
  })

  it('keep a removal final, and the first device on the list', async () => {
    let log = await append(start(), 'add', phone.id, 'Phone')
    log = await append(log, 'remove', phone.id)
    const again = { kind: 'add', device: phone.id, name: 'Again' } as const
    expect((await appendDeviceEntry(fakeCrypto, log, laptop, again, 3)).ok).toBe(false)
    const self = { kind: 'remove', device: laptop.id } as const
    expect((await appendDeviceEntry(fakeCrypto, log, laptop, self, 3)).ok).toBe(false)
  })

  it('refuse entries signed by another key, tampered with or out of order', async () => {
    const log = await append(start(), 'add', phone.id, 'Phone')
    const entry = log.entries[0]
    if (entry === undefined) throw new Error('no entry')
    const renamed = { ...log, entries: [{ ...entry, name: 'Evil' }] }
    expect(await verifyDeviceLog(fakeCrypto, renamed)).toBe(false)
    expect(await verifyDeviceLog(fakeCrypto, { ...log, identity: phone.id })).toBe(false)
    const second = (await append(log, 'name', phone.id, 'P')).entries[1]
    if (second === undefined) throw new Error('no entry')
    expect(await verifyDeviceLog(fakeCrypto, { ...log, entries: [second] })).toBe(false)
  })

  it('merge to whichever copy is further along the same chain', async () => {
    const short = await append(start(), 'add', phone.id, 'Phone')
    const long = await append(short, 'remove', phone.id)
    expect(await mergeDeviceLogs(fakeCrypto, short, long)).toBe(long)
    // The removed phone gains nothing by sending the copy from before its removal.
    expect(await mergeDeviceLogs(fakeCrypto, long, short)).toBe(long)
    // A copy that disagrees with ours, or doesn't verify, is ignored.
    const other = await append(short, 'add', tablet.id, 'Tablet')
    const forked = await append(other, 'name', tablet.id, 'T')
    expect(await mergeDeviceLogs(fakeCrypto, long, forked)).toBe(long)
    const last = long.entries[1]
    if (last === undefined) throw new Error('no entry')
    const forged = { ...long, entries: [...long.entries, { ...last, seq: 3 }] }
    expect(await mergeDeviceLogs(fakeCrypto, long, forged)).toBe(long)
  })

  it('hold up to its limit and no further', async () => {
    let log = start()
    for (let index = 0; index < MAX_DEVICE_ENTRIES; index += 1)
      log = await append(log, 'name', laptop.id, `Laptop ${index}`)
    const more = { kind: 'add', device: phone.id, name: 'P' } as const
    const result = await appendDeviceEntry(fakeCrypto, log, laptop, more, 2)
    expect(result.ok ? undefined : result.error).toBe('full')
  })

  it('say whom a device speaks for', async () => {
    const log = await append(start(), 'add', phone.id, 'Phone')
    const claim = { identity: laptop.id, devices: log }
    expect(await speakerIdentity(fakeCrypto, phone.id, claim)).toBe(laptop.id)
    expect(await speakerIdentity(fakeCrypto, thief.id, claim)).toBe(undefined)
    expect(await speakerIdentity(fakeCrypto, laptop.id, {})).toBe(laptop.id)
  })
})

describe('a recovery key', () => {
  const key = fakeSigner('recovery-key-1')
  const nextKey = fakeSigner('recovery-key-2')
  const newPhone = fakeSigner('toms-new-phone')

  async function withKey() {
    const log = await setRecoveryKey(
      await append(start(), 'add', phone.id, 'Phone'),
      laptop,
      key.id,
      1,
    )
    if (log === undefined) throw new Error('no key')
    return log
  }
  async function recoverOnto(writer: string, known?: DeviceLog, signer = key, at = 10) {
    const log = await recoverDeviceLog(
      laptop.id,
      known,
      signer,
      { epoch: 1, writer, keep: [{ device: writer, name: 'New phone' }], next: nextKey.id },
      at,
    )
    if (log === undefined) throw new Error('no recover')
    return log
  }

  it('keeps a removal after a recovery, whatever case a copy writes its signature in', async () => {
    const recovered = await mergeDeviceLogs(
      fakeCrypto,
      await withKey(),
      await recoverOnto(newPhone.id),
    )
    const step = async (log: DeviceLog, kind: DeviceEntryKind, at: number) => {
      const result = await appendDeviceEntry(
        fakeCrypto,
        log,
        newPhone,
        { kind, device: tablet.id, ...(kind === 'add' ? { name: 'Tablet' } : {}) },
        at,
      )
      if (!result.ok) throw new Error(result.error)
      return result.log
    }
    const added = await step(recovered, 'add', 11)
    const removed = await step(added, 'remove', 12)
    // An older copy whose recover signature is the same bytes in capitals: it still verifies by
    // decoding, but as text it's another value, and capitals sort first.
    const epoch = added.epochs?.[0]
    if (epoch === undefined) throw new Error('no epoch')
    const shouted: DeviceLog = {
      ...added,
      epochs: [{ ...epoch, recover: { ...epoch.recover, sig: epoch.recover.sig.toUpperCase() } }],
    }
    for (const merged of [
      await mergeDeviceLogs(fakeCrypto, removed, shouted),
      await mergeDeviceLogs(
        fakeCrypto,
        await mergeDeviceLogs(fakeCrypto, removed, shouted),
        removed,
      ),
    ]) {
      expect(deviceState(merged).active.has(tablet.id)).toBe(false)
    }
    expect(await verifyDeviceLog(fakeCrypto, shouted)).toBe(false)
  })

  it('is committed once, by the first device, and verifies', async () => {
    const log = await withKey()
    expect(await verifyDeviceLog(fakeCrypto, log)).toBe(true)
    expect(deviceState(log).recoveryKey).toBe(key.id)
    expect(await setRecoveryKey(log, laptop, thief.id, 2)).toBeUndefined()
    const other = await append(start(), 'add', phone.id, 'Phone')
    expect(await setRecoveryKey(other, phone, thief.id, 2)).toBeUndefined()
  })

  it('brings you back with every device gone: a friend completes the tail', async () => {
    const known = await withKey()
    const tail = await recoverOnto(newPhone.id)
    expect(await verifyDeviceLog(fakeCrypto, tail)).toBe(false)
    expect(await verifyOwnTail(fakeCrypto, tail)).toBe(true)
    // Mika has the old log; the tail follows on from it.
    const merged = await mergeDeviceLogs(fakeCrypto, known, tail)
    expect(await verifyDeviceLog(fakeCrypto, merged)).toBe(true)
    const state = deviceState(merged)
    expect(ids(state.active)).toEqual([newPhone.id])
    expect(state.writer).toBe(newPhone.id)
    expect(state.recoveryKey).toBe(nextKey.id)
    expect(state.removedAt.get(laptop.id)).toBe(10)
    expect(everDevices(merged).has(phone.id)).toBe(true)
    // And the recovered phone takes the whole log back.
    expect(await mergeDeviceLogs(fakeCrypto, tail, merged)).toBe(merged)
    expect(
      await speakerIdentity(fakeCrypto, newPhone.id, { identity: laptop.id, devices: tail }, known),
    ).toBe(laptop.id)
    expect(
      await speakerIdentity(fakeCrypto, newPhone.id, { identity: laptop.id, devices: tail }),
    ).toBeUndefined()
  })

  it('outranks the first device: a thief with the laptop changes nothing that counts', async () => {
    const known = await withKey()
    const recovered = await mergeDeviceLogs(fakeCrypto, known, await recoverOnto(newPhone.id))
    const stolen = await append(known, 'add', thief.id, 'Mine', 20)
    const merged = await mergeDeviceLogs(fakeCrypto, recovered, stolen)
    expect(ids(deviceState(merged).active)).toEqual([newPhone.id])
    expect((await mergeDeviceLogs(fakeCrypto, stolen, recovered)).epochs).toHaveLength(1)
    // The laptop can't write any more, nor can it set a key of its own.
    expect(
      (
        await appendDeviceEntry(
          fakeCrypto,
          merged,
          laptop,
          { kind: 'add', device: thief.id, name: 'X' },
          21,
        )
      ).ok,
    ).toBe(false)
    expect(await setRecoveryKey(merged, laptop, thief.id, 21)).toBeUndefined()
  })

  it('is refused when signed by any other key', async () => {
    const known = await withKey()
    const forged = await recoverOnto(thief.id, undefined, thief)
    expect(await mergeDeviceLogs(fakeCrypto, known, forged)).toBe(known)
    expect(
      await speakerIdentity(fakeCrypto, thief.id, { identity: laptop.id, devices: forged }, known),
    ).toBeUndefined()
  })

  it('settles two recoveries of one epoch the same way everywhere', async () => {
    const known = await withKey()
    const a = await mergeDeviceLogs(fakeCrypto, known, await recoverOnto(newPhone.id))
    const b = await mergeDeviceLogs(
      fakeCrypto,
      known,
      await recoverOnto(tablet.id, undefined, key, 11),
    )
    const ab = await mergeDeviceLogs(fakeCrypto, a, b)
    const ba = await mergeDeviceLogs(fakeCrypto, b, a)
    expect(deviceState(ab).writer).toBe(deviceState(ba).writer)
    // The lower signature wins, in the order of its base32 spelling, as every Pigeon has settled
    // it, so one before this one still settles on the same recover.
    const sigs = [a, b].map((log) => log.epochs?.[0]?.recover.sig ?? '')
    const lower = [...sigs].sort()[0]
    expect(ab.epochs?.[0]?.recover.sig).toBe(lower)
    expect(ba.epochs?.[0]?.recover.sig).toBe(lower)
  })

  it('can’t be broken by a stolen first device writing to the epoch it lost', async () => {
    const known = await withKey()
    // Handed to the phone, which the recover keeps.
    const handed = await recoverDeviceLog(
      laptop.id,
      known,
      key,
      { epoch: 1, writer: phone.id, keep: [{ device: phone.id, name: 'Phone' }], next: nextKey.id },
      10,
    )
    if (handed === undefined) throw new Error('no handover')
    // The thief, with the laptop, removes the phone in epoch 0, after the recovery.
    const stolen = await append(known, 'remove', phone.id, undefined, 20)
    for (const [first, second] of [
      [stolen, handed],
      [handed, stolen],
    ] as const) {
      const merged = await mergeDeviceLogs(fakeCrypto, first, second)
      expect(await verifyDeviceLog(fakeCrypto, merged)).toBe(true)
      expect(ids(deviceState(merged).active)).toEqual([phone.id])
      expect(deviceState(merged).writer).toBe(phone.id)
    }
  })

  it('leaves a recovered-away first device speaking for nobody', async () => {
    const known = await mergeDeviceLogs(fakeCrypto, await withKey(), await recoverOnto(newPhone.id))
    expect(await speakerIdentity(fakeCrypto, laptop.id, {}, known)).toBeUndefined()
    // Nor can it pass off the old copy from before the recovery.
    const old = await withKey()
    expect(
      await speakerIdentity(fakeCrypto, phone.id, { identity: laptop.id, devices: old }, known),
    ).toBeUndefined()
  })

  it('keeps a recovered device from taking a whole log that isn’t from its key', async () => {
    const tail = await recoverOnto(newPhone.id)
    // The thief has the laptop's key, so can make a whole log of its own, with its own key.
    const forgedKey = await setRecoveryKey(start(), laptop, thief.id, 1)
    if (forgedKey === undefined) throw new Error('no key')
    const forged = await recoverDeviceLog(
      laptop.id,
      forgedKey,
      thief,
      { epoch: 1, writer: thief.id, keep: [{ device: thief.id, name: 'Mine' }], next: thief.id },
      5,
    )
    if (forged === undefined) throw new Error('no forgery')
    expect(await verifyDeviceLog(fakeCrypto, forged)).toBe(true)
    expect(await mergeDeviceLogs(fakeCrypto, tail, forged)).toBe(tail)
    // The real one, through its key, it takes.
    const real = await mergeDeviceLogs(fakeCrypto, await withKey(), tail)
    expect(await mergeDeviceLogs(fakeCrypto, tail, real)).toBe(real)
  })

  it('stays inside its limit across epochs, cutting only history', async () => {
    let log = await withKey()
    for (let index = 0; index < 90; index += 1)
      log = await append(log, 'name', phone.id, `Phone ${index}`)
    const recovered = await mergeDeviceLogs(fakeCrypto, log, await recoverOnto(newPhone.id))
    let grown = recovered
    for (let index = 0; index < 30; index += 1) {
      const result = await appendDeviceEntry(
        fakeCrypto,
        grown,
        newPhone,
        { kind: 'name', device: newPhone.id, name: `New ${index}` },
        20 + index,
      )
      if (!result.ok) throw new Error(result.error)
      grown = result.log
    }
    expect(grown.entries.length + (grown.epochs?.[0]?.entries.length ?? 0)).toBe(MAX_DEVICE_ENTRIES)
    expect(grown.epochs?.[0]?.entries).toHaveLength(30)
    expect(await verifyDeviceLog(fakeCrypto, grown)).toBe(true)
  })

  it('hands the writer’s role to a device you hold, keeping the others', async () => {
    const known = await withKey()
    const handed = await recoverDeviceLog(
      laptop.id,
      known,
      key,
      {
        epoch: 1,
        writer: phone.id,
        keep: [
          { device: phone.id, name: 'Phone' },
          { device: laptop.id, name: 'Laptop' },
        ],
        next: nextKey.id,
      },
      5,
    )
    if (handed === undefined) throw new Error('no handover')
    expect(await verifyDeviceLog(fakeCrypto, handed)).toBe(true)
    expect(ids(deviceState(handed).active)).toEqual([laptop.id, phone.id].sort())
    // The phone writes now, the laptop doesn't.
    const added = await appendDeviceEntry(
      fakeCrypto,
      handed,
      phone,
      { kind: 'add', device: tablet.id, name: 'Tablet' },
      6,
    )
    expect(added.ok).toBe(true)
    if (added.ok) expect(await verifyDeviceLog(fakeCrypto, added.log)).toBe(true)
    expect(
      (
        await appendDeviceEntry(
          fakeCrypto,
          handed,
          laptop,
          { kind: 'add', device: tablet.id, name: 'T' },
          6,
        )
      ).ok,
    ).toBe(false)
    // An old key can't start the next epoch, only the one named last.
    expect(
      await recoverDeviceLog(
        laptop.id,
        handed,
        key,
        { epoch: 2, writer: laptop.id, keep: [{ device: laptop.id, name: 'L' }], next: key.id },
        7,
      ),
    ).toBeUndefined()
  })
})

describe('a replaced recovery key', () => {
  const k1 = fakeSigner('k1')
  const k2 = fakeSigner('k2')
  const k3 = fakeSigner('k3')
  const finder = fakeSigner('finder')
  const finderNext = fakeSigner('finder-next')

  it('can’t start its epoch again once a later one is known, however its signature sorts', async () => {
    const base = await setRecoveryKey(emptyDeviceLog(laptop.id), laptop, k1.id, 1)
    if (base === undefined) throw new Error('no key')
    const keep = [{ device: phone.id, name: 'Phone' }]
    const e1 = await recoverDeviceLog(
      laptop.id,
      base,
      k1,
      { epoch: 1, writer: phone.id, keep, next: k2.id },
      10,
    )
    if (e1 === undefined) throw new Error('no e1')
    const e2 = await recoverDeviceLog(
      laptop.id,
      e1,
      k2,
      { epoch: 2, writer: phone.id, keep, next: k3.id },
      20,
    )
    if (e2 === undefined) throw new Error('no e2')
    const ownerSig = e2.epochs?.[0]?.recover.sig ?? ''
    // Whoever found the old K1 paper tries until their epoch-1 recover signs lower.
    for (let at = 100; at < 140; at += 1) {
      const forged = await recoverDeviceLog(
        laptop.id,
        undefined,
        k1,
        {
          epoch: 1,
          writer: finder.id,
          keep: [{ device: finder.id, name: 'Mine' }],
          next: finderNext.id,
        },
        at,
      )
      if (forged === undefined) throw new Error('no forgery')
      const whole = await recoverDeviceLog(
        laptop.id,
        base,
        k1,
        {
          epoch: 1,
          writer: finder.id,
          keep: [{ device: finder.id, name: 'Mine' }],
          next: finderNext.id,
        },
        at,
      )
      if (whole === undefined) throw new Error('no forgery')
      if ((forged.epochs?.[0]?.recover.sig ?? '') > ownerSig) continue
      for (const attempt of [forged, whole]) {
        expect(await mergeDeviceLogs(fakeCrypto, e2, attempt)).toBe(e2)
        expect(
          await speakerIdentity(
            fakeCrypto,
            finder.id,
            { identity: laptop.id, devices: attempt },
            e2,
          ),
        ).toBeUndefined()
      }
      expect(
        await speakerIdentity(fakeCrypto, phone.id, { identity: laptop.id, devices: e2 }, e2),
      ).toBe(laptop.id)
      return
    }
    throw new Error('no lower signature found')
  })
})

describe('a first device that signs with P-256', () => {
  const strict = p256Crypto()
  const d2 = fakeSigner('d2').id

  const decode = (sig: string) => {
    const bytes = base32DecodeExact(sig)
    if (!bytes.ok) throw new Error('not base32')
    return bytes.value
  }
  /** The other spelling of a signature: r || n - s. */
  const flip = (sig: string) => base32Encode(flipS(decode(sig)))
  const flipLast = (log: DeviceLog): DeviceLog => {
    const last = log.entries.at(-1)
    if (last === undefined) throw new Error('no entries')
    return { ...log, entries: [...log.entries.slice(0, -1), { ...last, sig: flip(last.sig) }] }
  }

  async function step(signer: Signer, log: DeviceLog, kind: 'add' | 'remove', device = d2) {
    const result = await appendDeviceEntry(
      strict,
      log,
      signer,
      { kind, device, ...(kind === 'add' ? { name: 'D2' } : {}) },
      1,
    )
    if (!result.ok) throw new Error(result.error)
    return result.log
  }

  it('keeps D2 removed by comparing spellings alone, where both still verify', async () => {
    // A Crypto from before low-S took both spellings: the copies' comparison holds on its own.
    const lenient = p256Crypto({ lenient: true })
    const owner = await p256Signer()
    const added = await step(owner, emptyDeviceLog(owner.id), 'add')
    const removed = await step(owner, added, 'remove')
    const flipped = flipLast(added)
    expect(await verifyDeviceLog(lenient, flipped)).toBe(true)
    let friend = await mergeDeviceLogs(lenient, emptyDeviceLog(owner.id), flipped)
    expect(deviceState(friend).active.has(d2)).toBe(true)
    friend = await mergeDeviceLogs(lenient, friend, removed)
    expect(deviceState(friend).active.has(d2)).toBe(false)
  })

  it('keeps D2 removed when a flipped "add D2" arrives before the genuine "remove D2"', async () => {
    for (const spelling of ['low', 'high'] as const) {
      // The owner's "add D2" as an updated Pigeon signs it (low-S), and as one from before may
      // have (high-S): either way someone holding it hands a friend the other spelling first.
      const old = await p256Signer(spelling)
      const owner = { id: old.id, sign: old.sign }
      const added = await step(owner, emptyDeviceLog(owner.id), 'add')
      const updated: Signer = {
        id: owner.id,
        sign: async (data) => {
          const signature = await old.sign(data)
          return isHighS(signature) ? flipS(signature) : signature
        },
      }
      const removed = await step(updated, added, 'remove')
      const flipped = flipLast(added)

      let friend = emptyDeviceLog(owner.id)
      friend = await mergeDeviceLogs(strict, friend, flipped)
      // A high-S copy is refused outright; a low-S one is the same signature, so it's taken.
      expect(friend.entries.length).toBe(spelling === 'low' ? 0 : 1)
      friend = await mergeDeviceLogs(strict, friend, removed)
      expect(deviceState(friend).active.has(d2)).toBe(false)
      expect(deviceState(friend).removed.has(d2)).toBe(true)
      expect(
        await speakerIdentity(strict, d2, { identity: owner.id, devices: removed }, friend),
      ).toBeUndefined()
    }
  })

  it('chains each entry to the exact bytes of the one before, not another spelling of them', async () => {
    const owner = await p256Signer('low')
    const added = await step(owner, emptyDeviceLog(owner.id), 'add')
    const first = added.entries[0]
    if (first === undefined) throw new Error('no entry')
    // The owner's own next entry, signed naming the first entry's other spelling.
    const twin = { ...added, entries: [{ ...first, sig: flip(first.sig) }] }
    const next = (await step(owner, twin, 'remove')).entries[1]
    if (next === undefined) throw new Error('no entry')
    expect(decode(next.prev)).toEqual(flipS(decode(first.sig)))
    // Beside the first entry as it was signed, it names something else: the chain breaks.
    const mixed = { ...added, entries: [first, next] }
    expect(await verifyDeviceLog(strict, mixed)).toBe(false)
    expect(await mergeDeviceLogs(strict, added, mixed)).toBe(added)
    // Nor does a spelling that doesn't decode, or one in capitals, stand for the bytes.
    const spelled = (prev: string) => ({ ...added, entries: [first, { ...next, prev }] })
    const unpadded = `${first.sig.slice(0, -1)}${first.sig.endsWith('7') ? '6' : '7'}`
    for (const prev of [unpadded, first.sig.toUpperCase()])
      expect(await verifyDeviceLog(strict, spelled(prev))).toBe(false)
  })

  it('takes a high-S signature only where the next entry’s signed prev fixes it', async () => {
    const old = await p256Signer('high')
    const log = await step(old, await step(old, emptyDeviceLog(old.id), 'add'), 'remove')
    expect(log.entries.every((entry) => isHighS(decode(entry.sig)))).toBe(true)
    // The last one is fixed by nothing, so it's refused as it is...
    expect(await verifyDeviceLog(strict, log)).toBe(false)
    // ...and taken once spelled low-S, as a stored log is read back. The first stays high-S:
    // the second entry's prev names it.
    const read = lowSDeviceLog(log)
    expect(isHighS(decode(read.entries[0]?.sig ?? ''))).toBe(true)
    expect(isHighS(decode(read.entries[1]?.sig ?? ''))).toBe(false)
    expect(read.entries[1]?.prev).toBe(log.entries[0]?.sig)
    expect(await verifyDeviceLog(strict, read)).toBe(true)
    expect(lowSDeviceLog(read)).toBe(read)
    // A friend who stored the old copy merges the owner's next entry onto it.
    const next = await step(old, read, 'add', fakeSigner('d3').id)
    // Its own last spelling is high-S, fixed by nothing: refused as it arrives.
    expect(await mergeDeviceLogs(strict, log, next)).toBe(log)
    const genuine = await mergeDeviceLogs(strict, log, lowSDeviceLog(next))
    expect(genuine.entries.length).toBe(3)
    expect(await verifyDeviceLog(strict, genuine)).toBe(true)
  })

  it('keeps a stored log readable once its last spellings are made low-S, recovery and all', async () => {
    const old = await p256Signer('high')
    const recoveryKey = fakeSigner('p256-owner-recovery')
    const added = await step(old, emptyDeviceLog(old.id), 'add')
    const committed = await setRecoveryKey(added, old, recoveryKey.id, 2)
    if (committed === undefined) throw new Error('no key')
    expect(isHighS(decode(committed.recovery?.sig ?? ''))).toBe(true)
    expect(await verifyDeviceLog(strict, committed)).toBe(false)
    const read = lowSDeviceLog(committed)
    expect(await verifyDeviceLog(strict, read)).toBe(true)
    // Merging into the stored copy as it was doesn't get stuck on its old spellings.
    const updated: Signer = {
      id: old.id,
      sign: async (data) => flipS(await old.sign(data)),
    }
    const grown = await step(updated, read, 'remove')
    const merged = await mergeDeviceLogs(strict, committed, grown)
    expect(merged).toBe(grown)
    expect(deviceState(merged).active.has(d2)).toBe(false)
  })

  it('spells low-S the entry left last when old entries are cut', async () => {
    const old = await p256Signer('high')
    const key = fakeSigner('p256-cut-recovery')
    const writer = fakeSigner('p256-cut-writer')
    let log = emptyDeviceLog(old.id)
    for (let index = 0; index < 60; index += 1)
      log = await step(
        old,
        log,
        index % 2 === 0 ? 'add' : 'remove',
        fakeSigner(`d${index >> 1}`).id,
      )
    const committed = await setRecoveryKey(log, old, key.id, 2)
    if (committed === undefined) throw new Error('no key')
    let recovered = await recoverDeviceLog(
      old.id,
      lowSDeviceLog(committed),
      key,
      { epoch: 1, writer: writer.id, keep: [{ device: writer.id, name: 'W' }], next: key.id },
      3,
    )
    if (recovered === undefined) throw new Error('no recover')
    for (let index = 0; index < 50; index += 1) {
      const result = await appendDeviceEntry(
        strict,
        recovered,
        writer,
        { kind: 'add', device: fakeSigner(`e${index}`).id, name: 'E' },
        4,
      )
      if (!result.ok) throw new Error(result.error)
      recovered = result.log
    }
    expect(recovered.entries.length).toBe(MAX_DEVICE_ENTRIES - 50)
    expect(await verifyDeviceLog(strict, recovered)).toBe(true)
  })
})
