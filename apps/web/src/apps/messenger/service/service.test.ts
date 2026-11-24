import {
  createMemoryNetwork,
  decodeDeviceLink,
  decodeInvite,
  fakeCrypto,
  fakeSigner,
  flush,
  pairRoom,
  pairRoomOn,
} from '@pigeon/core'
import { createRoot } from 'solid-js'
import { describe, expect, it } from 'vitest'
import type { Clock } from '../../../platform/clock/clock.ts'
import { createMemoryStore, type Store } from '../../../platform/storage/storage.ts'
import { createMessenger, type FriendView, type MessengerEvents, MUTED_FOREVER } from './service.ts'

const never = new Promise<void>(() => undefined)

function fakeClock(start = 1_000_000): Clock & { tick(ms: number): Promise<void> } {
  let time = start
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

async function pair(
  network: Network,
  events: { a?: MessengerEvents; b?: MessengerEvents } = {},
  by: 'link' | 'code' = 'link',
  clock = fakeClock(),
) {
  const a = await messenger(network, 'rook', { clock, ...(events.a ? { events: events.a } : {}) })
  const b = await messenger(network, 'mika', { clock, ...(events.b ? { events: events.b } : {}) })
  await a.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
  await b.messenger.setProfile({ handle: 'Mika', status: 'away', message: 'brb' })
  await a.messenger.newInvite()
  const link = a.messenger.inviteLink() ?? ''
  expect(link).toMatch(/^https:\/\/pigeon\.test\/#i\/[a-z2-7]{21}$/)
  expect(a.messenger.inviteCode()).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/)
  const invite = decodeInvite(by === 'link' ? link : (a.messenger.inviteCode() ?? ''))
  if (!invite.ok) throw new Error('bad invite')
  const opened = await b.messenger.open(invite.value, never)
  if (!opened.ok) throw new Error(opened.error)
  expect(opened.offer.friend.handle).toBe('Rook')
  expect(opened.offer.checked).toBe(by === 'link')
  // Nobody is a friend until Mika agrees.
  expect(a.messenger.friends()).toEqual([])
  expect(await opened.offer.confirm(never)).toBe(true)
  await flush()
  return { a, b, clock }
}

const only = (list: readonly FriendView[]) => {
  expect(list).toHaveLength(1)
  return list[0] as FriendView
}

describe('the Messenger service', () => {
  it('renames and mutes a friend, and keeps both across a reload', async () => {
    const network = createMemoryNetwork()
    const { a, clock } = await pair(network)
    const mikaId = only(a.messenger.friends()).id
    await a.messenger.rename(mikaId, '  Mika (work)  ')
    expect(a.messenger.friend(mikaId)).toMatchObject({ handle: 'Mika', name: 'Mika (work)' })
    await a.messenger.mute(mikaId, clock.now() + 60_000)
    expect(a.messenger.muted(mikaId)).toBe(true)
    await clock.tick(61_000)
    expect(a.messenger.muted(mikaId)).toBe(false)
    await a.messenger.mute(mikaId, MUTED_FOREVER)

    const again = await messenger(network, 'rook', { store: a.store, clock })
    expect(again.messenger.friend(mikaId)).toMatchObject({ name: 'Mika (work)' })
    expect(again.messenger.muted(mikaId)).toBe(true)
    await again.messenger.rename(mikaId, '')
    expect(again.messenger.friend(mikaId)?.name).toBe('Mika')
  })

  it('removes a friend, tells them, and with a block refuses their next invite', async () => {
    const network = createMemoryNetwork()
    const told: string[] = []
    const { a, b } = await pair(network, {
      b: { onUnfriended: (friend) => told.push(friend.name) },
    })
    const mikaId = only(a.messenger.friends()).id
    const rookId = only(b.messenger.friends()).id
    await b.messenger.send(rookId, 'hi')
    await flush()
    await a.messenger.remove(mikaId, { block: true })
    await flush()
    expect(a.messenger.friends()).toEqual([])
    expect(await a.store.get(`log:${mikaId}`)).toBeUndefined()
    expect(a.messenger.blocked().map((person) => person.handle)).toEqual(['Mika'])
    // Mika's side is told, and keeps the chat read-only.
    expect(told).toEqual(['Rook'])
    expect(b.messenger.friend(rookId)?.removedYouAt).toBeTypeOf('number')
    expect(b.messenger.friend(rookId)?.log.entries).toHaveLength(1)

    // Rook's new invite won't answer a blocked Mika.
    await a.messenger.newInvite()
    const invite = decodeInvite(a.messenger.inviteCode() ?? '')
    if (!invite.ok) throw new Error('bad invite')
    let giveUp: () => void = () => undefined
    const opened = b.messenger.open(
      invite.value,
      new Promise<void>((resolve) => {
        giveUp = resolve
      }),
    )
    await flush()
    giveUp()
    expect(await opened).toEqual({ ok: false, error: 'stopped' })
    await a.messenger.unblock(mikaId)
    expect(a.messenger.blocked()).toEqual([])
  })

  it('tells a removed friend who was offline once they come back', async () => {
    const network = createMemoryNetwork()
    const { a, b, clock } = await pair(network)
    const mikaId = only(a.messenger.friends()).id
    const rookId = only(b.messenger.friends()).id
    b.transport.disconnect()
    await flush()
    await a.messenger.remove(mikaId, { block: false })
    // Kept with the secret, so the farewell finds them in their private room (decision 0026).
    expect(await a.store.get('farewells')).toEqual([
      { id: mikaId, secret: expect.any(String), moved: true },
    ])

    const back = await messenger(network, 'mika', { store: b.store, clock })
    await flush()
    expect(back.messenger.friend(rookId)?.removedYouAt).toBeTypeOf('number')
    await flush()
    expect(await a.store.get('farewells')).toEqual([])
  })

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

  it('pairs from a typed code, unchecked', async () => {
    const { a, b } = await pair(createMemoryNetwork(), {}, 'code')
    expect(only(a.messenger.friends()).handle).toBe('Mika')
    expect(only(b.messenger.friends()).handle).toBe('Rook')
  })

  it('refuses its own invite and makes no invite without a name', async () => {
    const a = await messenger(createMemoryNetwork(), 'rook')
    expect(await a.messenger.newInvite()).toBeUndefined()
    await a.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    const hosted = await a.messenger.newInvite()
    if (hosted === undefined) throw new Error('no invite')
    expect(await a.messenger.open({ code: hosted.code }, never)).toEqual({
      ok: false,
      error: 'own',
    })
    const link = decodeInvite(a.messenger.inviteLink() ?? '')
    if (!link.ok) throw new Error('bad link')
    expect(await a.messenger.open(link.value, never)).toEqual({ ok: false, error: 'own' })
  })

  it('lets an invite lapse after 30 minutes, also across a reload', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock()
    const store = createMemoryStore()
    const a = await messenger(network, 'rook', { clock, store })
    await a.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    await a.messenger.newInvite()
    await clock.tick(29 * 60 * 1000)
    expect(a.messenger.invite()).toBeDefined()
    await clock.tick(60 * 1000)
    expect(a.messenger.invite()).toBeUndefined()
    expect(await store.get('invite')).toBeUndefined()

    await a.messenger.newInvite()
    await a.messenger.close()
    await clock.tick(31 * 60 * 1000)
    const again = await messenger(network, 'rook', { clock, store })
    expect(again.messenger.invite()).toBeUndefined()
  })
})

const NOON = Date.parse('2026-11-24T12:00:00Z')
const rookId = fakeSigner('rook').id
const mikaId = fakeSigner('mika').id
const legacy = () => pairRoom(fakeCrypto, rookId, mikaId)
const HOUR = 60 * 60 * 1000

/** The pair rooms a transport's joins named, other than invite rooms. */
const pairJoins = (network: Network) =>
  network.joins.filter((join) => join.name.startsWith('pair:'))

/** Rook and Mika as friends from before 0026: no secret, meeting in the old room. */
async function oldFriends(network: Network, clock = fakeClock(NOON)) {
  const { a, b } = await pair(network, {}, 'link', clock)
  await a.messenger.close()
  await b.messenger.close()
  for (const side of [a, b]) {
    const friends = (await side.store.get('friends')) as Record<string, unknown>[]
    await side.store.set(
      'friends',
      friends.map(({ secret: _secret, moved: _moved, ...rest }) => rest),
    )
  }
  return { a: a.store, b: b.store, clock }
}

describe('private rooms (decision 0026)', () => {
  it('pairs into a room named from a shared secret and locked with it', async () => {
    const network = createMemoryNetwork()
    const { a, b } = await pair(network, {}, 'link', fakeClock(NOON))
    const rook = only(b.messenger.friends())
    const mika = only(a.messenger.friends())
    expect(mika.secret).toBeDefined()
    expect(rook.secret).toBe(mika.secret)
    expect(rook.moved && mika.moved).toBe(true)
    expect(network.occupants(await legacy())).toBe(0)
    const today = await pairRoomOn(fakeCrypto, mika.secret ?? '', '2026-11-24')
    expect(network.occupants(today)).toBe(2)
    expect(
      network.joins.filter((join) => join.name === today).every((j) => j.options.password),
    ).toBe(true)
    await b.messenger.send(rook.id, 'hi from the new room')
    await flush()
    expect(a.messenger.friend(mika.id)?.log.entries.map((entry) => entry.text)).toEqual([
      'hi from the new room',
    ])
  })

  it('shows someone who knows both ids nothing: not when they meet, and no hello', async () => {
    const network = createMemoryNetwork()
    await pair(network, {}, 'link', fakeClock(NOON))
    const name = await legacy()
    // Eve computes the old room from both ids and waits there.
    const eve = await network.transport().join(name)
    const heard: Uint8Array[] = []
    eve.onMessage((_from, message) => heard.push(message))
    const met: string[] = []
    eve.onPeerJoin((peer) => met.push(peer))
    await flush()
    expect(eve.peers()).toEqual([])
    expect(met).toEqual([])
    expect(heard).toEqual([])
    // Every other pair room they joined was locked.
    for (const join of pairJoins(network))
      if (join.name !== name) expect(join.options.password).toBeDefined()
    // Neither of them ever joined the old room: Eve is the only one who did.
    expect(network.joins.filter((join) => join.name === name)).toHaveLength(1)
  })

  it('moves friends from before the secret the next time they meet', async () => {
    const network = createMemoryNetwork()
    const stores = await oldFriends(network)
    const a = await messenger(network, 'rook', { store: stores.a, clock: stores.clock })
    const b = await messenger(network, 'mika', { store: stores.b, clock: stores.clock })
    await flush()
    const mika = only(a.messenger.friends())
    const rook = only(b.messenger.friends())
    expect(mika.secret).toBeDefined()
    expect(rook.secret).toBe(mika.secret)
    expect(mika.moved && rook.moved).toBe(true)
    // Both have left the old room, and the chat came along.
    expect(network.occupants(await legacy())).toBe(0)
    expect(a.messenger.friend(mika.id)?.online).toBe(true)
    await a.messenger.send(mika.id, 'moved')
    await flush()
    expect(b.messenger.friend(rook.id)?.log.entries.map((entry) => entry.text)).toEqual(['moved'])

    // It sticks: after a reload neither goes back to the old room.
    await a.messenger.close()
    await b.messenger.close()
    const before = network.joins.length
    await messenger(network, 'rook', { store: stores.a, clock: stores.clock })
    await messenger(network, 'mika', { store: stores.b, clock: stores.clock })
    await flush()
    const name = await legacy()
    expect(network.joins.slice(before).some((join) => join.name === name)).toBe(false)
  })

  it('keeps waiting in the old room for a friend who hasn’t come back', async () => {
    const network = createMemoryNetwork()
    const stores = await oldFriends(network)
    const a = await messenger(network, 'rook', { store: stores.a, clock: stores.clock })
    await flush()
    expect(only(a.messenger.friends()).moved).toBeUndefined()
    expect(network.occupants(await legacy())).toBe(1)
  })

  it('moves a friend from before 0026 once they update, if they never got a secret', async () => {
    // Mika paired with a Pigeon from before 0026 and has no secret; Rook made one when pairing.
    const network = createMemoryNetwork()
    const stores = await oldFriends(network)
    const friends = (await stores.a.get('friends')) as Record<string, unknown>[]
    const kept = 'a'.repeat(52)
    await stores.a.set(
      'friends',
      friends.map((record) => ({ ...record, secret: kept })),
    )
    const a = await messenger(network, 'rook', { store: stores.a, clock: stores.clock })
    const b = await messenger(network, 'mika', { store: stores.b, clock: stores.clock })
    await flush()
    const mika = only(a.messenger.friends())
    const rook = only(b.messenger.friends())
    expect(mika.moved && rook.moved).toBe(true)
    expect(rook.secret).toBe(mika.secret)
    expect(network.occupants(await legacy())).toBe(0)
  })

  it('renames the room each UTC day, in both rooms around midnight', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(Date.parse('2026-11-24T22:30:00Z'))
    const { a, b } = await pair(network, {}, 'link', clock)
    const secret = only(a.messenger.friends()).secret ?? ''
    const day24 = await pairRoomOn(fakeCrypto, secret, '2026-11-24')
    const day25 = await pairRoomOn(fakeCrypto, secret, '2026-11-25')
    expect(network.occupants(day24)).toBe(2)
    expect(network.occupants(day25)).toBe(0)

    await clock.tick(HOUR) // 23:30: tomorrow's room too
    expect(network.occupants(day24)).toBe(2)
    expect(network.occupants(day25)).toBe(2)
    await clock.tick(HOUR) // 00:30: still both
    expect(network.occupants(day24)).toBe(2)
    await clock.tick(HOUR) // 01:30: only today's
    expect(network.occupants(day24)).toBe(0)
    expect(network.occupants(day25)).toBe(2)

    const mika = only(a.messenger.friends())
    expect(mika.online).toBe(true)
    await b.messenger.send(only(b.messenger.friends()).id, 'after midnight')
    await flush()
    expect(a.messenger.friend(mika.id)?.log.entries.map((entry) => entry.text)).toEqual([
      'after midnight',
    ])
  })

  it('meets across midnight when clocks are 40 minutes apart', async () => {
    const network = createMemoryNetwork()
    const { a, b } = await pair(network, {}, 'link', fakeClock(NOON))
    await a.messenger.close()
    await b.messenger.close()
    // Rook's clock says 23:40 on the 24th, Mika's 00:20 on the 25th.
    const rook = await messenger(network, 'rook', {
      store: a.store,
      clock: fakeClock(Date.parse('2026-11-24T23:40:00Z')),
    })
    await messenger(network, 'mika', {
      store: b.store,
      clock: fakeClock(Date.parse('2026-11-25T00:20:00Z')),
    })
    await flush()
    expect(only(rook.messenger.friends()).online).toBe(true)
  })

  it('goes through the relay only when asked, and remembers it', async () => {
    const network = createMemoryNetwork()
    const { a } = await pair(network, {}, 'link', fakeClock(NOON))
    expect(a.messenger.settings().relayOnly).toBe(false)
    expect(network.joins.some((join) => join.options.relayOnly)).toBe(false)
    const before = network.joins.length
    await a.messenger.setRelayOnly(true)
    await flush()
    const after = network.joins.slice(before)
    expect(after.length).toBeGreaterThan(0)
    expect(after.every((join) => join.options.relayOnly === true)).toBe(true)
    expect(only(a.messenger.friends()).online).toBe(true)
    const again = await messenger(network, 'rook', { store: a.store })
    expect(again.messenger.settings().relayOnly).toBe(true)
  })
})

/** Links a fresh device called `name` to `from`'s identity, and starts it as that identity. */
async function linkDevice(
  network: Network,
  from: Awaited<ReturnType<typeof messenger>>,
  name: string,
  clock: Clock,
) {
  const fresh = await messenger(network, name, { clock })
  const linking = await from.messenger.startLink()
  if (linking === undefined) throw new Error('could not start linking')
  const target = decodeDeviceLink(linking.link)
  if (!target.ok) throw new Error('bad link')
  const joined = await fresh.messenger.joinIdentity(target.value, never)
  if (!joined.ok) throw new Error(joined.error)
  await flush()
  const request = from.messenger.linking()?.request
  expect(request?.check).toBe(joined.offer.check)
  const confirmed = joined.offer.confirmed(never)
  const status = await from.messenger.confirmLink(name)
  expect(await confirmed).toBe(true)
  await fresh.messenger.close()
  await flush()
  // Started again, this browser is the identity it was linked to.
  const started = await messenger(network, name, { clock, store: fresh.store })
  await flush()
  return { device: started, status }
}

describe('your devices (decision 0024)', () => {
  it('links a phone to a laptop: Mika sees one Toms, and the phone’s message reaches the laptop', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const { a: laptop, b: mika } = await pair(network, {}, 'link', clock)
    const { device: phone, status } = await linkDevice(network, laptop, 'rook-phone', clock)
    expect(status).toBe('linked')

    // The phone is Rook: same identity, profile and friend, and Mika is online to it.
    expect(phone.messenger.self).toBe(laptop.messenger.self)
    expect(phone.messenger.device).not.toBe(laptop.messenger.device)
    expect(phone.messenger.profile().handle).toBe('Rook')
    const mikaOnPhone = only(phone.messenger.friends())
    expect(mikaOnPhone.id).toBe(only(laptop.messenger.friends()).id)
    expect(mikaOnPhone.online).toBe(true)

    // Mika still has one Rook, who now has two devices.
    const rook = only(mika.messenger.friends())
    expect(rook.devices).toBe(2)

    await phone.messenger.send(mikaOnPhone.id, 'sent from my phone')
    await flush()
    const texts = (view: FriendView | undefined) => view?.log.entries.map((entry) => entry.text)
    expect(texts(mika.messenger.friend(rook.id))).toEqual(['sent from my phone'])
    expect(texts(laptop.messenger.friend(mikaOnPhone.id))).toEqual(['sent from my phone'])
    // On the laptop it's Rook's own message, not Mika's.
    const entry = laptop.messenger.friend(mikaOnPhone.id)?.log.entries[0]
    expect(laptop.messenger.isMine(entry?.author ?? '')).toBe(true)
    expect(laptop.messenger.friend(mikaOnPhone.id)?.unread).toBe(0)

    // And the other way, the laptop's message shows on the phone, even with Mika gone.
    await mika.messenger.close()
    await laptop.messenger.send(mikaOnPhone.id, 'and from my laptop')
    await flush()
    expect(texts(phone.messenger.friend(mikaOnPhone.id))).toEqual([
      'sent from my phone',
      'and from my laptop',
    ])
  })

  it('links a third device from the first, and from nowhere else', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const { a: laptop, b: mika } = await pair(network, {}, 'link', clock)
    const { device: phone, status } = await linkDevice(network, laptop, 'rook-phone', clock)
    expect(status).toBe('linked')
    // The phone can't link or remove anything (decision 0024).
    expect(phone.messenger.isFirstDevice()).toBe(false)
    expect(await phone.messenger.startLink()).toBeUndefined()
    await phone.messenger.removeDevice(laptop.messenger.device)
    expect(laptop.messenger.deviceStatus()).toBe('active')
    // The laptop links a tablet straight on, and Mika takes it as Rook.
    const { device: tablet } = await linkDevice(network, laptop, 'rook-tablet', clock)
    await flush()
    expect(tablet.messenger.deviceStatus()).toBe('active')
    expect(only(mika.messenger.friends()).devices).toBe(3)
    expect(only(tablet.messenger.friends()).online).toBe(true)
  })

  it('removes a lost device: friends and your other devices stop taking it', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const { a: laptop, b: mika } = await pair(network, {}, 'link', clock)
    let removed = 0
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock)
    const phoneAgain = await messenger(network, 'rook-phone', {
      clock,
      store: phone.store,
      events: { onDeviceRemoved: () => (removed += 1) },
    })
    await phone.messenger.close()
    await flush()
    await laptop.messenger.removeDevice(phone.messenger.device)
    await flush()
    expect(removed).toBe(1)
    expect(phoneAgain.messenger.deviceStatus()).toBe('removed')
    expect(only(mika.messenger.friends()).devices).toBe(1)
    expect(laptop.messenger.devices().map((view) => view.here)).toEqual([true])
  })

  it('only links a device with no friends of its own', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const { a: laptop, b: mika } = await pair(network, {}, 'link', clock)
    const linking = await laptop.messenger.startLink()
    const target = decodeDeviceLink(linking?.link ?? '')
    if (!target.ok) throw new Error('bad link')
    expect(await mika.messenger.joinIdentity(target.value, never)).toEqual({
      ok: false,
      error: 'has-friends',
    })
  })

  it('leaves a stolen phone nothing once the first device removes it', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const { a: laptop, b: mika } = await pair(network, {}, 'link', clock)
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock)
    await laptop.messenger.removeDevice(phone.messenger.device)
    await flush()
    expect(phone.messenger.deviceStatus()).toBe('removed')
    expect(laptop.messenger.deviceStatus()).toBe('active')
    expect(only(mika.messenger.friends()).devices).toBe(1)
    // Whatever it sends now, nobody takes; the laptop still reaches Mika.
    await phone.messenger.send(only(phone.messenger.friends()).id, 'it is me, Rook')
    await laptop.messenger.send(only(laptop.messenger.friends()).id, 'still me')
    await flush()
    expect(only(mika.messenger.friends()).log.entries.map((entry) => entry.text)).toEqual([
      'still me',
    ])
  })

  it('keeps what a removed device wrote before, for a device linked after', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const { a: laptop, b: mika } = await pair(network, {}, 'link', clock)
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock)
    await phone.messenger.send(only(phone.messenger.friends()).id, 'from the old phone')
    await flush()
    await clock.tick(60_000)
    await laptop.messenger.removeDevice(phone.messenger.device)
    await phone.messenger.close()
    await flush()
    // A new tablet catches up from Mika, old phone's message and all.
    await laptop.messenger.close()
    const back = await messenger(network, 'rook', { clock, store: laptop.store })
    await flush()
    const { device: tablet } = await linkDevice(network, back, 'rook-tablet', clock)
    await back.messenger.close()
    await flush()
    expect(only(mika.messenger.friends()).online).toBe(true)
    expect(only(tablet.messenger.friends()).log.entries.map((entry) => entry.text)).toEqual([
      'from the old phone',
    ])
  })

  it('refuses to link when everything wouldn’t fit, leaving the list as it was', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const store = createMemoryStore({
      blocked: Array.from({ length: 900 }, (_, index) => ({
        id: fakeSigner(`blocked-${index}`).id,
        handle: `Blocked ${index}`,
        at: 1,
      })),
    })
    const laptop = await messenger(network, 'rook', { clock, store })
    await laptop.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    const fresh = await messenger(network, 'rook-phone', { clock })
    const linking = await laptop.messenger.startLink()
    const target = decodeDeviceLink(linking?.link ?? '')
    if (!target.ok) throw new Error('bad link')
    const joined = await fresh.messenger.joinIdentity(target.value, never)
    if (!joined.ok) throw new Error(joined.error)
    await flush()
    expect(await laptop.messenger.confirmLink('Phone')).toBe('too-big')
    expect(laptop.messenger.devices()).toHaveLength(1)
  })
})
