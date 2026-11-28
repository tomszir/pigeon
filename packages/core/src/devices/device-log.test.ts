import { describe, expect, it } from 'vitest'
import { appendMessage, emptyLog, mergeEntries } from '../chat/chat-log.ts'
import { base32DecodeExact, base32Encode } from '../encoding/bytes.ts'
import { canonicalBytes, type Json } from '../encoding/canonical.ts'
import type { Signer } from '../identity/crypto.ts'
import { fakeCrypto, fakeSigner } from '../testing/testing.ts'
import {
  appendDeviceEntry,
  type DeviceEntryKind,
  type DeviceLog,
  deviceState,
  emptyDeviceLog,
  everDevices,
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

describe('an entry’s signed bytes', () => {
  const decode = (sig: string) => {
    const bytes = base32DecodeExact(sig)
    if (!bytes.ok) throw new Error('not base32')
    return bytes.value
  }
  const fields = {
    identity: laptop.id,
    epoch: 0,
    seq: 1,
    prev: '',
    kind: 'add',
    device: phone.id,
    name: 'Phone',
    at: 1,
  }
  /** A log whose one entry is `add phone`, signed by the first device over `value`. */
  const signedOver = async (value: Json): Promise<DeviceLog> => ({
    ...start(),
    entries: [
      {
        seq: 1,
        prev: '',
        kind: 'add',
        device: phone.id,
        name: 'Phone',
        at: 1,
        sig: base32Encode(await laptop.sign(canonicalBytes(value))),
      },
    ],
  })

  it('are signed saying they’re a device-log entry', async () => {
    const signature = async (signer: Signer) => {
      const result = await appendDeviceEntry(
        fakeCrypto,
        start(),
        signer,
        { kind: 'add', device: phone.id, name: 'Phone' },
        1,
      )
      if (!result.ok) throw new Error(result.error)
      return decode(result.log.entries[0]?.sig ?? '')
    }
    // Signed saying what it is, of which identity and epoch, epoch 0 included.
    const typed = await signature(laptop)
    const bytes = canonicalBytes({ v: 'pigeon/device-entry/v1', ...fields })
    expect(await fakeCrypto.verify(laptop.id, typed, bytes)).toBe(true)
    expect(
      await verifyDeviceLog(
        fakeCrypto,
        await signedOver({ v: 'pigeon/device-entry/v1', ...fields }),
      ),
    ).toBe(true)
  })

  it('refuse a signature made for anything else, or in any other shape', async () => {
    const { epoch: _, ...untyped } = fields
    for (const value of [
      { v: 'pigeon/chat-entry/v1', ...fields },
      { v: 'pigeon/device-entry/v2', ...fields },
      { type: 'recover', ...fields },
      { v: 'pigeon/device-entry/v1', ...untyped },
      // Untyped, as Pigeons before 0.8.4 signed them, with or without epoch 0.
      untyped,
      fields,
    ])
      expect(await verifyDeviceLog(fakeCrypto, await signedOver(value))).toBe(false)
  })

  it('keep a chat entry’s signature from standing as a device-log entry, and the other way', async () => {
    const said = (await appendMessage(emptyLog('pair:x'), laptop, 'add phone', 1)).entry
    const log = await append(start(), 'add', phone.id, 'Phone')
    const entry = log.entries[0]
    if (entry === undefined) throw new Error('no entry')
    expect(await verifyDeviceLog(fakeCrypto, log)).toBe(true)
    const asEntry = { ...log, entries: [{ ...entry, sig: said.sig }] }
    expect(await verifyDeviceLog(fakeCrypto, asEntry)).toBe(false)
    // A chat entry signed over a device-log entry's bytes, its fields made to match.
    const chatFields = { log: 'pair:x', author: laptop.id, seq: 1, lamport: 1, at: 1, text: 'x' }
    const sig = base32Encode(
      await laptop.sign(canonicalBytes({ v: 'pigeon/device-entry/v1', ...chatFields })),
    )
    const { log: _, ...unsigned } = chatFields
    const authors = new Set([laptop.id])
    const taken = await mergeEntries(
      fakeCrypto,
      emptyLog('pair:x'),
      [{ ...unsigned, sig }],
      authors,
    )
    expect(taken.entries).toEqual([])
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

describe('a chain', () => {
  it('names the entry before by its exact signature bytes, not another spelling of them', async () => {
    const added = await append(start(), 'add', phone.id, 'Phone')
    const log = await append(added, 'remove', phone.id)
    const [first, next] = log.entries
    if (first === undefined || next === undefined) throw new Error('no entries')
    expect(await verifyDeviceLog(fakeCrypto, log)).toBe(true)
    // A spelling that doesn't decode, or one in capitals, doesn't stand for the bytes.
    const spelled = (prev: string) => ({ ...added, entries: [first, { ...next, prev }] })
    const unpadded = `${first.sig.slice(0, -1)}${first.sig.endsWith('7') ? '6' : '7'}`
    for (const prev of [unpadded, first.sig.toUpperCase()])
      expect(await verifyDeviceLog(fakeCrypto, spelled(prev))).toBe(false)
  })
})
