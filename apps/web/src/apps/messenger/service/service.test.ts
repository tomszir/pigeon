import {
  createLighthouseClient,
  createMemoryNetwork,
  decodeDeviceLink,
  decodeInvite,
  fakeCrypto,
  fakeSealCrypto,
  fakeSigner,
  flush,
  type LighthouseAddress,
  type LighthouseClient,
  pairRoom,
  pairRoomOn,
} from '@pigeon/core'
import { createLighthouse, createMemoryStore as createMailStore } from '@pigeon/lighthouse'
import { createRoot } from 'solid-js'
import { describe, expect, it } from 'vitest'
import type { Clock } from '../../../platform/clock/clock.ts'
import { createMemoryStore, type Store } from '../../../platform/storage/storage.ts'
import { createMessenger, type FriendView, type MessengerEvents, MUTED_FOREVER } from './service.ts'

const never = new Promise<void>(() => undefined)
/** Every test Pigeon's random draws so far, so no two draws are the same. */
let draws = 0

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
  options: {
    store?: Store
    clock?: Clock
    events?: MessengerEvents
    seed?: number
    lighthouses?: readonly LighthouseAddress[]
    lighthouse?: TestLighthouse
  } = {},
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
      // Known bytes, but a new draw each time, even after a restart, as ids taken once need.
      random: (length) => {
        const bytes = new Uint8Array(length).fill(options.seed ?? name.length)
        draws += 1
        bytes[0] = draws % 256
        bytes[1] = Math.floor(draws / 256) % 256
        return bytes
      },
      inviteBase: 'https://pigeon.test/',
      // Each device's own sealing key, the same across its restarts, as a stored one would be.
      seal: { crypto: fakeSealCrypto(), sealer: fakeSealCrypto().sealer(name) },
      ...(options.lighthouses === undefined ? {} : { lighthouses: options.lighthouses }),
      ...(options.lighthouse === undefined
        ? {}
        : {
            lighthouses: [options.lighthouse.address],
            lighthouseClient: options.lighthouse.client,
          }),
      ...(options.events === undefined ? {} : { events: options.events }),
    }),
  }))
}

interface TestLighthouse {
  readonly address: LighthouseAddress
  readonly client: () => LighthouseClient
  /** While down, it closes every connection and takes no new one. */
  down(value: boolean): void
}

/** A real Lighthouse in memory, reached over a socket that carries frames straight to it. */
function testLighthouse(clock: Clock): TestLighthouse {
  const signer = fakeSigner('test-lighthouse')
  const lighthouse = createLighthouse({
    signer,
    crypto: fakeCrypto,
    store: createMailStore(),
    now: clock.now,
    name: 'Test Lighthouse',
    software: { name: 'pigeon-lighthouse', version: '0.0.0' },
  })
  let n = 0
  let isDown = false
  const open = new Set<() => void>()
  return {
    down(value) {
      isDown = value
      if (value) for (const close of [...open]) close()
    },
    address: { id: signer.id, name: 'Test Lighthouse', url: 'wss://lighthouse.test/' },
    client: () =>
      createLighthouseClient({
        address: { id: signer.id, name: 'Test Lighthouse', url: 'wss://lighthouse.test/' },
        crypto: fakeCrypto,
        random: (length) => new Uint8Array(length).fill(++n % 250),
        sleep: () => new Promise(() => undefined),
        open: (_url, events) => {
          if (isDown) {
            void Promise.resolve().then(events.onClose)
            return { send: () => undefined, close: () => undefined }
          }
          const connection = lighthouse.connect('203.0.113.7')
          const close = () => {
            if (open.delete(close)) events.onClose()
          }
          open.add(close)
          void Promise.resolve().then(events.onOpen)
          return {
            send: (text) => void connection.receive(text).then(events.onMessage),
            close,
          }
        },
      }),
  }
}

async function pair(
  network: Network,
  events: { a?: MessengerEvents; b?: MessengerEvents } = {},
  by: 'link' | 'code' = 'link',
  clock = fakeClock(),
) {
  const a = await messenger(network, 'rook', { clock, ...(events.a ? { events: events.a } : {}) })
  const b = await messenger(network, 'mika', { clock, ...(events.b ? { events: events.b } : {}) })
  await pairWith(a, b, by)
  return { a, b, clock }
}

/** Rook (`a`) invites Mika (`b`), who agrees: friends, through the invite handshake. */
async function pairWith(
  a: Awaited<ReturnType<typeof messenger>>,
  b: Awaited<ReturnType<typeof messenger>>,
  by: 'link' | 'code' = 'link',
) {
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
}

const only = <T = FriendView>(list: readonly T[]): T => {
  expect(list).toHaveLength(1)
  return list[0] as T
}

describe('the Messenger service', () => {
  it('shows a friend’s new name while they are online, and keeps it', async () => {
    const network = createMemoryNetwork()
    const { a, b, clock } = await pair(network)
    const mikaId = only(a.messenger.friends()).id
    await b.messenger.setProfile({ ...b.messenger.profile(), handle: 'Mika M.' })
    await flush()
    expect(a.messenger.friend(mikaId)?.handle).toBe('Mika M.')
    expect(a.messenger.friend(mikaId)?.name).toBe('Mika M.')
    const again = await messenger(network, 'rook', { store: a.store, clock })
    expect(again.messenger.friend(mikaId)?.handle).toBe('Mika M.')
  })

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

  it('leaves a farewell in an offline friend’s mailbox, heard without meeting again', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const a = await messenger(network, 'rook', { clock, lighthouse })
    const b = await messenger(network, 'mika', { clock, lighthouse })
    await pairWith(a, b)
    const mikaId = only(a.messenger.friends()).id
    const rookId = only(b.messenger.friends()).id
    // Mika's Pigeon closes; Rook removes her while she's away.
    await b.messenger.close()
    b.transport.disconnect()
    await flush()
    await a.messenger.remove(mikaId, { block: false })
    await flush(400)
    expect(await a.store.get('farewells')).toEqual([
      expect.objectContaining({ id: mikaId, mailed: true }),
    ])
    // Mika opens Pigeon on a network where she can't meet Rook: only her mailbox has it.
    a.transport.disconnect()
    const back = await messenger(createMemoryNetwork(), 'mika', {
      clock,
      lighthouse,
      store: b.store,
    })
    await flush(800)
    expect(back.messenger.friend(rookId)?.removedYouAt).toBeTypeOf('number')
    // Her receipt reaches Rook's mailbox, and his farewell stops waiting.
    await a.messenger.checkMail()
    expect(await a.store.get('farewells')).toEqual([])
  })

  it('tells a removed friend who was offline once they come back', async () => {
    const network = createMemoryNetwork()
    const { a, b, clock } = await pair(network)
    const mikaId = only(a.messenger.friends()).id
    const rookId = only(b.messenger.friends()).id
    b.transport.disconnect()
    await flush()
    await a.messenger.remove(mikaId, { block: false })
    // Kept with the secret, so the farewell finds them in their private room.
    expect(await a.store.get('farewells')).toEqual([
      { id: mikaId, secret: expect.any(String), moved: true },
    ])

    const back = await messenger(network, 'mika', { store: b.store, clock })
    await flush()
    expect(back.messenger.friend(rookId)?.removedYouAt).toBeTypeOf('number')
    await flush()
    expect(await a.store.get('farewells')).toEqual([])
  })

  it('starts again with a farewell still owed, and says it once they are back', async () => {
    const network = createMemoryNetwork()
    const { a, b, clock } = await pair(network)
    const mikaId = only(a.messenger.friends()).id
    const rookId = only(b.messenger.friends()).id
    b.transport.disconnect()
    await flush()
    await a.messenger.remove(mikaId, { block: false })
    await a.messenger.close()
    // Reloaded before Mika heard: it has to start, not fail on the farewell it owes.
    const again = await messenger(network, 'rook', { store: a.store, clock })
    expect(again.messenger.friends()).toEqual([])
    const back = await messenger(network, 'mika', { store: b.store, clock })
    await flush()
    expect(back.messenger.friend(rookId)?.removedYouAt).toBeTypeOf('number')
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

/** Rook and Mika as friends from before pair secrets: no secret, meeting in the old room. */
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

describe('private rooms', () => {
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

  it('moves a friend from before pair secrets once they update, if they never got a secret', async () => {
    // Mika paired with a Pigeon from before pair secrets and has no secret; Rook made one when
    // pairing.
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
  lighthouse?: TestLighthouse,
) {
  const options = { clock, ...(lighthouse === undefined ? {} : { lighthouse }) }
  const fresh = await messenger(network, name, options)
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
  const started = await messenger(network, name, { ...options, store: fresh.store })
  await flush()
  return { device: started, status }
}

/** Rook's laptop and phone, linked, both leaving and fetching mail at one Lighthouse. */
async function laptopAndPhone() {
  const network = createMemoryNetwork()
  const clock = fakeClock(NOON)
  const lighthouse = testLighthouse(clock)
  const laptop = await messenger(network, 'rook', { clock, lighthouse })
  await laptop.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
  const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock, lighthouse)
  await flush()
  return { network, clock, lighthouse, laptop, phone }
}

/** The phone's Pigeon closes and its network goes: it meets nobody until it opens again. */
async function away(device: Awaited<ReturnType<typeof messenger>>) {
  await device.messenger.close()
  device.transport.disconnect()
  await flush()
}

describe('your devices through the self mailbox', () => {
  it('catches a phone that was offline up on your name and Lighthouses', async () => {
    const { clock, lighthouse, laptop, phone } = await laptopAndPhone()
    await away(phone)
    await clock.tick(1000)
    await laptop.messenger.setProfile({ ...laptop.messenger.profile(), handle: 'Toms' })
    const second: LighthouseAddress = {
      id: fakeSigner('second').id,
      name: 'Second',
      url: 'wss://second.example/',
    }
    await laptop.messenger.setLighthouses([lighthouse.address, second])
    await flush(400)

    // The phone opens where it can't meet the laptop: only its mailbox has the news.
    laptop.transport.disconnect()
    const back = await messenger(createMemoryNetwork(), 'rook-phone', {
      clock,
      lighthouse,
      store: phone.store,
    })
    await flush(800)
    expect(back.messenger.profile().handle).toBe('Toms')
    expect(back.messenger.lighthouses()).toEqual([lighthouse.address, second])
    // Its receipts reach the laptop, which stops putting the news again.
    await laptop.messenger.checkMail()
    expect(await laptop.store.get('mail-outbox')).toEqual([])
  })

  it('keeps one snapshot waiting for a device that’s away, however often you change things', async () => {
    const { clock, laptop, phone } = await laptopAndPhone()
    await away(phone)
    for (const handle of ['Toms', 'Toms Z.', 'Tom']) {
      await clock.tick(1000)
      await laptop.messenger.setProfile({ ...laptop.messenger.profile(), handle })
      await flush(200)
    }
    const outbox = (await laptop.store.get('mail-outbox')) as { body: { profile?: unknown } }[]
    expect(outbox).toHaveLength(1)
    expect(outbox[0]?.body.profile).toMatchObject({ handle: 'Tom' })
  })

  it('shares a Lighthouse list changed before devices shared theirs, once', async () => {
    const { clock, lighthouse, laptop, phone } = await laptopAndPhone()
    const second: LighthouseAddress = {
      id: fakeSigner('second').id,
      name: 'Second',
      url: 'wss://second.example/',
    }
    await away(phone)
    await laptop.messenger.close()
    // As a list kept by an older Pigeon: no time with it.
    await laptop.store.set('lighthouses', [lighthouse.address, second])
    await laptop.store.delete('lighthousesChangedAt')
    await clock.tick(1000)
    await messenger(createMemoryNetwork(), 'rook', { clock, lighthouse, store: laptop.store })
    await flush(400)
    const back = await messenger(createMemoryNetwork(), 'rook-phone', {
      clock,
      lighthouse,
      store: phone.store,
    })
    await flush(800)
    expect(back.messenger.lighthouses()).toEqual([lighthouse.address, second])
  })

  it('tells a removed phone that was offline, and it stops talking', async () => {
    const { clock, lighthouse, laptop, phone } = await laptopAndPhone()
    await away(phone)
    await laptop.messenger.removeDevice(phone.messenger.device)
    await flush(400)
    laptop.transport.disconnect()
    let removed = 0
    const back = await messenger(createMemoryNetwork(), 'rook-phone', {
      clock,
      lighthouse,
      store: phone.store,
      events: { onDeviceRemoved: () => (removed += 1) },
    })
    await flush(800)
    expect(back.messenger.deviceStatus()).toBe('removed')
    expect(removed).toBe(1)
  })

  it('tells a phone that was away about a tablet linked meanwhile, and how to write to it', async () => {
    const { network, clock, lighthouse, laptop, phone } = await laptopAndPhone()
    await away(phone)
    const { device: tablet } = await linkDevice(network, laptop, 'rook-tablet', clock, lighthouse)
    await flush(400)
    laptop.transport.disconnect()
    tablet.transport.disconnect()
    const back = await messenger(createMemoryNetwork(), 'rook-phone', {
      clock,
      lighthouse,
      store: phone.store,
    })
    await flush(800)
    expect(back.messenger.devices().map((view) => view.id)).toContain(tablet.messenger.device)
    const book = await back.messenger.mailBook(back.messenger.self)
    expect(Object.keys(book.keys)).toContain(tablet.messenger.device)
  })

  it('takes nothing from a device removed, even when its letter is fetched before the removal', async () => {
    const { network, clock, lighthouse, laptop, phone } = await laptopAndPhone()
    const { device: tablet } = await linkDevice(network, laptop, 'rook-tablet', clock, lighthouse)
    await flush(400)
    await away(phone)
    await away(tablet)
    // The laptop removes the stolen phone while the Lighthouse is down: nothing is put yet.
    lighthouse.down(true)
    await laptop.messenger.removeDevice(phone.messenger.device)
    await flush(400)
    lighthouse.down(false)
    // The thief's Pigeon never fetches, so it never hears, and renames you to the tablet.
    await phone.store.set('mail-fetched', {
      [lighthouse.address.id]: { cursor: Number.MAX_SAFE_INTEGER, at: clock.now() },
    })
    await clock.tick(1000)
    const thief = await messenger(createMemoryNetwork(), 'rook-phone', {
      clock,
      lighthouse,
      store: phone.store,
    })
    await flush(400)
    expect(thief.messenger.deviceStatus()).toBe('active')
    await thief.messenger.setProfile({ ...thief.messenger.profile(), handle: 'Thief' })
    await flush(400)
    // Only now is the removal put, after the thief's letter.
    await laptop.messenger.checkMail()
    await flush(400)
    laptop.transport.disconnect()
    const back = await messenger(createMemoryNetwork(), 'rook-tablet', {
      clock,
      lighthouse,
      store: tablet.store,
    })
    await flush(800)
    expect(back.messenger.devices().map((view) => view.id)).not.toContain(phone.messenger.device)
    expect(back.messenger.profile().handle).toBe('Rook')
  })

  it('leaves a lost phone, once removed, nothing it can rename you with', async () => {
    const { clock, lighthouse, laptop, phone } = await laptopAndPhone()
    await away(phone)
    // The phone is lost: the laptop removes it, then the thief opens it and renames you.
    await laptop.messenger.removeDevice(phone.messenger.device)
    await flush(400)
    await laptop.messenger.close()
    laptop.transport.disconnect()
    await clock.tick(1000)
    const thief = await messenger(createMemoryNetwork(), 'rook-phone', {
      clock,
      lighthouse,
      store: phone.store,
    })
    await thief.messenger.setProfile({ ...thief.messenger.profile(), handle: 'Thief' })
    await flush(400)
    expect(thief.messenger.deviceStatus()).toBe('removed')
    const again = await messenger(createMemoryNetwork(), 'rook', {
      clock,
      lighthouse,
      store: laptop.store,
    })
    await flush(800)
    expect(again.messenger.profile().handle).toBe('Rook')
  })
})

describe('your devices', () => {
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
    // The phone can't link or remove anything.
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

  it('names each device by its own fingerprint, the same on every device', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const { a: laptop } = await pair(network, {}, 'link', clock)
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock)
    laptop.messenger.devices()
    phone.messenger.devices()
    await flush()
    const prints = (views: readonly { id: string; fingerprint: string }[]) =>
      Object.fromEntries(views.map((view) => [view.id, view.fingerprint]))
    const onLaptop = prints(laptop.messenger.devices())
    expect(Object.values(onLaptop)).toHaveLength(2)
    for (const print of Object.values(onLaptop)) expect(print).toMatch(/^[0-9a-f]{4} [0-9a-f]{4}$/)
    expect(new Set(Object.values(onLaptop)).size).toBe(2)
    expect(prints(phone.messenger.devices())).toEqual(onLaptop)
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

  it('hears where to leave a friend’s mail, and each of their devices’ sealing keys', async () => {
    const network = createMemoryNetwork()
    const official = (n: string): LighthouseAddress => ({
      id: fakeSigner(n).id,
      name: n,
      url: `wss://${n}.example/`,
    })
    const clock = fakeClock(NOON)
    const a = await messenger(network, 'rook', { clock, lighthouses: [official('worker')] })
    const b = await messenger(network, 'mika', { clock, lighthouses: [official('second')] })
    await pairWith(a, b)
    const mikaId = only(a.messenger.friends()).id
    expect(a.messenger.lighthouses()).toEqual([official('worker')])
    const book = await a.messenger.mailBook(mikaId)
    expect(book.lighthouses).toEqual([official('second')])
    expect(Object.keys(book.keys)).toEqual([b.messenger.device])

    // Mika moves her mail: Rook hears at once, while they're both online.
    await b.messenger.setLighthouses([official('elsewhere'), official('elsewhere')])
    await flush()
    expect((await a.messenger.mailBook(mikaId)).lighthouses).toEqual([official('elsewhere')])
  })

  it('keeps your own other devices’ sealing keys under your own id', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const { a: laptop } = await pair(network, {}, 'link', clock)
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock)
    await flush()
    const book = await laptop.messenger.mailBook(laptop.messenger.self)
    expect(Object.keys(book.keys)).toContain(phone.messenger.device)
  })

  it('keeps your name and personal message in step on your devices', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const { a: laptop, b: mika } = await pair(network, {}, 'link', clock)
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock)
    await laptop.messenger.setProfile({ ...laptop.messenger.profile(), handle: 'Toms' })
    await flush()
    expect(phone.messenger.profile().handle).toBe('Toms')
    // Status stays each device's own.
    expect(phone.messenger.profile().status).toBe('online')

    await clock.tick(1000)
    await phone.messenger.setProfile({ ...phone.messenger.profile(), message: 'on the train' })
    await flush()
    expect(laptop.messenger.profile()).toMatchObject({ handle: 'Toms', message: 'on the train' })
    // Friends hear it from whichever device changed it.
    expect(only(mika.messenger.friends()).handle).toBe('Toms')

    // Kept across a restart, with when it changed, so an older name never wins.
    await phone.messenger.close()
    await laptop.messenger.setProfile({ ...laptop.messenger.profile(), handle: 'Toms Z.' })
    const back = await messenger(network, 'rook-phone', { clock, store: phone.store })
    await flush()
    expect(back.messenger.profile().handle).toBe('Toms Z.')
    expect(laptop.messenger.profile().handle).toBe('Toms Z.')
  })

  it('ignores a name stamped far in the future', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const { a: laptop } = await pair(network, {}, 'link', clock)
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock)
    await laptop.messenger.close()
    await phone.messenger.close()
    // As a stolen device might send: a time that would outrank every later rename.
    await phone.store.set('profile', { handle: 'Thief', status: 'online', message: '' })
    await phone.store.set('profileChangedAt', NOON + 365 * 24 * 60 * 60 * 1000)
    const again = await messenger(network, 'rook', { clock, store: laptop.store })
    await messenger(network, 'rook-phone', { clock, store: phone.store })
    await flush()
    expect(again.messenger.profile().handle).toBe('Rook')
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

  it('leaves a Pigeon with friends by telling them, so it can be linked', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const { a: laptop, b: mika } = await pair(network, {}, 'link', clock)
    const rookId = only(mika.messenger.friends()).id
    const progress: string[] = []
    expect(
      await laptop.messenger.leave(never, (step) =>
        progress.push(`${step.step} ${step.done}/${step.total}`),
      ),
    ).toBe(0)
    expect(progress[0]).toBe('removing 0/1')
    expect(progress.at(-1)).toBe('telling 1/1')
    expect(laptop.messenger.friends()).toEqual([])
    expect(mika.messenger.friend(rookId)?.removedYouAt).toBeTypeOf('number')
    const linking = await mika.messenger.startLink()
    const target = decodeDeviceLink(linking?.link ?? '')
    if (!target.ok) throw new Error('bad link')
    // Its own link is never a reason to leave it.
    const own = decodeDeviceLink((await laptop.messenger.startLink())?.link ?? '')
    if (!own.ok) throw new Error('bad link')
    expect(await laptop.messenger.joinIdentity(own.value, never)).toEqual({
      ok: false,
      error: 'own',
    })
    await laptop.messenger.cancelLink()
    // With nobody left it could be linked; the app forgets everything first all the same.
    const joined = await laptop.messenger.joinIdentity(target.value, never)
    expect(joined.ok).toBe(true)
    if (joined.ok) await joined.offer.cancel()
  })

  it('stops waiting to say goodbye to a friend who is offline', async () => {
    const network = createMemoryNetwork()
    const { a, b } = await pair(network)
    b.transport.disconnect()
    await flush()
    expect(await a.messenger.leave(Promise.resolve())).toBe(1)
    expect(a.messenger.friends()).toEqual([])
  })

  it("tells nobody when leaving a Pigeon that's on other devices too", async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const { a: laptop, b: mika } = await pair(network, {}, 'link', clock)
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock)
    await flush()
    expect(await phone.messenger.leave(never)).toBe(0)
    expect(phone.messenger.friends()).toHaveLength(1)
    expect(mika.messenger.friends()[0]?.removedYouAt).toBeUndefined()
    const linking = await mika.messenger.startLink()
    const target = decodeDeviceLink(linking?.link ?? '')
    if (!target.ok) throw new Error('bad link')
    expect(await laptop.messenger.joinIdentity(target.value, never)).toMatchObject({ ok: false })
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

describe('a copied profile', () => {
  it('notices the same device open in two places, and says so once on each', async () => {
    const network = createMemoryNetwork()
    let twins = 0
    const { a: rook, b: mika } = await pair(network, { a: { onTwin: () => (twins += 1) } })
    expect(rook.messenger.twin()).toBe(false)
    // The same browser profile, copied: the same key and data, another run.
    const copy = await messenger(network, 'rook', {
      store: rook.store,
      seed: 99,
      events: { onTwin: () => (twins += 1) },
    })
    await flush()
    expect(rook.messenger.twin()).toBe(true)
    expect(copy.messenger.twin()).toBe(true)
    expect(twins).toBe(2)
    // Mika only ever hears from her friend.
    expect(mika.messenger.twin()).toBe(false)
  })

  it('tells no friend when a copy leaves, since the other copy keeps the Pigeon', async () => {
    const network = createMemoryNetwork()
    const { a: rook, b: mika } = await pair(network)
    const copy = await messenger(network, 'rook', { store: rook.store, seed: 99 })
    await flush()
    expect(copy.messenger.leavingTells()).toBe(false)
    expect(await copy.messenger.leave(never)).toBe(0)
    expect(only(mika.messenger.friends()).removedYouAt).toBeUndefined()
  })
})

describe('export and import', () => {
  it('brings friends, chats and the profile to a device of the same identity', async () => {
    const network = createMemoryNetwork()
    const { a: rook, b: mika } = await pair(network)
    const mikaId = only(rook.messenger.friends()).id
    await rook.messenger.send(mikaId, 'before the export')
    await rook.messenger.rename(mikaId, 'Mika M.')
    await flush()
    const data = JSON.parse(JSON.stringify(rook.messenger.exportData())) as unknown
    expect(JSON.stringify(data)).not.toContain('privateKey')

    // Rook again on an empty browser, as after a recovery, with nobody on it.
    const offline = createMemoryNetwork()
    const fresh = await messenger(offline, 'rook')
    expect(await fresh.messenger.importData(data)).toBe('imported')
    await fresh.messenger.close()
    const again = await messenger(offline, 'rook', { store: fresh.store })
    const back = only(again.messenger.friends())
    expect(back.id).toBe(mikaId)
    expect(back.name).toBe('Mika M.')
    expect(back.secret).toBe(only(rook.messenger.friends()).secret)
    expect(back.log.entries.map((entry) => entry.text)).toEqual(['before the export'])
    expect(again.messenger.profile().handle).toBe('Rook')

    // Someone else's file is refused, and so is anything that isn't one.
    expect(await mika.messenger.importData(data)).toBe('not-yours')
    expect(await rook.messenger.importData({ kind: 'something' })).toBe('unreadable')
  })

  it('merges into what the device has, keeping its own copies', async () => {
    const network = createMemoryNetwork()
    const { a: rook } = await pair(network)
    const mikaId = only(rook.messenger.friends()).id
    await rook.messenger.send(mikaId, 'one')
    await flush()
    const data = JSON.parse(JSON.stringify(rook.messenger.exportData())) as unknown
    await rook.messenger.rename(mikaId, 'Kept here')
    await rook.messenger.send(mikaId, 'two')
    await flush()
    expect(await rook.messenger.importData(data)).toBe('imported')
    await rook.messenger.close()
    const again = await messenger(createMemoryNetwork(), 'rook', { store: rook.store })
    const mika = only(again.messenger.friends())
    expect(mika.name).toBe('Kept here')
    expect(mika.log.entries.map((entry) => entry.text)).toEqual(['one', 'two'])
  })
})

describe('the recovery key', () => {
  type Side = Awaited<ReturnType<typeof messenger>>
  async function pairAgain(host: Side, guest: Side) {
    await host.messenger.newInvite()
    const invite = decodeInvite(host.messenger.inviteLink() ?? '')
    if (!invite.ok) throw new Error('bad invite')
    const opened = await guest.messenger.open(invite.value, never)
    if (!opened.ok) throw new Error(opened.error)
    expect(await opened.offer.confirm(never)).toBe(true)
    await flush()
  }

  it('brings Rook back as Rook with every device lost, and Mika keeps one Rook', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const key = fakeSigner('rook-recovery-1')
    const next = fakeSigner('rook-recovery-2')
    const { a: laptop, b: mika } = await pair(network, {}, 'link', clock)
    expect(await laptop.messenger.commitRecoveryKey(key.id)).toBe(true)
    expect(laptop.messenger.recoveryKey()).toBe(key.id)
    // With an entry, so a friend on a Pigeon from before keeps the whole log, key and all.
    expect((await laptop.store.get('deviceLog')) as { entries: unknown[] }).toMatchObject({
      entries: [{ kind: 'name', device: laptop.messenger.device }],
    })
    // Only once: a thief with the laptop can't swap in a key of their own.
    expect(await laptop.messenger.commitRecoveryKey(next.id)).toBe(false)
    const mikaId = only(laptop.messenger.friends()).id
    await laptop.messenger.send(mikaId, 'before the loss')
    await flush()
    const rook = laptop.messenger.self

    // The laptop is lost. A new browser, nobody on it, takes the key.
    const fresh = await messenger(network, 'rook-new', { clock })
    expect(
      await fresh.messenger.recoverIdentity(rook, laptop.messenger.nextEpoch(), key, next.id),
    ).toBe('recovered')
    const back = await messenger(network, 'rook-new', { clock, store: fresh.store })
    expect(back.messenger.self).toBe(rook)
    expect(back.messenger.isFirstDevice()).toBe(true)
    // Until an old friend hands back the whole list, no device can be linked from here.
    expect(back.messenger.waitingForList()).toBe(true)
    expect(await back.messenger.startLink()).toBeUndefined()
    // Nor can the waiting tail be wiped: not by the next key, nor by linking or another identity.
    expect(back.messenger.canJoin()).toBe(false)
    // Nor offered to leave for another Pigeon: it refuses before any code is used.
    expect(await back.messenger.joinIdentity({ code: 'anything' }, never)).toEqual({
      ok: false,
      error: 'waiting',
    })
    expect(await back.messenger.recoverIdentity(rook, 2, next, fakeSigner('k3').id)).toBe('waiting')
    expect(await back.messenger.recoverIdentity(fakeSigner('someone').id, 1, key, next.id)).toBe(
      'waiting',
    )
    await back.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })

    // Pairing with Mika again: she knows him, and it's the same chat.
    await pairAgain(back, mika)
    const seen = only(mika.messenger.friends())
    expect(seen.id).toBe(rook)
    expect(seen.log.entries.map((entry) => entry.text)).toEqual(['before the loss'])
    expect(seen.devices).toBe(1)
    // Mika handed Rook his whole log back, so the recovered device knows its history.
    expect(back.messenger.waitingForList()).toBe(false)
    expect(back.messenger.recoveryKey()).toBe(next.id)
    await back.messenger.send(only(back.messenger.friends()).id, 'it’s me again')
    await flush()
    expect(only(mika.messenger.friends()).log.entries.map((entry) => entry.text)).toEqual([
      'before the loss',
      'it’s me again',
    ])
    // The recovered device caught up on the chat from before, as Rook's own.
    const onBack = only(back.messenger.friends())
    expect(onBack.log.entries.map((entry) => entry.text)).toEqual([
      'before the loss',
      'it’s me again',
    ])
    expect(back.messenger.isMine(onBack.log.entries[0]?.author ?? '')).toBe(true)
    // The lost laptop, should a thief open it, is nobody to Mika any more.
    await laptop.messenger.send(mikaId, 'it is I, the thief')
    await flush()
    expect(only(mika.messenger.friends()).log.entries).toHaveLength(2)
  })

  async function lostAndRecovered() {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const key = fakeSigner('rook-recovery-1')
    const { a: laptop, b: mika } = await pair(network, {}, 'link', clock)
    await laptop.messenger.commitRecoveryKey(key.id)
    await flush()
    const fresh = await messenger(network, 'rook-new', { clock })
    await fresh.messenger.recoverIdentity(laptop.messenger.self, 1, key, fakeSigner('k2').id)
    const back = await messenger(network, 'rook-new', { clock, store: fresh.store })
    await back.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    return { network, clock, laptop, mika, back }
  }

  it('leaves the lost laptop unable to pair its way back to Mika', async () => {
    const { laptop, mika, back } = await lostAndRecovered()
    await pairAgain(back, mika)
    const secret = only(mika.messenger.friends()).secret
    // The thief, with the laptop, sends Mika a new invite: Mika's Pigeon refuses whoever answers.
    await laptop.messenger.newInvite()
    const invite = decodeInvite(laptop.messenger.inviteLink() ?? '')
    if (!invite.ok) throw new Error('bad invite')
    const opened = await mika.messenger.open(invite.value, flush(400))
    expect(opened.ok).toBe(false)
    expect(only(mika.messenger.friends()).secret).toBe(secret)
  })

  it('pairs again with a friend who had been removed by the lost device', async () => {
    const { laptop, mika, back } = await lostAndRecovered()
    await laptop.messenger.remove(only(laptop.messenger.friends()).id, { block: false })
    await flush()
    expect(only(mika.messenger.friends()).removedYouAt).toBeTypeOf('number')
    await pairAgain(back, mika)
    expect(only(mika.messenger.friends()).removedYouAt).toBeUndefined()
    expect(only(mika.messenger.friends()).devices).toBe(1)
  })

  it('leaves a newly named Pigeon that made a key free to link or recover instead', async () => {
    const network = createMemoryNetwork()
    const fresh = await messenger(network, 'new-browser')
    await fresh.messenger.setProfile({ handle: 'Toms', status: 'online', message: '' })
    expect(await fresh.messenger.commitRecoveryKey(fakeSigner('its-key').id)).toBe(true)
    expect(fresh.messenger.canJoin()).toBe(true)
  })

  it('is refused by a stranger, who never knew the identity it claims', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const thiefKey = fakeSigner('not-rooks-key')
    const { a: laptop } = await pair(network, {}, 'link', clock)
    const stranger = await messenger(network, 'kai', { clock })
    await stranger.messenger.setProfile({ handle: 'Kai', status: 'online', message: '' })
    const fake = await messenger(network, 'fake-rook', { clock })
    expect(
      await fake.messenger.recoverIdentity(laptop.messenger.self, 1, thiefKey, thiefKey.id),
    ).toBe('recovered')
    const posing = await messenger(network, 'fake-rook', { clock, store: fake.store })
    await posing.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    await posing.messenger.newInvite()
    const invite = decodeInvite(posing.messenger.inviteLink() ?? '')
    if (!invite.ok) throw new Error('bad invite')
    const opened = await stranger.messenger.open(invite.value, flush(400))
    expect(opened.ok).toBe(false)
  })
})

describe('invite links through Lighthouses', () => {
  const DAY = 24 * 60 * 60 * 1000

  /** Rook and Mika on networks of their own: they never meet, and share only a Lighthouse. */
  async function apart() {
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const rook = await messenger(createMemoryNetwork(), 'rook', { clock, lighthouse })
    const mika = await messenger(createMemoryNetwork(), 'mika', { clock, lighthouse })
    await rook.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    await mika.messenger.setProfile({ handle: 'Mika', status: 'online', message: '' })
    return { clock, lighthouse, rook, mika }
  }

  async function made(
    who: Awaited<ReturnType<typeof messenger>>,
    options = { lifetime: 7 * DAY, uses: 5 },
  ) {
    const result = await who.messenger.makeInviteLink(options)
    if (!result.ok) throw new Error(result.error)
    expect(result.link.url).toMatch(/^https:\/\/pigeon\.test\/#a\/[a-z2-7]{52}$/)
    return result.link
  }

  async function asks(who: Awaited<ReturnType<typeof messenger>>, url: string) {
    const opened = await who.messenger.openInviteLink(url)
    if (!opened.ok) throw new Error(opened.error)
    expect(await who.messenger.askThroughLink(opened)).toBe('sent')
    return opened
  }

  it('makes friends of two people who are never online together', async () => {
    const { clock, lighthouse, rook, mika } = await apart()
    const link = await made(rook)
    await rook.messenger.close()

    // Mika opens the link with Rook's Pigeon closed: his card says who he is.
    const opened = await mika.messenger.openInviteLink(link.url)
    if (!opened.ok) throw new Error(opened.error)
    expect(opened.card.name).toBe('Rook')
    expect(opened.fingerprint.replaceAll(' ', '')).toBe(rook.messenger.selfFingerprint)
    expect(await mika.messenger.askThroughLink(opened)).toBe('sent')
    await mika.messenger.close()

    // Rook opens Pigeon the next day: Mika's request waits for him.
    await clock.tick(DAY)
    const back = await messenger(createMemoryNetwork(), 'rook', {
      clock,
      lighthouse,
      store: rook.store,
    })
    await flush(400)
    const request = only(back.messenger.inviteLinks()).requests[0]
    expect(request).toMatchObject({ name: 'Mika', state: 'waiting' })
    expect(await back.messenger.approveRequest(link.secret, request?.identity ?? '')).toBe(true)
    expect(only(back.messenger.friends()).handle).toBe('Mika')
    await back.messenger.close()

    // Mika opens Pigeon later still, and Rook is her friend, with the same secret.
    await clock.tick(DAY)
    const mikaBack = await messenger(createMemoryNetwork(), 'mika', {
      clock,
      lighthouse,
      store: mika.store,
    })
    await flush(800)
    const rookOnMika = only(mikaBack.messenger.friends())
    expect(rookOnMika).toMatchObject({ handle: 'Rook', id: rook.messenger.self })
    expect(rookOnMika.secret).toBe(only(back.messenger.friends()).secret)
    expect(mikaBack.messenger.sentAsks()).toEqual([])
  })

  it('pairs within a minute when both happen to be online', async () => {
    const { clock, rook, mika } = await apart()
    const link = await made(rook)
    await asks(mika, link.url)
    await clock.tick(30_000)
    await flush(400)
    const request = only(rook.messenger.inviteLinks()).requests[0]
    await rook.messenger.approveRequest(link.secret, request?.identity ?? '')
    await clock.tick(30_000)
    await flush(400)
    expect(only(mika.messenger.friends()).handle).toBe('Rook')
    // Her receipt comes under their new pair secret, and Rook stops putting the answer again.
    await rook.messenger.checkMail()
    expect(await rook.store.get('mail-outbox')).toEqual([])
  })

  it('tells whoever is waiting when the link is closed', async () => {
    const { clock, rook, mika } = await apart()
    const link = await made(rook)
    await asks(mika, link.url)
    await clock.tick(30_000)
    await flush(400)
    expect(only(rook.messenger.inviteLinks()).requests).toHaveLength(1)
    await rook.messenger.cancelInviteLink(link.secret)
    await clock.tick(30_000)
    await flush(400)
    expect(only(mika.messenger.sentAsks()).state).toBe('closed')
  })

  it('tells someone declined, and uses none of the link', async () => {
    const { clock, rook, mika } = await apart()
    const link = await made(rook)
    await asks(mika, link.url)
    await clock.tick(30_000)
    await flush(400)
    const request = only(rook.messenger.inviteLinks()).requests[0]
    await rook.messenger.declineRequest(link.secret, request?.identity ?? '')
    expect(only(rook.messenger.inviteLinks()).used).toBe(0)
    await clock.tick(30_000)
    await flush(400)
    expect(only(mika.messenger.sentAsks()).state).toBe('declined')
    expect(mika.messenger.friends()).toEqual([])
  })

  it('closes once its uses run out, and says so to whoever opens it next', async () => {
    const { clock, lighthouse, rook, mika } = await apart()
    const link = await made(rook, { lifetime: DAY, uses: 1 })
    await asks(mika, link.url)
    await clock.tick(30_000)
    await flush(400)
    const request = only(rook.messenger.inviteLinks()).requests[0]
    await rook.messenger.approveRequest(link.secret, request?.identity ?? '')
    expect(only(rook.messenger.inviteLinks())).toMatchObject({ used: 1, open: false })
    const late = await messenger(createMemoryNetwork(), 'kestrel', { clock, lighthouse })
    await late.messenger.setProfile({ handle: 'Kestrel', status: 'online', message: '' })
    expect(await late.messenger.openInviteLink(link.url)).toEqual({ ok: false, error: 'closed' })
  })

  it('answers a request that comes after the link was cancelled', async () => {
    const { clock, rook, mika } = await apart()
    const link = await made(rook)
    const opened = await mika.messenger.openInviteLink(link.url)
    if (!opened.ok) throw new Error(opened.error)
    await rook.messenger.cancelInviteLink(link.secret)
    expect(await mika.messenger.openInviteLink(link.url)).toEqual({ ok: false, error: 'closed' })
    // Asked from the card Mika saw before it closed.
    expect(await mika.messenger.askThroughLink(opened)).toBe('sent')
    // A closed link is looked at only at the usual mail check, every 10 minutes.
    await clock.tick(10 * 60_000)
    await flush(400)
    await clock.tick(30_000)
    await flush(400)
    expect(only(mika.messenger.sentAsks()).state).toBe('closed')
    expect(only(rook.messenger.inviteLinks()).requests).toEqual([])
  })

  it('closes the links of a device you remove, from your other devices', async () => {
    const { clock, lighthouse, laptop, phone } = await laptopAndPhone()
    const result = await phone.messenger.makeInviteLink({ lifetime: 7 * DAY, uses: 5 })
    if (!result.ok) throw new Error(result.error)
    await flush(400)
    await laptop.messenger.checkMail()
    expect(laptop.messenger.inviteLinksElsewhere()).toHaveLength(1)
    // The phone is stolen: the laptop removes it, and its link closes.
    await away(phone)
    await laptop.messenger.removeDevice(phone.messenger.device)
    await flush(400)
    const mika = await messenger(createMemoryNetwork(), 'mika', { clock, lighthouse })
    await mika.messenger.setProfile({ handle: 'Mika', status: 'online', message: '' })
    expect(await mika.messenger.openInviteLink(result.link.url)).toEqual({
      ok: false,
      error: 'closed',
    })
  })

  it('leaves a stolen phone unable to open again a link it made', async () => {
    const { clock, lighthouse, laptop, phone } = await laptopAndPhone()
    const result = await phone.messenger.makeInviteLink({ lifetime: 7 * DAY, uses: 5 })
    if (!result.ok) throw new Error(result.error)
    await flush(400)
    await laptop.messenger.checkMail()
    await away(phone)
    await laptop.messenger.removeDevice(phone.messenger.device)
    await flush(400)
    // The thief's Pigeon never fetches, so it never hears, and puts the open card again.
    await phone.store.set('mail-fetched', {
      [lighthouse.address.id]: { cursor: Number.MAX_SAFE_INTEGER, at: clock.now() },
    })
    const thief = await messenger(createMemoryNetwork(), 'rook-phone', {
      clock,
      lighthouse,
      store: phone.store,
    })
    await flush(400)
    await thief.messenger.setLighthouses([lighthouse.address])
    await flush(400)
    const mika = await messenger(createMemoryNetwork(), 'mika', { clock, lighthouse })
    await mika.messenger.setProfile({ handle: 'Mika', status: 'online', message: '' })
    expect(await mika.messenger.openInviteLink(result.link.url)).toEqual({
      ok: false,
      error: 'closed',
    })
  })

  it('says nothing to someone blocked, and refuses your own link', async () => {
    const { clock, lighthouse, rook, mika } = await apart()
    const link = await made(rook)
    expect(await rook.messenger.openInviteLink(link.url)).toEqual({ ok: false, error: 'own' })
    // Rook has Mika blocked, from when they were friends once.
    await rook.messenger.close()
    await rook.store.set('blocked', [{ id: mika.messenger.self, handle: 'Mika', at: NOON }])
    const again = await messenger(createMemoryNetwork(), 'rook', {
      clock,
      lighthouse,
      store: rook.store,
    })
    await asks(mika, link.url)
    await clock.tick(30_000)
    await flush(400)
    expect(only(again.messenger.inviteLinks()).requests).toEqual([])
    expect(only(mika.messenger.sentAsks()).state).toBe('waiting')
  })
})

describe('letters', () => {
  it('leaves messages for a friend who is offline, and says where each one is', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const rook = await messenger(network, 'rook', { clock, lighthouse })
    const mika = await messenger(network, 'mika', { clock, lighthouse })
    await pairWith(rook, mika)
    await flush(400)
    const mikaId = only(rook.messenger.friends()).id
    const rookId = only(mika.messenger.friends()).id

    // Mika closes Pigeon; Rook writes twice, a burst that goes as one letter, and closes his.
    await away(mika)
    await flush(200)
    await rook.messenger.send(mikaId, 'are we still on for saturday?')
    await rook.messenger.send(mikaId, 'bring the blue rope')
    await rook.messenger.loadLetters(mikaId)
    const route = () =>
      only(rook.messenger.friends()).log.entries.map((entry) =>
        rook.messenger.messageRoute(mikaId, entry),
      )
    expect(route()).toEqual([{ kind: 'sealing' }, { kind: 'sealing' }])
    await clock.tick(5000)
    await flush(400)
    const left = { kind: 'left', where: ['Test Lighthouse'] }
    expect(route()).toEqual([left, left])
    expect(await rook.store.get('mail-outbox')).toHaveLength(1)
    await rook.messenger.close()
    rook.transport.disconnect()

    // Mika opens Pigeon where she can't meet Rook: both messages are there, unread.
    const back = await messenger(createMemoryNetwork(), 'mika', {
      clock,
      lighthouse,
      store: mika.store,
    })
    await flush(800)
    const chat = back.messenger.friend(rookId)
    expect(chat?.log.entries.map((entry) => entry.text)).toEqual([
      'are we still on for saturday?',
      'bring the blue rope',
    ])
    expect(chat?.unread).toBe(2)
    await back.messenger.loadLetters(rookId)
    const first = chat?.log.entries[0]
    if (first === undefined) throw new Error('no entry')
    expect(back.messenger.messageRoute(rookId, first)).toEqual({
      kind: 'arrived',
      through: 'Test Lighthouse',
    })

    // Her receipt reaches Rook when he opens Pigeon: Mika has them.
    const rookBack = await messenger(createMemoryNetwork(), 'rook', {
      clock,
      lighthouse,
      store: rook.store,
    })
    await flush(800)
    await rookBack.messenger.loadLetters(mikaId)
    const mine = only(rookBack.messenger.friends()).log.entries
    expect(mine.map((entry) => rookBack.messenger.messageRoute(mikaId, entry))).toEqual([
      { kind: 'has' },
      { kind: 'has' },
    ])
    expect(await rookBack.store.get('mail-outbox')).toEqual([])
  })

  it('mails a message written just before Pigeon closed, when it opens again', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const rook = await messenger(network, 'rook', { clock, lighthouse })
    const mika = await messenger(network, 'mika', { clock, lighthouse })
    await pairWith(rook, mika)
    await flush(400)
    const mikaId = only(rook.messenger.friends()).id
    const rookId = only(mika.messenger.friends()).id
    await away(mika)
    await flush(200)
    // Closed before the letter's 5 seconds were up: nothing was mailed.
    await rook.messenger.send(mikaId, 'see you at ten')
    await rook.messenger.close()
    rook.transport.disconnect()
    expect((await rook.store.get('mail-outbox')) ?? []).toEqual([])
    // Opened again, alone: its first mail check sends it.
    await messenger(createMemoryNetwork(), 'rook', { clock, lighthouse, store: rook.store })
    await flush(400)
    await clock.tick(5000)
    await flush(400)
    expect(await rook.store.get('mail-outbox')).toHaveLength(1)
    const back = await messenger(createMemoryNetwork(), 'mika', {
      clock,
      lighthouse,
      store: mika.store,
    })
    await flush(800)
    expect(back.messenger.friend(rookId)?.log.entries.map((entry) => entry.text)).toEqual([
      'see you at ten',
    ])
  })

  it('gives your other devices what you wrote by letter, though the friend is never there', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const laptop = await messenger(network, 'rook', { clock, lighthouse })
    const mika = await messenger(network, 'mika', { clock, lighthouse })
    await pairWith(laptop, mika)
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock, lighthouse)
    await flush(400)
    const mikaId = only(laptop.messenger.friends()).id
    // Mika and the phone are both away when the laptop writes.
    await away(mika)
    await away(phone)
    await laptop.messenger.send(mikaId, 'see you saturday')
    await clock.tick(5000)
    await flush(400)
    await laptop.messenger.close()
    laptop.transport.disconnect()
    // The phone opens alone: the laptop's message is in its chat with Mika, and not as news.
    const back = await messenger(createMemoryNetwork(), 'rook-phone', {
      clock,
      lighthouse,
      store: phone.store,
    })
    await flush(800)
    const chat = back.messenger.friend(mikaId)
    expect(chat?.log.entries.map((entry) => entry.text)).toEqual(['see you saturday'])
    expect(chat?.unread).toBe(0)
    await back.messenger.loadLetters(mikaId)
    const entry = chat?.log.entries[0]
    if (entry === undefined) throw new Error('no entry')
    expect(back.messenger.messageRoute(mikaId, entry)).toBeUndefined()
  })

  it('splits long messages into letters that each fit a Lighthouse', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const rook = await messenger(network, 'rook', { clock, lighthouse })
    const mika = await messenger(network, 'mika', { clock, lighthouse })
    await pairWith(rook, mika)
    await flush(400)
    const mikaId = only(rook.messenger.friends()).id
    await away(mika)
    await flush(200)
    for (let i = 0; i < 20; i++) await rook.messenger.send(mikaId, `${i} ${'x'.repeat(3900)}`)
    await clock.tick(5000)
    await flush(800)
    await rook.messenger.loadLetters(mikaId)
    const outbox = (await rook.store.get('mail-outbox')) as unknown[]
    expect(outbox.length).toBeGreaterThan(1)
    const routes = only(rook.messenger.friends()).log.entries.map(
      (entry) => rook.messenger.messageRoute(mikaId, entry)?.kind,
    )
    expect(routes.every((kind) => kind === 'left')).toBe(true)
  })

  it('sends nothing by letter to a friend who is online', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const rook = await messenger(network, 'rook', { clock, lighthouse })
    const mika = await messenger(network, 'mika', { clock, lighthouse })
    await pairWith(rook, mika)
    await flush(400)
    const mikaId = only(rook.messenger.friends()).id
    await rook.messenger.send(mikaId, 'hi')
    await clock.tick(5000)
    await flush(400)
    expect((await rook.store.get('mail-outbox')) ?? []).toEqual([])
    const entry = only(rook.messenger.friends()).log.entries[0]
    if (entry === undefined) throw new Error('no entry')
    expect(rook.messenger.messageRoute(mikaId, entry)).toBeUndefined()
  })
})
