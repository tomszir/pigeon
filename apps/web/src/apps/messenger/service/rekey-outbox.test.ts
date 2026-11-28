// A tab can close at any moment, between any two writes. A new pair secret's letters are in the
// outbox before the secret is kept, so whatever moment it closes, the friend and every device of
// yours end on the same secret, and hear that each holds it.
import { createMemoryNetwork, flush } from '@pigeon/core/testing'
import { describe, expect, it } from 'vitest'
import type { Store } from '../../../platform/storage/storage.ts'
import {
  fakeClock,
  linkDevice,
  messenger,
  NOON,
  only,
  pairWith,
  testLighthouse,
} from '../testing/messengers.ts'
import { MAIL_AFTER_SEND_MS } from './mail-schedule.ts'
import type { FriendView } from './messenger.ts'

type Side = Awaited<ReturnType<typeof messenger>>

/** Each side looks for mail in turn, `rounds` times. */
async function checkAll(sides: readonly Side[], rounds = 3) {
  for (let round = 0; round < rounds; round++)
    for (const side of sides) {
      await side.messenger.checkMail()
      await flush(400)
    }
}

/** A write that takes a while: more promise turns than keeping a friend's record does. */
const later = () => flush(100)

/**
 * `store` as a tab sees it that closes right after the write `last` picks: that write lands,
 * nothing after it does, and `closing` runs, to cut the tab off from the Lighthouse. Writes to
 * the outbox take longer than any other, as one write can after another in a browser, so a
 * write to it that isn't waited for lands after the ones made next.
 */
function closesAfter(
  store: Store,
  last: (key: string, value: unknown) => boolean,
  closing: () => void = () => undefined,
) {
  let closed = false
  const tab: Store = {
    get: (key) => store.get(key),
    async set(key, value) {
      if (closed) return
      if (key === 'mail-outbox') await later()
      if (closed) return
      await store.set(key, value)
      if (!last(key, value)) return
      closed = true
      closing()
    },
    delete: async (key) => (closed ? undefined : store.delete(key)),
    clear: async () => (closed ? undefined : store.clear()),
  }
  return { store: tab, closed: () => closed }
}

/** Their pair secret made to look as if from before Pigeon sealed every secret it handed over. */
async function fromBefore(stores: readonly Store[]) {
  for (const store of stores) {
    const friends = (await store.get('friends')) as Record<string, unknown>[]
    await store.set(
      'friends',
      friends.map(({ sealed: _sealed, replacing: _replacing, ...rest }) => rest),
    )
  }
}

/** Whether `value`, the friends as kept, has one whose pair secret `holds` picks. */
const keepsFriend = (value: unknown, holds: (friend: Partial<FriendView>) => boolean) =>
  Array.isArray(value) && value.some((record) => holds(record as Partial<FriendView>))

/** The Pigeon on `store` started again on a network of its own: only Lighthouses reach it. */
const startApart = (
  name: string,
  store: Store,
  clock: ReturnType<typeof fakeClock>,
  lighthouse: ReturnType<typeof testLighthouse>,
) => messenger(createMemoryNetwork(), name, { clock, lighthouse, store })

describe('a tab that closes before a new pair secret is put', () => {
  it('keeps neither the winner nor its letters when the outbox can’t be written', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const laptop = await messenger(network, 'rook', { clock, lighthouse })
    const before = await messenger(network, 'mika', { clock, lighthouse })
    await pairWith(laptop, before)
    const old = only(before.messenger.friends()).secret
    for (const side of [laptop, before]) await side.messenger.close()
    await fromBefore([laptop.store, before.store])
    const mika = await startApart('mika', before.store, clock, lighthouse)
    await flush(400)
    await mika.messenger.checkMail()
    await flush(400)
    const secret = only(mika.messenger.friends()).secret
    // Rook's storage refuses to keep a letter about the new secret.
    let refusing = true
    const failing: Store = {
      ...laptop.store,
      get: (key) => laptop.store.get(key),
      async set(key, value) {
        const aboutSecret =
          key === 'mail-outbox' &&
          Array.isArray(value) &&
          value.some((letter) => (letter as { kind?: unknown }).kind === 'rekey')
        if (refusing && aboutSecret) throw new Error('quota')
        await laptop.store.set(key, value)
      },
      delete: (key) => laptop.store.delete(key),
      clear: () => laptop.store.clear(),
    }
    const rook = await startApart('rook', failing, clock, lighthouse)
    await flush(800)
    // Its letters couldn't be kept, so neither is the winner: nothing says it's held.
    expect(only(rook.messenger.friends()).secret).toBe(old)
    expect(secret).not.toBe(old)
    // Once it can, both end on one new secret, and she hears it's held.
    refusing = false
    await checkAll([rook, mika], 3)
    const settled = only(mika.messenger.friends()).secret
    expect(settled).not.toBe(old)
    expect(only(rook.messenger.friends()).secret).toBe(settled)
    expect(only(mika.messenger.friends()).replacing?.heard).toContain(rook.messenger.device)
  })

  it('puts a winner it took from a friend at its next start, so she hears it’s held', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const laptop = await messenger(network, 'rook', { clock, lighthouse })
    const before = await messenger(network, 'mika', { clock, lighthouse })
    await pairWith(laptop, before)
    const old = only(before.messenger.friends()).secret
    for (const side of [laptop, before]) await side.messenger.close()
    await fromBefore([laptop.store, before.store])
    // Apart from here on. Mika proposes first.
    const mika = await startApart('mika', before.store, clock, lighthouse)
    await flush(400)
    await mika.messenger.checkMail()
    await flush(400)
    const secret = only(mika.messenger.friends()).secret
    expect(secret).not.toBe(old)
    // Rook's laptop takes her proposal while it looks for mail, and its tab closes as soon as it
    // has kept it, before anything about it is put.
    const tab = closesAfter(
      laptop.store,
      (key, value) => key === 'friends' && keepsFriend(value, (one) => one.secret === secret),
      () => lighthouse.down(true),
    )
    const closing = await startApart('rook', tab.store, clock, lighthouse)
    await flush(800)
    expect(tab.closed()).toBe(true)
    await closing.messenger.close()
    lighthouse.down(false)

    const rook = await startApart('rook', laptop.store, clock, lighthouse)
    await flush(400)
    await checkAll([rook, mika], 2)
    expect(only(rook.messenger.friends()).secret).toBe(secret)
    expect(only(mika.messenger.friends()).replacing?.heard).toContain(rook.messenger.device)
    // So her mail goes under the new secret, where the laptop looks now.
    await mika.messenger.send(only(mika.messenger.friends()).id, 'under the new one')
    await clock.tick(MAIL_AFTER_SEND_MS + 1000)
    await flush(400)
    await checkAll([rook], 1)
    expect(only(rook.messenger.friends()).log.entries.map((entry) => entry.text)).toEqual([
      'under the new one',
    ])
  })

  it('puts a round begun after a removal at its next start, and every device ends on it', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const laptop = await messenger(network, 'rook', { clock, lighthouse })
    const mika = await messenger(network, 'mika', { clock, lighthouse })
    await pairWith(laptop, mika)
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock, lighthouse)
    const { device: tablet } = await linkDevice(network, laptop, 'rook-tablet', clock, lighthouse)
    await flush(400)
    await checkAll([laptop, phone, tablet, mika], 2)
    const pair = only(mika.messenger.friends()).secret
    for (const side of [laptop, mika, phone, tablet]) await side.messenger.close()
    await flush()
    // The laptop takes the phone off while its Lighthouse can't be reached, and its tab closes
    // as soon as it has kept the new round for Mika's pair secret.
    lighthouse.down(true)
    const tab = closesAfter(
      laptop.store,
      (key, value) =>
        key === 'friends' &&
        keepsFriend(value, (one) => one.secret !== pair && one.replacing?.old === pair),
    )
    const closing = await startApart('rook', tab.store, clock, lighthouse)
    await flush(400)
    await closing.messenger.removeDevice(phone.messenger.device)
    await flush(1600)
    expect(tab.closed()).toBe(true)
    await closing.messenger.close()
    lighthouse.down(false)

    const rook = await startApart('rook', laptop.store, clock, lighthouse)
    const rookTablet = await startApart('rook-tablet', tablet.store, clock, lighthouse)
    const mikaAgain = await startApart('mika', mika.store, clock, lighthouse)
    await flush(400)
    await checkAll([rook, rookTablet, mikaAgain], 3)
    const secret = only(rook.messenger.friends()).secret
    expect(secret).not.toBe(pair)
    expect(only(rookTablet.messenger.friends()).secret).toBe(secret)
    expect(only(mikaAgain.messenger.friends()).secret).toBe(secret)
  })
})
