// The update to your shared log: each device writes what it held before, once, at the lowest
// stamps, and a friend one device held and another never did is listed on the other for you to
// keep or remove everywhere.
import { createMemoryNetwork, fakeSigner, flush, type PeerId } from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import type { Store } from '../../../platform/storage/storage.ts'
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

/** A store made to look as a Pigeon from before your shared log left it. */
async function fromBefore(store: Store, keep: (id: PeerId) => boolean) {
  const friends = ((await store.get('friends')) ?? []) as { id: PeerId; inc?: string }[]
  await store.set(
    'friends',
    friends.filter((record) => keep(record.id)).map(({ inc: _inc, ...record }) => record),
  )
  for (const key of ['shared-log', 'shared-known', 'sync-readers', 'shared-log-updated'])
    await store.delete(key)
}

/** Rook's laptop holds Mika and has Zed blocked; his phone, diverged before, never held Mika. */
async function diverged() {
  const network = createMemoryNetwork()
  const clock = fakeClock(NOON)
  const lighthouse = testLighthouse(clock)
  const laptop = await messenger(network, 'rook', { clock, lighthouse })
  const mika = await messenger(network, 'mika', { clock, lighthouse })
  await pairWith(laptop, mika)
  const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock, lighthouse)
  await flush(400)
  const zed = fakeSigner('zed').id
  for (const side of [laptop, phone, mika]) await away(side)
  const id = mika.messenger.self
  await fromBefore(laptop.store, () => true)
  await fromBefore(phone.store, (friend) => friend !== id)
  await laptop.store.set('blocked', [{ id: zed, handle: 'Zed', at: NOON }])
  // Both start again with the update, and meet in the self room.
  const again = createMemoryNetwork()
  const laptopNow = await messenger(again, 'rook', { clock, lighthouse, store: laptop.store })
  const phoneNow = await messenger(again, 'rook-phone', { clock, lighthouse, store: phone.store })
  await flush(1600)
  return { id, zed, laptop: laptopNow, phone: phoneNow }
}

describe('the update to your shared log', () => {
  it('lists a friend only another device held, there and not where it is held', async () => {
    const { id, zed, laptop, phone } = await diverged()
    expect(only(laptop.messenger.friends()).id).toBe(id)
    expect(laptop.messenger.elsewhere()).toEqual([])
    expect(only(phone.messenger.elsewhere())).toMatchObject({ id, name: 'Mika' })
    expect(phone.messenger.friends()).toEqual([])
    // The laptop's block reaches the phone, written a stamp after its friends.
    expect(only(phone.messenger.blocked())).toMatchObject({ id: zed, handle: 'Zed' })
  })

  it('removes the friend everywhere when you choose that', async () => {
    const { laptop, phone } = await diverged()
    const [friend] = phone.messenger.elsewhere()
    if (friend === undefined) throw new Error('nothing listed')
    await phone.messenger.settleElsewhere(friend.inc, false)
    await flush(1600)
    expect(laptop.messenger.friends()).toEqual([])
    expect(phone.messenger.elsewhere()).toEqual([])
  })

  it('keeps the friend on the other device when you choose that', async () => {
    const { id, laptop, phone } = await diverged()
    const [friend] = phone.messenger.elsewhere()
    if (friend === undefined) throw new Error('nothing listed')
    await phone.messenger.settleElsewhere(friend.inc, true)
    await flush(1600)
    expect(phone.messenger.elsewhere()).toEqual([])
    expect(only(laptop.messenger.friends()).id).toBe(id)
  })
})
