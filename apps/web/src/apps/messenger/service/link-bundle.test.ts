// A link bundle comes sealed from another of your own devices, which may run a newer Pigeon and
// keep friends in a shape this one can't read. Its friends are read one by one: one this Pigeon
// can't read, or whose name is longer than a name may be, is set aside and counted, and the rest
// come through, with only the fields this Pigeon knows.
import { MAX_HANDLE_LENGTH } from '@pigeon/core'
import { createMemoryNetwork, fakeSigner, flush } from '@pigeon/core/testing'
import { describe, expect, it, vi } from 'vitest'
import {
  fakeClock,
  linkDevice,
  messenger,
  NOON,
  pairWith,
  testLighthouse,
} from '../testing/messengers.ts'

// What the bundle's friends become on the way, while a test sets it.
const tamper = vi.hoisted(() => ({
  friends: undefined as ((friends: unknown[]) => unknown[]) | undefined,
}))
vi.mock('./your-data.ts', async (importOriginal) => {
  const real = (await importOriginal()) as typeof import('./your-data.ts')
  return {
    ...real,
    createYourData: (...args: Parameters<typeof real.createYourData>) => {
      const made = real.createYourData(...args)
      return {
        ...made,
        bundle: () => {
          const bundle = made.bundle() as Record<string, unknown>
          const change = tamper.friends
          return (
            change === undefined
              ? bundle
              : { ...bundle, friends: change(bundle['friends'] as unknown[]) }
          ) as ReturnType<typeof made.bundle>
        },
      }
    },
  }
})

describe('a link bundle’s friends', () => {
  it('reads them one by one, setting aside and counting each it can’t take', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const laptop = await messenger(network, 'rook', { clock, lighthouse })
    await laptop.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    const mika = await messenger(network, 'mika', { clock, lighthouse })
    await pairWith(laptop, mika)
    await flush(400)
    // One the phone can't read, as a newer Pigeon might keep it, and one whose name is longer
    // than any name may be, among Mika, with a field this Pigeon doesn't know, and Kit.
    const unreadable = { id: fakeSigner('ghost').id, handle: 'Ghost', addedAt: 'yesterday' }
    const tooLong = {
      id: fakeSigner('long').id,
      handle: 'x'.repeat(MAX_HANDLE_LENGTH + 1),
      addedAt: 1,
    }
    const kit = { id: fakeSigner('kit').id, handle: 'Kit', addedAt: 2 }
    tamper.friends = (friends) => [
      unreadable,
      ...friends.map((friend) => ({ ...(friend as object), nickname: 'from a newer Pigeon' })),
      kit,
      tooLong,
    ]
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock, lighthouse)
    tamper.friends = undefined
    await flush(400)

    expect(
      phone.messenger
        .friends()
        .map((view) => view.handle)
        .sort(),
    ).toEqual(['Kit', 'Mika'])
    const kept = (await phone.store.get('friends')) as Record<string, unknown>[]
    expect(kept.some((record) => 'nickname' in record)).toBe(false)
    expect(await phone.store.get('friends-unreadable')).toEqual([unreadable, tooLong])
    // Each start says how many were set aside.
    await phone.messenger.close()
    const told: number[] = []
    await messenger(createMemoryNetwork(), 'rook-phone', {
      clock,
      store: phone.store,
      events: { onFriendsSetAside: (count) => told.push(count) },
    })
    expect(told).toEqual([2])
  })
})
