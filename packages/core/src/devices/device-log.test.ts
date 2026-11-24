import { describe, expect, it } from 'vitest'
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
  speakerIdentity,
  verifyDeviceLog,
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
