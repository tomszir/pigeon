import { createMemoryNetwork, decodeInvite, fakeCrypto, fakeSigner, flush } from '@pigeon/core'
import { createRoot } from 'solid-js'
import { describe, expect, it } from 'vitest'
import type { Clock } from '../../../platform/clock/clock.ts'
import { createMemoryStore, type Store } from '../../../platform/storage/storage.ts'
import { createMessenger, type FriendView, type MessengerEvents } from './service.ts'

const never = new Promise<void>(() => undefined)

function fakeClock(): Clock & { tick(ms: number): Promise<void> } {
  let time = 1_000_000
  let timers: { at: number; resolve: () => void }[] = []
  return {
    now: () => time,
    sleep: (ms) => new Promise((resolve) => timers.push({ at: time + ms, resolve })),
    async tick(ms) {
      time += ms
      const due = timers.filter((timer) => timer.at <= time)
      timers = timers.filter((timer) => timer.at > time)
      for (const timer of due) timer.resolve()
      await flush()
    },
  }
}

type Network = ReturnType<typeof createMemoryNetwork>

function messenger(
  network: Network,
  name: string,
  options: { store?: Store; clock?: Clock; events?: MessengerEvents } = {},
) {
  const transport = network.transport()
  const store = options.store ?? createMemoryStore()
  return createRoot(async () => ({
    store,
    transport,
    messenger: await createMessenger({
      crypto: fakeCrypto,
      signer: fakeSigner(name),
      store,
      transport,
      clock: options.clock ?? fakeClock(),
      random: (length) => new Uint8Array(length).fill(name.length),
      inviteBase: 'https://pigeon.test/',
      ...(options.events === undefined ? {} : { events: options.events }),
    }),
  }))
}

async function pair(network: Network, events: { a?: MessengerEvents; b?: MessengerEvents } = {}) {
  const clock = fakeClock()
  const a = await messenger(network, 'rook', { clock, ...(events.a ? { events: events.a } : {}) })
  const b = await messenger(network, 'mika', { clock, ...(events.b ? { events: events.b } : {}) })
  await a.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
  await b.messenger.setProfile({ handle: 'Mika', status: 'away', message: 'brb' })
  await a.messenger.newInvite()
  const link = a.messenger.inviteLink() ?? ''
  expect(link.startsWith('https://pigeon.test/#invite/')).toBe(true)
  const invite = decodeInvite(link.slice(link.indexOf('#') + 1))
  if (!invite.ok) throw new Error('bad link')
  expect(await b.messenger.accept(invite.value, never)).toMatchObject({ ok: true })
  await flush()
  return { a, b, clock }
}

const only = (list: readonly FriendView[]) => {
  expect(list).toHaveLength(1)
  return list[0] as FriendView
}

describe('the Messenger service', () => {
  it('pairs by invite link and then sees the friend online, with presence', async () => {
    const paired: string[] = []
    const { a, b } = await pair(createMemoryNetwork(), {
      a: { onPaired: (friend) => paired.push(friend.handle) },
    })
    expect(paired).toEqual(['Mika'])
    expect(a.messenger.invite()).toBeUndefined()
    const mika = only(a.messenger.friends())
    expect(mika).toMatchObject({ handle: 'Mika', online: true })
    expect(mika.presence).toEqual({ status: 'away', message: 'brb' })
    expect(mika.fingerprint).toMatch(/^[0-9a-f]{16}$/)
    expect(only(b.messenger.friends())).toMatchObject({ handle: 'Rook', online: true })
    expect(a.messenger.onlineCount()).toBe(1)
  })

  it('chats both ways, counts unread, buzzes and shows typing until it expires', async () => {
    const said: string[] = []
    const buzzed: string[] = []
    const { a, b, clock } = await pair(createMemoryNetwork(), {
      a: {
        onMessage: (friend, entry) => said.push(`${friend.handle}: ${entry.text}`),
        onBuzz: (friend) => buzzed.push(friend.handle),
      },
    })
    const mikaId = only(a.messenger.friends()).id
    const rookId = only(b.messenger.friends()).id

    b.messenger.typing(rookId, true)
    await flush()
    expect(a.messenger.friend(mikaId)?.typing).toBe(true)
    await clock.tick(6000)
    expect(a.messenger.friend(mikaId)?.typing).toBe(false)

    await b.messenger.send(rookId, '  prove it  ')
    b.messenger.buzz(rookId)
    await flush()
    await a.messenger.send(mikaId, 'ok')
    await flush()
    expect(said).toEqual(['Mika: prove it'])
    expect(buzzed).toEqual(['Mika'])
    expect(a.messenger.friend(mikaId)?.unread).toBe(1)
    a.messenger.markRead(mikaId)
    expect(a.messenger.friend(mikaId)?.unread).toBe(0)
    const texts = (view: FriendView | undefined) => view?.log.entries.map((entry) => entry.text)
    expect(texts(a.messenger.friend(mikaId))).toEqual(['prove it', 'ok'])
    expect(texts(b.messenger.friend(rookId))).toEqual(['prove it', 'ok'])
  })

  it('throttles typing on the wire', async () => {
    const { a, b, clock } = await pair(createMemoryNetwork())
    const rookId = only(b.messenger.friends()).id
    const mikaId = only(a.messenger.friends()).id
    b.messenger.typing(rookId, true)
    await flush()
    b.messenger.typing(rookId, false)
    await flush()
    expect(a.messenger.friend(mikaId)?.typing).toBe(false)
    b.messenger.typing(rookId, true)
    await flush()
    await clock.tick(1000)
    b.messenger.typing(rookId, true)
    await clock.tick(5500)
    // The second call was inside the refresh window, so nothing renewed the first.
    expect(a.messenger.friend(mikaId)?.typing).toBe(false)
  })

  it('keeps friends, chats and its name across a reload, and catches up after time apart', async () => {
    const network = createMemoryNetwork()
    const { a, b } = await pair(network)
    const mikaId = only(a.messenger.friends()).id
    const rookId = only(b.messenger.friends()).id
    await a.messenger.send(mikaId, 'before')
    await flush()

    await b.messenger.close()
    b.transport.disconnect()
    await flush()
    expect(a.messenger.friend(mikaId)?.online).toBe(false)
    expect(a.messenger.friend(mikaId)?.notes.map((note) => note.kind)).toEqual([
      'online',
      'offline',
    ])
    await a.messenger.send(mikaId, 'while you were out')

    const again = await messenger(network, 'mika', { store: b.store })
    await flush()
    expect(again.messenger.profile().handle).toBe('Mika')
    const rook = again.messenger.friend(rookId)
    expect(rook?.handle).toBe('Rook')
    expect(rook?.log.entries.map((entry) => entry.text)).toEqual(['before', 'while you were out'])
  })

  it('refuses its own invite and makes no link without a name', async () => {
    const a = await messenger(createMemoryNetwork(), 'rook')
    expect(await a.messenger.newInvite()).toBeUndefined()
    await a.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    const invite = await a.messenger.newInvite()
    if (invite === undefined) throw new Error('no invite')
    expect(await a.messenger.accept(invite, never)).toEqual({ ok: false, error: 'stopped' })
  })
})
