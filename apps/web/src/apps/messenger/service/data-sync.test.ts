// Friends, petnames, mutes, blocks and the relay setting kept in step on your devices: changed on
// one, they show on the others, whether the two meet in the self room or only through the self
// mailbox.
import {
  appendDeviceEntry,
  createMemoryNetwork,
  emptyDeviceLog,
  fakeCrypto,
  fakeSigner,
  flush,
  readOp,
  type SharedEntry,
} from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../../../platform/storage/memory-storage.ts'
import { everywhere } from '../friend-dialogs/friend-dialogs.tsx'
import {
  away,
  fakeClock,
  linkDevice,
  messenger,
  NOON,
  only,
  pairWith,
  testLighthouse,
} from '../testing/messengers.ts'
import { createDataSync } from './data-sync.ts'
import { MUTED_FOREVER } from './friends.ts'
import { loadSharedLog, SYNC_WAIT_MS } from './shared-log.ts'

type Side = Awaited<ReturnType<typeof messenger>>

/** Rook's laptop, friends with Mika, and his phone linked after: all three at one Lighthouse. */
async function rookWithMika() {
  const network = createMemoryNetwork()
  const clock = fakeClock(NOON)
  const lighthouse = testLighthouse(clock)
  const laptop = await messenger(network, 'rook', { clock, lighthouse })
  const mika = await messenger(network, 'mika', { clock, lighthouse })
  await pairWith(laptop, mika)
  const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock, lighthouse)
  await flush(400)
  /** The phone, opened again where it can't meet the laptop: only its mailbox has the news. */
  const phoneApart = async () => {
    await clock.tick(SYNC_WAIT_MS)
    await flush(800)
    const back = await messenger(createMemoryNetwork(), 'rook-phone', {
      clock,
      lighthouse,
      store: phone.store,
    })
    await flush(400)
    await back.messenger.checkMail()
    await flush(800)
    return back
  }
  return { clock, lighthouse, laptop, mika, phone, phoneApart }
}

const mikaOn = (side: Side) => side.messenger.friends()[0]

describe('your data on all your devices', () => {
  it('shows a petname and a mute set on the laptop on the phone in the self room', async () => {
    const { laptop, phone, mika } = await rookWithMika()
    const id = mika.messenger.self
    expect(mikaOn(phone)?.id).toBe(id)
    await laptop.messenger.rename(id, 'Mika the Elder')
    await laptop.messenger.mute(id, MUTED_FOREVER)
    await flush(800)
    expect(mikaOn(phone)?.name).toBe('Mika the Elder')
    expect(phone.messenger.muted(id)).toBe(true)
    // And back, from the phone.
    await phone.messenger.rename(id, '')
    await phone.messenger.mute(id, undefined)
    await flush(800)
    expect(mikaOn(laptop)?.name).toBe('Mika')
    expect(laptop.messenger.muted(id)).toBe(false)
  })

  it('unfriends everywhere: the phone that was away hears it by mail and deletes the chat', async () => {
    const { laptop, phone, mika, phoneApart } = await rookWithMika()
    const id = mika.messenger.self
    await away(phone)
    await laptop.messenger.remove(id, { block: false })
    await flush(400)
    expect(laptop.messenger.friends()).toEqual([])
    const back = await phoneApart()
    expect(back.messenger.friends()).toEqual([])
    expect(await phone.store.get(`log:${id}`)).toBeUndefined()
    // The tombstone is kept, so nothing brings Mika back.
    const entries = (await phone.store.get('shared-log')) as SharedEntry[]
    expect(entries.some((entry) => readOp(entry)?.kind === 'tomb')).toBe(true)
  })

  it('blocks everywhere, and unblocks', async () => {
    const { laptop, phone, mika } = await rookWithMika()
    const id = mika.messenger.self
    await phone.messenger.remove(id, { block: true })
    await flush(800)
    expect(laptop.messenger.friends()).toEqual([])
    expect(only(laptop.messenger.blocked())).toMatchObject({ id, handle: 'Mika' })
    await laptop.messenger.unblock(id)
    await flush(800)
    expect(phone.messenger.blocked()).toEqual([])
  })

  it('sets Always Go Through the Relay on every device, newest change winning', async () => {
    const { laptop, phone, phoneApart } = await rookWithMika()
    await away(phone)
    await laptop.messenger.setRelayOnly(true)
    await flush(400)
    const back = await phoneApart()
    expect(back.messenger.settings().relayOnly).toBe(true)
  })

  it('writes a friendship that begins here, and names your devices that haven’t said they keep up', async () => {
    const { laptop, phone } = await rookWithMika()
    const adds = ((await laptop.store.get('shared-log')) as SharedEntry[]).filter(
      (entry) => readOp(entry)?.kind === 'add',
    )
    expect(adds).toHaveLength(1)
    // The phone said so in the self room.
    expect(laptop.messenger.notInStep()).toEqual([])
    await away(phone)
    await laptop.store.set('sync-readers', [])
    const again = await messenger(createMemoryNetwork(), 'rook', {
      clock: fakeClock(NOON),
      store: laptop.store,
    })
    await flush(400)
    expect(again.messenger.notInStep()).toEqual(['rook-phone'])
  })
})

describe('two friendships with one friend', () => {
  it('ends neither just because this device paired one of them', async () => {
    const laptop = fakeSigner('race:laptop')
    const phone = fakeSigner('race:phone')
    const mika = fakeSigner('race:mika').id
    const added = await appendDeviceEntry(
      fakeCrypto,
      emptyDeviceLog(laptop.id),
      laptop,
      { kind: 'add', device: phone.id, name: 'Phone' },
      1,
    )
    if (!added.ok) throw new Error('add')
    const devices = { own: () => added.log, status: () => 'active' }
    const keeper = (signer: typeof laptop) =>
      loadSharedLog({
        ...{ crypto: fakeCrypto, signer, store: createMemoryStore(), clock: fakeClock(NOON) },
        ...{ self: laptop.id, devices, stopped: () => false, recipient: async () => undefined },
      })
    const [mine, theirs] = await Promise.all([keeper(laptop), keeper(phone)])
    // The phone paired with Mika again first; its friendship reached this device.
    const incPhone = 'aaaaaaaaaaaaaaaaaaaaaaaaaa'
    await theirs.write([{ kind: 'add', friend: mika, inc: incPhone }])
    await mine.selfRoom.take(phone.id, theirs.log().entries as never)
    const sync = await createDataSync({
      ...{ crypto: fakeCrypto, random: () => new Uint8Array(16).fill(9), shared: mine },
      store: createMemoryStore(),
      ...{ friends: () => [], friend: () => undefined, setState: (() => undefined) as never },
      ...{ saveFriends: async () => undefined, blocked: () => [], block: async () => undefined },
      ...{ unblock: async () => undefined, rename: async () => undefined },
      ...{ mute: async () => undefined, removeFriend: async () => undefined },
      ...{ relayOnly: () => false, setRelayOnly: async () => undefined },
    })
    await sync.began(mika, sync.newInc(), 'Mika')
    // Mika may have paired with the phone after: nothing ends until she's seen in one.
    expect(mine.log().entries.filter((entry) => readOp(entry)?.kind === 'tomb')).toEqual([])
    expect(mine.view().friendships.size).toBe(2)
  })
})

describe('a removal', () => {
  it('is signed later than every entry the removed device delivered, which keeps counting', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const laptop = await messenger(network, 'rook', { clock, lighthouse })
    await laptop.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    // The phone's clock runs two hours ahead.
    const ahead = fakeClock(NOON + 2 * 60 * 60 * 1000)
    const { device: rookPhone } = await linkDevice(network, laptop, 'rook-phone', ahead, lighthouse)
    await flush(400)
    await rookPhone.messenger.setRelayOnly(true)
    await flush(1600)
    expect(laptop.messenger.settings().relayOnly).toBe(true)
    const stamped = ((await laptop.store.get('shared-log')) as SharedEntry[]).find(
      (entry) => entry.device === rookPhone.messenger.device,
    )?.stamp
    expect(stamped).toBeGreaterThan(clock.now())
    await laptop.messenger.removeDevice(rookPhone.messenger.device)
    await flush(800)
    const log = (await laptop.store.get('deviceLog')) as { entries: { kind: string; at: number }[] }
    expect(log.entries.findLast((entry) => entry.kind === 'remove')?.at).toBe((stamped ?? 0) + 1)
    // What the phone delivered before its removal still counts.
    expect(laptop.messenger.settings().relayOnly).toBe(true)
  })
})

describe('what the confirmation says', () => {
  it('names your devices that will hear it once they update', () => {
    expect(everywhere([])).toBe('on all your devices')
    expect(everywhere(['Laptop'])).toBe('on all your devices except Laptop, which needs updating')
    expect(everywhere(['Laptop', 'Tablet', 'Phone'])).toBe(
      'on all your devices except Laptop, Tablet and Phone, which need updating',
    )
  })
})
