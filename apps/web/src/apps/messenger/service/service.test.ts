import {
  base32Decode,
  base32Encode,
  createMemoryNetwork,
  decodeDeviceLink,
  decodeInvite,
  decodeInviteLink,
  emptyDeviceLog,
  emptyLog,
  encodePairSecret,
  encodeRequest,
  err,
  fakeCrypto,
  fakeSealCrypto,
  fakeSigner,
  flush,
  formatCode,
  formatLighthouseAddress,
  inviteCardClaim,
  inviteCardTag,
  LIGHTHOUSE_PROTOCOL,
  type LighthouseAddress,
  type LighthouseReply,
  type LighthouseRequest,
  MAX_WRONG_TRIES,
  mailTag,
  openInviteCard,
  openMail,
  PAIR_SECRET_BYTES,
  pairPassword,
  pairRoom,
  pairRoomOn,
  type Room,
  roomsFor,
  sealInviteCard,
  selfRoomsAt,
  startPairSession,
} from '@pigeon/core'
import { describe, expect, it, vi } from 'vitest'

// A device that rewrites who made its proposals, and when: set only while one runs.
const forged: { by?: string } = {}
// A Pigeon that reads `mail:rekey` but can make nothing of what it's sent, as one from before
// new rounds: it takes the letter and gives a receipt. Set only while one fetches.
const unread: { on?: boolean } = {}
vi.mock('@pigeon/core', async (importOriginal) => {
  const core = (await importOriginal()) as typeof import('@pigeon/core')
  return {
    ...core,
    rekeyBody: (...[rekey, news]: Parameters<typeof core.rekeyBody>) =>
      core.rekeyBody(
        forged.by === undefined ? rekey : { ...rekey, by: forged.by as never, at: 0 },
        news,
      ),
    readRekey: (body: unknown) => (unread.on === true ? undefined : core.readRekey(body)),
  }
})

import type { Clock } from '../../../platform/clock/clock.ts'
import { createMemoryStore } from '../../../platform/storage/memory-storage.ts'
import type { Store } from '../../../platform/storage/storage.ts'
import type { Wake } from '../../../platform/wake/wake.ts'
import {
  apart,
  asks,
  away,
  fakeClock,
  laptopAndPhone,
  linkDevice,
  made,
  messenger,
  type Network,
  NOON,
  never,
  only,
  pair,
  pairWith,
  type TestLighthouse,
  testLighthouse,
} from '../testing/messengers.ts'
import { loadDevices } from './devices.ts'
import { MUTED_FOREVER } from './friends.ts'
import { MAIL_AFTER_SEND_MS, MAIL_EVERY_MS, MAIL_MIN_GAP_MS } from './mail-schedule.ts'
import type { FriendView } from './messenger.ts'

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

    // Rook's new invite won't take a request from a blocked Mika, nor show her to him.
    await a.messenger.newInvite()
    const invite = decodeInvite(a.messenger.inviteCode() ?? '')
    if (!invite.ok) throw new Error('bad invite')
    const opened = await b.messenger.open(invite.value, never)
    if (!opened.ok) throw new Error(opened.error)
    let giveUp: () => void = () => undefined
    const confirmed = opened.offer.confirm(
      new Promise<void>((resolve) => {
        giveUp = resolve
      }),
    )
    await flush()
    expect(a.messenger.codeAsks()).toEqual([])
    giveUp()
    expect(await confirmed).toBe(false)
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

  it('shows the inviter each wrong try, and stops the code after five', async () => {
    const network = createMemoryNetwork()
    const a = await messenger(network, 'rook')
    const eve = await messenger(network, 'eve')
    await a.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    await eve.messenger.setProfile({ handle: 'Eve', status: 'online', message: '' })
    const hosted = await a.messenger.newInvite()
    if (hosted === undefined) throw new Error('no invite')
    for (let guess = 1; guess <= MAX_WRONG_TRIES; guess++) {
      const wrong = {
        nameplate: hosted.code.nameplate,
        via: 'code',
        secret: `qqqqq${'abcde'[guess - 1]}`,
      } as const
      expect(await eve.messenger.open(wrong, never)).toEqual({ ok: false, error: 'wrong-code' })
      if (guess < MAX_WRONG_TRIES) expect(a.messenger.wrongTries()).toBe(guess)
    }
    expect(a.messenger.invite()).toBeUndefined()
    expect(a.messenger.inviteStopped()).toBe(true)
    expect(a.messenger.codeAsks()).toEqual([])
    // A new code starts afresh.
    await a.messenger.newInvite()
    expect(a.messenger.inviteStopped()).toBe(false)
    expect(a.messenger.wrongTries()).toBe(0)
  })

  it('keeps a code’s wrong tries across a reload', async () => {
    const network = createMemoryNetwork()
    const store = createMemoryStore()
    const a = await messenger(network, 'rook', { store })
    const eve = await messenger(network, 'eve')
    await a.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    await eve.messenger.setProfile({ handle: 'Eve', status: 'online', message: '' })
    const hosted = await a.messenger.newInvite()
    if (hosted === undefined) throw new Error('no invite')
    const wrong = { nameplate: hosted.code.nameplate, via: 'code', secret: 'qqqqqq' } as const
    await eve.messenger.open(wrong, never)
    await eve.messenger.open(wrong, never)
    expect(a.messenger.wrongTries()).toBe(2)
    await a.messenger.close()
    const again = await messenger(network, 'rook', { store })
    await flush()
    expect(again.messenger.invite()?.code).toEqual(hosted.code)
    expect(again.messenger.wrongTries()).toBe(2)
  })

  it('adds nobody the inviter declines, and keeps the code for the next', async () => {
    const network = createMemoryNetwork()
    const a = await messenger(network, 'rook')
    const eve = await messenger(network, 'eve')
    await a.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    await eve.messenger.setProfile({ handle: 'Mika', status: 'online', message: '' })
    await a.messenger.newInvite()
    const invite = decodeInvite(a.messenger.inviteCode() ?? '')
    if (!invite.ok) throw new Error('bad invite')
    const opened = await eve.messenger.open(invite.value, never)
    if (!opened.ok) throw new Error(opened.error)
    const confirmed = opened.offer.confirm(never)
    await flush()
    const ask = only(a.messenger.codeAsks())
    expect(ask.fingerprint).toBe(await a.messenger.fingerprintOf(eve.messenger.self))
    await a.messenger.declineAsk(ask.key)
    expect(await confirmed).toBe('declined')
    expect(a.messenger.friends()).toEqual([])
    expect(eve.messenger.friends()).toEqual([])
    expect(a.messenger.invite()).toBeDefined()
  })

  it('refuses its own invite and makes no invite without a name', async () => {
    const a = await messenger(createMemoryNetwork(), 'rook')
    expect(await a.messenger.newInvite()).toBeUndefined()
    await a.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    const hosted = await a.messenger.newInvite()
    if (hosted === undefined) throw new Error('no invite')
    const typed = {
      nameplate: hosted.code.nameplate,
      via: 'code',
      secret: hosted.code.password,
    } as const
    expect(await a.messenger.open(typed, never)).toEqual({
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

const rookId = fakeSigner('rook').id
const mikaId = fakeSigner('mika').id
const legacy = () => pairRoom(fakeCrypto, rookId, mikaId)
const HOUR = 60 * 60 * 1000

/** The pair rooms a transport's joins named, other than invite rooms. */
const pairJoins = (network: Network) =>
  network.joins.filter((join) => join.name.startsWith('pair:'))

/**
 * Rook and Mika as friends from before pair secrets: no secret, so nothing sealed or being
 * replaced either, meeting in the old room.
 */
async function oldFriends(network: Network, clock = fakeClock(NOON)) {
  const { a, b } = await pair(network, {}, 'link', clock)
  await a.messenger.close()
  await b.messenger.close()
  for (const side of [a, b]) {
    const friends = (await side.store.get('friends')) as Record<string, unknown>[]
    await side.store.set(
      'friends',
      friends.map(
        ({ secret: _secret, moved: _moved, sealed: _sealed, replacing: _replacing, ...rest }) =>
          rest,
      ),
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

  it('moves the lower id once the higher is met in the secret’s rooms, with no confirmation', async () => {
    // Mika (the lower id) gave a secret; Rook took it and moved, but closed before its
    // pair-secret-ok went: Mika holds the secret without having moved.
    const network = createMemoryNetwork()
    const stores = await oldFriends(network)
    const secret = encodePairSecret(new Uint8Array(PAIR_SECRET_BYTES).fill(5))
    await rewriteMika(stores.a, (record) => ({ ...record, secret, moved: true }))
    const friends = (await stores.b.get('friends')) as Record<string, unknown>[]
    await stores.b.set(
      'friends',
      friends.map((record) => ({ ...record, secret })),
    )
    const a = await messenger(network, 'rook', { store: stores.a, clock: stores.clock })
    const b = await messenger(network, 'mika', { store: stores.b, clock: stores.clock })
    await flush()
    const mika = only(a.messenger.friends())
    const rook = only(b.messenger.friends())
    expect(rook).toMatchObject({ secret, moved: true })
    expect(mika).toMatchObject({ secret, moved: true })
    expect(mika.online).toBe(true)
    expect(network.occupants(await legacy())).toBe(0)
    expect(network.occupants(await today(secret))).toBe(2)
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

/**
 * A bare session as one of the friend's devices, saying `pair-secret` with a secret of its own
 * choosing. `room` is where it goes, whatever the session is told it is: the old room, so the
 * session sends there.
 */
async function sayPairSecret(as: string, to: string, room: Room, secret: string) {
  const signer = fakeSigner(as)
  const name = await legacy()
  let n = 0
  const session = startPairSession({
    crypto: fakeCrypto,
    signer,
    friend: fakeSigner(to).id,
    chat: name,
    rooms: [{ ...room, name }],
    handle: () => as,
    presence: () => ({ status: 'online', message: '' }),
    log: emptyLog(name),
    now: () => NOON,
    random: (length) => new Uint8Array(length).fill(++n % 250),
    onEvent: () => undefined,
  })
  await flush()
  await session.sendSecret(secret)
  await flush()
  return session
}

/** A secret nobody paired with: what a device saying `pair-secret` might choose. */
const chosen = encodePairSecret(new Uint8Array(PAIR_SECRET_BYTES).fill(7))

/** Rook's record of Mika, rewritten in the store while closed. */
async function rewriteMika(store: Store, change: (record: Record<string, unknown>) => object) {
  const friends = (await store.get('friends')) as Record<string, unknown>[]
  await store.set(
    'friends',
    friends.map((record) => change(record)),
  )
}

// Mika's id is the lower: she gives the secret in the old room, and Rook takes it.
describe('the pair secret in the old room', () => {
  it('is taken only from the lower id', async () => {
    expect(mikaId < rookId).toBe(true)
    const network = createMemoryNetwork()
    const stores = await oldFriends(network)
    const b = await messenger(network, 'mika', { store: stores.b, clock: stores.clock })
    await flush()
    // Rook's device, the higher id, says a secret in the old room.
    await sayPairSecret('rook', 'mika', await network.transport().join(await legacy()), chosen)
    const rook = only(b.messenger.friends())
    expect(rook.online).toBe(true)
    expect(rook.secret).not.toBe(chosen)
    expect(rook.moved).toBeUndefined()
  })

  it('counts for nothing in the secret’s own rooms, once moved', async () => {
    const network = createMemoryNetwork()
    const { a, b } = await pair(network, {}, 'link', fakeClock(NOON))
    const held = only(a.messenger.friends()).secret ?? ''
    await b.messenger.close()
    const room = await network.transport().join(await today(held), {
      password: await pairPassword(fakeCrypto, held),
    })
    await sayPairSecret('mika', 'rook', room, chosen)
    const mika = only(a.messenger.friends())
    expect(mika.online).toBe(true)
    expect(mika.secret).toBe(held)
  })

  it('counts for nothing once the secret is sealed', async () => {
    const network = createMemoryNetwork()
    const { a, b } = await pair(network, {}, 'link', fakeClock(NOON))
    const held = only(a.messenger.friends()).secret ?? ''
    await a.messenger.close()
    await b.messenger.close()
    // Sealed, though not marked moved: back in the old room too.
    await rewriteMika(a.store, ({ moved: _moved, ...rest }) => rest)
    const back = await messenger(network, 'rook', { store: a.store, clock: fakeClock(NOON) })
    await flush()
    await sayPairSecret('mika', 'rook', await network.transport().join(await legacy()), chosen)
    const mika = only(back.messenger.friends())
    expect(mika.online).toBe(true)
    expect(mika).toMatchObject({ secret: held, sealed: true })
  })

  it('counts for nothing while the secret is being replaced', async () => {
    const network = createMemoryNetwork()
    const { a, b } = await pair(network, {}, 'link', fakeClock(NOON))
    const held = only(a.messenger.friends()).secret ?? ''
    const old = 'a'.repeat(52)
    await a.messenger.close()
    await b.messenger.close()
    // A replacement under way, the record not marked moved or sealed: back in the old room too.
    await rewriteMika(a.store, ({ moved: _moved, sealed: _sealed, ...rest }) => ({
      ...rest,
      replacing: { old, at: NOON, by: rookId, sig: 'a'.repeat(52) },
    }))
    const back = await messenger(network, 'rook', { store: a.store, clock: fakeClock(NOON) })
    await flush()
    await sayPairSecret('mika', 'rook', await network.transport().join(await legacy()), chosen)
    const mika = only(back.messenger.friends())
    expect(mika.online).toBe(true)
    expect(mika.secret).toBe(held)
    expect(mika.replacing?.old).toBe(old)
  })
})

describe('relay-only for your own devices', () => {
  it('joins the self room and a shown device link again through the relay', async () => {
    const { network, laptop } = await laptopAndPhone()
    const shown = await laptop.messenger.startLink()
    const before = network.joins.length
    await laptop.messenger.setRelayOnly(true)
    await flush()
    const after = network.joins.slice(before)
    expect(after.some((join) => join.name.startsWith('self:'))).toBe(true)
    expect(after.some((join) => join.name.startsWith('link/v2:'))).toBe(true)
    expect(after.every((join) => join.options.relayOnly === true)).toBe(true)
    // The old link's room is left, and the link shown now is a new one.
    const code = laptop.messenger.linking()?.code
    expect(code).toBeDefined()
    expect(code).not.toEqual(shown?.code)
    if (shown === undefined) throw new Error('no link')
    const old = await roomsFor(fakeCrypto, 'link', shown.code)
    // This test's random bytes differ only at the start, so only the nameplate tells codes apart.
    expect(network.occupants(old.code)).toBe(0)
  })

  it('leaves nothing hosted after quick toggles and a close', async () => {
    const network = createMemoryNetwork()
    const laptop = await messenger(network, 'rook', { clock: fakeClock(NOON) })
    await laptop.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    await laptop.messenger.newInvite()
    await laptop.messenger.startLink()
    // Joins that take a while, some longer than others, as over a real network.
    const transport = laptop.transport as { join: typeof laptop.transport.join }
    const join = transport.join.bind(laptop.transport)
    let n = 0
    transport.join = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, (n++ % 3) * 3))
      return join(...args)
    }
    const toggles = Promise.all([
      laptop.messenger.setRelayOnly(true),
      laptop.messenger.setRelayOnly(false),
      laptop.messenger.setRelayOnly(true),
    ])
    // Closed while they're under way.
    await new Promise((resolve) => setTimeout(resolve, 4))
    await laptop.messenger.close()
    await toggles
    await flush()
    const hosted = [...new Set(network.joins.map((join) => join.name))].filter(
      (name) => network.occupants(name) > 0 && /^(link|invite)\/v2:/.test(name),
    )
    expect(hosted).toEqual([])
  })

  it('hosts no link nobody shows, when it is closed or started again during a toggle', async () => {
    const network = createMemoryNetwork()
    const laptop = await messenger(network, 'rook', { clock: fakeClock(NOON) })
    await laptop.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    await laptop.messenger.startLink()
    const transport = laptop.transport as { join: typeof laptop.transport.join }
    const join = transport.join.bind(laptop.transport)
    transport.join = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return join(...args)
    }
    const hosted = () =>
      [...new Set(network.joins.map((j) => j.name))].filter(
        (name) => name.startsWith('link/v2:') && network.occupants(name) > 0,
      )
    // The dialog closes while relay-only is being turned on.
    const toggle = laptop.messenger.setRelayOnly(true)
    await new Promise((resolve) => setTimeout(resolve, 2))
    await laptop.messenger.cancelLink()
    await toggle
    await flush()
    expect(laptop.messenger.linking()).toBeUndefined()
    expect(hosted()).toEqual([])
    // It opens again while relay-only is being turned off: one link, the one shown.
    const off = laptop.messenger.setRelayOnly(false)
    await new Promise((resolve) => setTimeout(resolve, 1))
    await laptop.messenger.startLink()
    await off
    await flush()
    const shownNow = laptop.messenger.linking()?.code
    if (shownNow === undefined) throw new Error('no link')
    const rooms = await roomsFor(fakeCrypto, 'link', shownNow)
    expect(hosted().sort()).toEqual([rooms.code, rooms.link].sort())
    await laptop.messenger.close()
    await flush()
    expect(hosted()).toEqual([])
  })

  it('leaves a link a device has answered to finish', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const laptop = await messenger(network, 'rook', { clock })
    await laptop.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    const fresh = await messenger(network, 'rook-phone', { clock })
    const linking = await laptop.messenger.startLink()
    const target = decodeDeviceLink(linking?.link ?? '')
    if (!target.ok) throw new Error('bad link')
    const joined = await fresh.messenger.joinIdentity(target.value, never)
    if (!joined.ok) throw new Error(joined.error)
    // Asked: the laptop shows it, and keeps the link through the toggle.
    const confirmed = joined.offer.confirmed(never)
    await flush()
    await laptop.messenger.setRelayOnly(true)
    await flush()
    expect(laptop.messenger.linking()?.code).toBe(linking?.code)
    expect(await laptop.messenger.confirmLink('rook-phone')).toBe('linked')
    expect(await confirmed).toBe(true)
  })
})

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
    // No waiting for the laptop to take and drop what waited for it: a blob dropped between the
    // phone's list and its get doesn't stop the rest of the phone's fetch.
    await flush()
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

  it('signs nothing for a device that left before Link, and links it when it comes back', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const laptop = await messenger(network, 'rook', { clock })
    await laptop.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    const store = createMemoryStore()
    const fresh = await messenger(network, 'rook-phone', { clock, store })
    const linking = await laptop.messenger.startLink()
    if (linking === undefined) throw new Error('could not start linking')
    // Typed: the phone shows whose it is to compare before it asks.
    const typed = decodeDeviceLink(formatCode(linking.code))
    if (!typed.ok) throw new Error('bad code')
    const joined = await fresh.messenger.joinIdentity(typed.value, never)
    if (!joined.ok) throw new Error(joined.error)
    expect(joined.offer.checked).toBe(false)
    expect(joined.offer.identityFingerprint).toBe(laptop.messenger.selfFingerprint)
    expect(laptop.messenger.linking()?.request).toBeUndefined()
    void joined.offer.confirmed(never)
    await flush()
    expect(laptop.messenger.linking()?.request?.device).toBe(fresh.messenger.device)
    // The phone gives up and goes before you choose Link.
    await fresh.messenger.close()
    fresh.transport.disconnect()
    await flush()
    expect(laptop.messenger.linking()?.request).toBeUndefined()
    expect(await laptop.messenger.confirmLink('Phone')).toBe('failed')
    expect(laptop.messenger.devices().map((device) => device.id)).toEqual([laptop.messenger.device])
    // The same browser tries again, and is linked.
    const again = await messenger(network, 'rook-phone', { clock, store })
    const { status } = await linkDevice(network, laptop, 'rook-phone', clock, undefined, again)
    expect(status).toBe('linked')
  })

  it('ends a link code past its 10 minutes once the request it was kept for goes', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const laptop = await messenger(network, 'rook', { clock })
    await laptop.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    const fresh = await messenger(network, 'rook-phone', { clock })
    const linking = await laptop.messenger.startLink()
    const target = decodeDeviceLink(linking?.link ?? '')
    if (!target.ok) throw new Error('bad link')
    const joined = await fresh.messenger.joinIdentity(target.value, never)
    if (!joined.ok) throw new Error(joined.error)
    void joined.offer.confirmed(never)
    await flush()
    expect(laptop.messenger.linking()?.request).toBeDefined()
    await clock.tick(11 * 60 * 1000)
    // Kept while the request shows; gone with it.
    expect(laptop.messenger.linking()).toBeDefined()
    await fresh.messenger.close()
    fresh.transport.disconnect()
    await flush()
    expect(laptop.messenger.linking()).toBeUndefined()
  })

  it('stops a code still being hosted when the Messenger closes', async () => {
    const network = createMemoryNetwork()
    const laptop = await messenger(network, 'rook', { clock: fakeClock(NOON) })
    await laptop.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    const transport = laptop.transport as { join: typeof laptop.transport.join }
    const join = transport.join.bind(laptop.transport)
    transport.join = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return join(...args)
    }
    const making = laptop.messenger.newInvite()
    await new Promise((resolve) => setTimeout(resolve, 1))
    await laptop.messenger.close()
    await making
    await new Promise((resolve) => setTimeout(resolve, 30))
    await flush()
    const hosted = [...new Set(network.joins.map((j) => j.name))].filter(
      (name) => name.startsWith('invite/v2:') && network.occupants(name) > 0,
    )
    expect(hosted).toEqual([])
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
    void joined.offer.confirmed(never)
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

describe('unreadable saved friends', () => {
  it('sets one bad record aside, loads the rest and never saves over it', async () => {
    const network = createMemoryNetwork()
    const { a: rook } = await pair(network)
    await rook.messenger.close()
    const [mika] = (await rook.store.get('friends')) as Record<string, unknown>[]
    const eve = { ...mika, id: fakeSigner('eve').id, handle: 'Eve' }
    const bad = { ...mika, id: fakeSigner('zed').id, handle: 'Zed', addedAt: 'long ago' }
    await rook.store.set('friends', [mika, bad, eve] as never)

    const told: number[] = []
    const again = await messenger(createMemoryNetwork(), 'rook', {
      store: rook.store,
      events: { onFriendsSetAside: (count) => told.push(count) },
    })
    expect(again.messenger.friends().map((view) => view.handle)).toEqual(['Mika', 'Eve'])
    expect(told).toEqual([1])
    expect(await rook.store.get('friends-unreadable')).toEqual([bad])

    // A save, here a rename, writes only the readable friends and leaves the set-aside one be.
    await again.messenger.rename(again.messenger.friends()[0]?.id ?? fakeSigner('x').id, 'Mik')
    expect(
      ((await rook.store.get('friends')) as { handle: string }[]).map((r) => r.handle),
    ).toEqual(['Mika', 'Eve'])
    expect(await rook.store.get('friends-unreadable')).toEqual([bad])

    // And again after another start: told again, nothing kept twice.
    await again.messenger.close()
    const third = await messenger(createMemoryNetwork(), 'rook', {
      store: rook.store,
      events: { onFriendsSetAside: (count) => told.push(count) },
    })
    expect(third.messenger.friends()).toHaveLength(2)
    expect(told).toEqual([1, 1])
    expect(await rook.store.get('friends-unreadable')).toEqual([bad])
  })

  it('keeps a stored value that is no list at all, and starts with no friends', async () => {
    const store = createMemoryStore()
    await store.set('friends', { not: 'a list' })
    const rook = await messenger(createMemoryNetwork(), 'rook', { store })
    expect(rook.messenger.friends()).toEqual([])
    expect(await store.get('friends-unreadable')).toEqual([{ not: 'a list' }])
  })

  it('keeps a set-aside record through an import', async () => {
    const network = createMemoryNetwork()
    const { a: rook } = await pair(network)
    const data = JSON.parse(JSON.stringify(rook.messenger.exportData())) as unknown
    await rook.messenger.close()
    const [mika] = (await rook.store.get('friends')) as Record<string, unknown>[]
    const bad = { ...mika, id: fakeSigner('zed').id, handle: 7 }
    await rook.store.set('friends', [bad, mika] as never)
    const again = await messenger(createMemoryNetwork(), 'rook', { store: rook.store })
    expect(await again.messenger.importData(data)).toBe('imported')
    expect(await rook.store.get('friends-unreadable')).toEqual([bad])
    expect(((await rook.store.get('friends')) as unknown[]).length).toBe(1)
  })
})

describe('unreadable saved blocks and farewells', () => {
  const ids = [fakeSigner('b1').id, fakeSigner('b2').id, fakeSigner('b3').id]

  it('sets an unreadable blocked record aside, keeps the rest blocked and never saves over it', async () => {
    const store = createMemoryStore()
    const one = { id: ids[0], handle: 'One', at: NOON }
    const bad = { id: ids[1], handle: 7, at: NOON }
    const three = { id: ids[2], handle: 'Three', at: NOON }
    await store.set('blocked', [one, bad, three] as never)
    const told: number[] = []
    const rook = await messenger(createMemoryNetwork(), 'rook', {
      store,
      events: { onBlockedSetAside: (count) => told.push(count) },
    })
    expect(rook.messenger.blocked().map((record) => record.handle)).toEqual(['One', 'Three'])
    expect(told).toEqual([1])
    expect(await store.get('blocked-unreadable')).toEqual([bad])

    // A save writes only the readable ones and leaves the set-aside one be.
    await rook.messenger.unblock(ids[0] as never)
    expect(await store.get('blocked')).toEqual([three])
    expect(await store.get('blocked-unreadable')).toEqual([bad])

    // Told again after another start, nothing kept twice.
    await rook.messenger.close()
    const again = await messenger(createMemoryNetwork(), 'rook', {
      store,
      events: { onBlockedSetAside: (count) => told.push(count) },
    })
    expect(again.messenger.blocked()).toHaveLength(1)
    expect(told).toEqual([1, 1])
    expect(await store.get('blocked-unreadable')).toEqual([bad])
  })

  it('keeps a blocked value that is no list at all', async () => {
    const store = createMemoryStore()
    await store.set('blocked', 'nope' as never)
    const rook = await messenger(createMemoryNetwork(), 'rook', { store })
    expect(rook.messenger.blocked()).toEqual([])
    expect(await store.get('blocked-unreadable')).toEqual(['nope'])
  })

  it('sets an unreadable farewell aside, keeps the others, bare ids included', async () => {
    const store = createMemoryStore()
    const bad = { id: ids[1], secret: 'not a secret' }
    await store.set('farewells', [ids[0], bad, { id: ids[2] }] as never)
    const told: number[] = []
    const rook = await messenger(createMemoryNetwork(), 'rook', {
      store,
      events: { onFarewellsSetAside: (count) => told.push(count) },
    })
    await flush()
    expect(told).toEqual([1])
    expect(await store.get('farewells-unreadable')).toEqual([bad])
    await rook.messenger.close()
    expect(await store.get('farewells-unreadable')).toEqual([bad])
  })
})

describe('import checks', () => {
  async function exported() {
    const { a: rook } = await pair(createMemoryNetwork())
    const data = JSON.parse(JSON.stringify(rook.messenger.exportData())) as Record<string, unknown>
    return { data, id: only(rook.messenger.friends()).id }
  }

  it('refuses names over the limit, in friends, petnames and blocks', async () => {
    const { data } = await exported()
    const friends = data['friends'] as Record<string, unknown>[]
    for (const change of [{ handle: 'x'.repeat(33) }, { petname: 'y'.repeat(33) }]) {
      const fresh = await messenger(createMemoryNetwork(), 'rook')
      const file = { ...data, friends: friends.map((record) => ({ ...record, ...change })) }
      expect(await fresh.messenger.importData(file)).toBe('unreadable')
      expect(await fresh.store.get('friends')).toBeUndefined()
    }
    const fresh = await messenger(createMemoryNetwork(), 'rook')
    const blocked = [{ id: fakeSigner('eve').id, handle: 'e'.repeat(33), at: 1 }]
    expect(await fresh.messenger.importData({ ...data, blocked })).toBe('unreadable')
  })

  it('does not import a profile a person could not have set', async () => {
    const { data } = await exported()
    const profile = data['profile'] as Record<string, unknown>
    for (const bad of [
      { handle: 'x'.repeat(33) },
      { handle: 'line\nbreak' },
      { handle: '   ' },
      { message: 'm'.repeat(121) },
    ]) {
      const fresh = await messenger(createMemoryNetwork(), 'rook')
      expect(await fresh.messenger.importData({ ...data, profile: { ...profile, ...bad } })).toBe(
        'imported',
      )
      expect(await fresh.store.get('profile')).toBeUndefined()
    }
  })

  it('drops keys it does not know from everything it stores', async () => {
    const { data } = await exported()
    const withExtras = (record: unknown) => ({ ...(record as object), extra: 'x', __proto2: 1 })
    const file = {
      ...data,
      friends: (data['friends'] as unknown[]).map(withExtras),
      blocked: [{ id: fakeSigner('eve').id, handle: 'Eve', at: 1, extra: true }],
      profile: withExtras(data['profile']),
      settings: withExtras(data['settings']),
    }
    const fresh = await messenger(createMemoryNetwork(), 'rook')
    expect(await fresh.messenger.importData(file)).toBe('imported')
    const stored = async (key: string) => JSON.stringify(await fresh.store.get(key))
    for (const key of ['friends', 'blocked', 'profile', 'messengerSettings'])
      expect(await stored(key)).not.toContain('extra')
    expect(await fresh.store.get('blocked')).toEqual([
      { id: fakeSigner('eve').id, handle: 'Eve', at: 1 },
    ])
    expect(await fresh.store.get('profile')).toEqual({
      handle: 'Rook',
      status: 'online',
      message: '',
    })
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
    const confirmed = opened.offer.confirm(never)
    await flush()
    expect(await host.messenger.approveAsk(only(host.messenger.codeAsks()).key)).toBe(true)
    expect(await confirmed).toBe(true)
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
    const anything = { nameplate: 'anyt', via: 'code', secret: 'hingxx' } as const
    expect(await back.messenger.joinIdentity(anything, never)).toEqual({
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

  /**
   * Someone holding `url` fills its card tag from `ranges` address ranges, as much as each may
   * in a day: cards of their own, which open under the link's secret but aren't the inviter's,
   * now and then tried as claimed ones too. Says how many the Lighthouse kept.
   */
  async function bury(
    lighthouse: TestLighthouse,
    clock: Clock,
    url: string,
    ranges = 2,
    /** Put claimed with this claim key, as a device that kept it can, from a range of its own. */
    claimKey?: string,
    count = 205,
  ) {
    const decoded = decodeInviteLink(url)
    if (!decoded.ok) throw new Error(decoded.error)
    const { secret } = decoded.value
    const tag = await inviteCardTag(fakeCrypto, secret)
    const stranger = fakeSigner('stranger')
    let kept = 0
    const claim =
      claimKey === undefined
        ? undefined
        : await inviteCardClaim(fakeCrypto, claimKey, lighthouse.address.id)
    for (let range = 1; range <= ranges; range++) {
      const connection = lighthouse.connect(
        `198.51.100.${claim === undefined ? range : 50 + range}`,
      )
      let req = 0
      const ask = async (request: LighthouseRequest): Promise<LighthouseReply> => {
        const text = await connection.receive(encodeRequest({ req: ++req, request }))
        if (text === undefined) throw new Error('closed')
        return (JSON.parse(text) as { reply: LighthouseReply }).reply
      }
      await ask({
        type: 'hello',
        protocol: LIGHTHOUSE_PROTOCOL,
        nonce: base32Encode(new Uint8Array(32)),
      })
      for (let n = 0; n < count; n++) {
        const card = await sealInviteCard(fakeCrypto, fakeSealCrypto(), stranger, secret, {
          identity: stranger.id,
          deviceLog: emptyDeviceLog(stranger.id),
          keys: [],
          name: `Rook ${range} ${n}`,
          lighthouses: [],
          expires: clock.now() + DAY,
          open: true,
        })
        if (!card.ok) throw new Error(card.error)
        // It gets as far as the fingerprint before it's refused.
        if (n === 0)
          expect(
            await openInviteCard(fakeCrypto, fakeSealCrypto(), decoded.value, card.value),
          ).toEqual({ ok: false, error: 'not-theirs' })
        const put = {
          type: 'put',
          tag,
          blob: card.value,
          expires: clock.now() + DAY,
          drops: [base32Encode(new Uint8Array(32).fill(range))],
        } as const
        if (claim === undefined && n % 50 === 0 && n < 200)
          expect(
            await ask({ ...put, claim: base32Encode(new Uint8Array(32).fill(n + 1)) }),
          ).toEqual({
            type: 'error',
            error: 'taken',
          })
        if ((await ask(claim === undefined ? put : { ...put, claim })).type === 'stored') kept += 1
      }
    }
    return kept
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

  it('finds its card under a tag others filled with cards of their own', async () => {
    const { clock, lighthouse, rook, mika } = await apart()
    const link = await made(rook)
    // More than an opener gets of everything under the tag, all of it newer than the card.
    expect(await bury(lighthouse, clock, link.url)).toBe(400)
    const opened = await mika.messenger.openInviteLink(link.url)
    expect(opened.ok && opened.card.name).toBe('Rook')
    // Put again after the junk, as a new name puts it: found as it is now.
    await rook.messenger.setProfile({ handle: 'Rook Two', status: 'online', message: '' })
    await flush(400)
    await clock.tick(60_000)
    const again = await mika.messenger.openInviteLink(link.url)
    expect(again.ok && again.card.name).toBe('Rook Two')
    await rook.messenger.cancelInviteLink(link.secret)
    await clock.tick(60_000)
    expect(await mika.messenger.openInviteLink(link.url)).toEqual({ ok: false, error: 'closed' })
  })

  it('claims the card of a link made before cards were claimed', async () => {
    const { clock, lighthouse, rook, mika } = await apart()
    lighthouse.unclaimed(true)
    const link = await made(rook)
    lighthouse.unclaimed(false)
    await rook.messenger.close()
    // As a Pigeon from before claims kept it.
    const kept = (await rook.store.get('invite-links')) as Record<string, unknown>[]
    await rook.store.set(
      'invite-links',
      kept.map(({ claim: _, ...rest }) => rest),
    )
    const back = await messenger(createMemoryNetwork(), 'rook', {
      clock,
      lighthouse,
      store: rook.store,
    })
    await flush(400)
    expect(only(back.messenger.inviteLinks()).claim).toMatch(/^[a-z2-7]{52}$/)
    expect(await bury(lighthouse, clock, link.url)).toBe(400)
    await clock.tick(60_000)
    const opened = await mika.messenger.openInviteLink(link.url)
    expect(opened.ok && opened.card.name).toBe('Rook')
  })

  it('claims an old link once its Lighthouse is back, if it was away at the start', async () => {
    const { clock, lighthouse, rook, mika } = await apart()
    lighthouse.unclaimed(true)
    const link = await made(rook)
    lighthouse.unclaimed(false)
    const old = only(rook.messenger.inviteLinks()).cards
    await rook.messenger.close()
    const kept = (await rook.store.get('invite-links')) as Record<string, unknown>[]
    await rook.store.set(
      'invite-links',
      kept.map(({ claim: _, ...rest }) => rest),
    )
    // Pigeon starts with the Lighthouse out of reach: the old card is still known, and owed.
    lighthouse.down(true)
    const back = await messenger(createMemoryNetwork(), 'rook', {
      clock,
      lighthouse,
      store: rook.store,
    })
    await flush(400)
    const waiting = only(back.messenger.inviteLinks())
    expect(waiting.claim).toMatch(/^[a-z2-7]{52}$/)
    expect(waiting.cards).toEqual(old)
    expect(waiting.behind).toEqual([lighthouse.address.id])
    // Back at the next mail check: put claimed, and the old card taken down.
    lighthouse.down(false)
    await clock.tick(30_000)
    await flush(400)
    const caught = only(back.messenger.inviteLinks())
    expect(caught.behind).toBeUndefined()
    expect(caught.cards).not.toEqual(old)
    expect(await bury(lighthouse, clock, link.url)).toBe(400)
    await clock.tick(60_000)
    const opened = await mika.messenger.openInviteLink(link.url)
    expect(opened.ok && opened.card.name).toBe('Rook')
  })

  it('shows a new link only once a Lighthouse every opener reads holds its card', async () => {
    const clock = fakeClock(NOON)
    const first = testLighthouse(clock)
    const second = testLighthouse(clock, 'second')
    const lighthouse: TestLighthouse = {
      ...first,
      client: (address) =>
        address.id === second.address.id ? second.client(address) : first.client(address),
    }
    const rook = await messenger(createMemoryNetwork(), 'rook', { clock, lighthouse })
    await rook.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    await rook.messenger.setLighthouses([first.address, second.address])
    await flush(400)
    const options = { lifetime: 7 * DAY, uses: 5 }
    // Only the official one is read, and it's away: the link isn't shown.
    first.down(true)
    expect(await rook.messenger.makeInviteLink(options)).toEqual({
      ok: false,
      error: 'not-stored',
    })
    expect(rook.messenger.inviteLinks()).toEqual([])
    first.down(false)
    // The other one away: shown, and its card put there once it's back.
    second.down(true)
    const result = await rook.messenger.makeInviteLink(options)
    if (!result.ok) throw new Error(result.error)
    expect(result.link.behind).toEqual([second.address.id])
    second.down(false)
    await clock.tick(30_000)
    await flush(400)
    const link = only(rook.messenger.inviteLinks())
    expect(link.behind).toBeUndefined()
    expect(Object.keys(link.cards).sort()).toEqual([first.address.id, second.address.id].sort())
  })

  it('still opens a link whose card a Lighthouse keeps unclaimed', async () => {
    const { clock, lighthouse, rook, mika } = await apart()
    lighthouse.unclaimed(true)
    const link = await made(rook)
    const opened = await mika.messenger.openInviteLink(link.url)
    expect(opened.ok && opened.card.name).toBe('Rook')
    await rook.messenger.cancelInviteLink(link.secret)
    await clock.tick(60_000)
    expect(await mika.messenger.openInviteLink(link.url)).toEqual({ ok: false, error: 'closed' })
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

  it('puts its cards again once after an update, a closed link staying closed', async () => {
    const { clock, lighthouse, rook } = await apart()
    const open = await made(rook)
    const closed = await made(rook)
    await rook.messenger.cancelInviteLink(closed.secret)
    const before = rook.messenger.inviteLinks().find((link) => link.secret === closed.secret)
    expect(Object.keys(before?.cards ?? {}).length).toBeGreaterThan(0)
    await rook.messenger.close()
    // As if this Pigeon ran code from before the cards were put again.
    await rook.store.delete('cardsPutLowS')
    const again = await messenger(createMemoryNetwork(), 'rook', {
      clock,
      lighthouse,
      store: rook.store,
    })
    await flush(400)
    expect(await rook.store.get('cardsPutLowS')).toBe(true)
    const links = again.messenger.inviteLinks()
    // Fake crypto seals the same card the same way, so it keeps its id: what matters is that each
    // link still holds a card, and says the same to whoever opens it.
    expect(Object.keys(links.find((l) => l.secret === open.secret)?.cards ?? {})).not.toEqual([])
    expect(Object.keys(links.find((l) => l.secret === closed.secret)?.cards ?? {})).not.toEqual([])
    const late = await messenger(createMemoryNetwork(), 'kestrel', { clock, lighthouse })
    await late.messenger.setProfile({ handle: 'Kestrel', status: 'online', message: '' })
    expect(await late.messenger.openInviteLink(closed.url)).toEqual({ ok: false, error: 'closed' })
    expect((await late.messenger.openInviteLink(open.url)).ok).toBe(true)
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

describe('Try Again', () => {
  async function unsent() {
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
    lighthouse.down(true)
    await rook.messenger.send(mikaId, 'are you there?')
    await rook.messenger.loadLetters(mikaId)
    await clock.tick(5000)
    await flush(400)
    const route = () => {
      const entry = only(rook.messenger.friends()).log.entries[0]
      if (entry === undefined) throw new Error('no entry')
      return rook.messenger.messageRoute(mikaId, entry)
    }
    return { clock, lighthouse, rook, mikaId, route }
  }

  it('puts an unsent message at once and says where it was left', async () => {
    const { lighthouse, rook, mikaId, route } = await unsent()
    expect(route()).toEqual({ kind: 'retrying' })
    // Still down: nothing is left, and the message says the try found nobody.
    expect(await rook.messenger.tryAgain(mikaId)).toBe(false)
    expect(route()).toEqual({ kind: 'retrying', attempt: 'failed' })
    // Back, and no mail check in between: Try Again leaves it, and the message says where.
    lighthouse.down(false)
    expect(await rook.messenger.tryAgain(mikaId)).toBe(true)
    expect(route()).toEqual({ kind: 'left', where: ['Test Lighthouse'] })
    // Nothing waits any more: the next try has nothing to do.
    expect(await rook.messenger.tryAgain(mikaId)).toBe(true)
    expect(route()).toEqual({ kind: 'left', where: ['Test Lighthouse'] })
  })

  it('puts an unsent message at the Lighthouses the friend uses now, not only the ones it was sealed for', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const old = testLighthouse(clock)
    const moved = testLighthouse(clock, 'moved-lighthouse')
    // Rook can reach both; Mika, when they paired, used only the old one.
    const rook = await messenger(network, 'rook', { clock, lighthouse: old, more: [moved] })
    const mika = await messenger(network, 'mika', { clock, lighthouse: old })
    await pairWith(rook, mika)
    await flush(400)
    const mikaId = only(rook.messenger.friends()).id
    await away(mika)
    await flush(200)
    // The first put finds the old Lighthouse down.
    old.down(true)
    await rook.messenger.send(mikaId, 'are you there?')
    await rook.messenger.loadLetters(mikaId)
    await clock.tick(5000)
    await flush(400)
    const entry = only(rook.messenger.friends()).log.entries[0]
    if (entry === undefined) throw new Error('no entry')
    expect(rook.messenger.messageRoute(mikaId, entry)).toEqual({ kind: 'retrying' })
    expect(moved.lastSeq()).toBe(0)
    // Mika moves to the other Lighthouse and tells Rook while they are both online, then goes.
    const back = await messenger(network, 'mika', { clock, store: mika.store, lighthouse: moved })
    await flush(400)
    expect((await rook.messenger.mailBook(mikaId)).lighthouses).toEqual([moved.address])
    await away(back)
    await flush(200)
    // Try Again puts the letter where Mika's mail goes now.
    expect(await rook.messenger.tryAgain(mikaId)).toBe(true)
    expect(moved.lastSeq()).toBe(1)
    // Every put again after that keeps to the old one too, until a receipt comes.
    old.down(false)
    await clock.tick(4 * 24 * 60 * 60 * 1000)
    await rook.messenger.checkMail()
    await flush(400)
    expect(old.lastSeq()).toBe(1)
  })

  it('says it is trying while the try is under way', async () => {
    const { lighthouse, rook, mikaId, route } = await unsent()
    lighthouse.down(false)
    const trying = rook.messenger.tryAgain(mikaId)
    expect(route()).toEqual({ kind: 'retrying', attempt: 'trying' })
    await trying
    expect(route()?.kind).toBe('left')
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

describe('Lighthouses someone else names', () => {
  const at = (url: string, n = url): LighthouseAddress => ({
    id: fakeSigner(n).id,
    name: n.replace(/[^a-z0-9]/g, ''),
    url,
  })
  const mikasOwn = at('wss://mika.example.com/')
  const mikasPrivate = at('wss://192.168.1.10/')
  const mikasLocal = at('ws://localhost:8787/')
  const shared = at('wss://10.0.0.2/', 'home')

  /**
   * The test Lighthouse, and every other address this Pigeon opened a connection to, which go
   * nowhere: what a friend's own Lighthouse would see.
   */
  function watched(base: TestLighthouse) {
    const contacted: string[] = []
    const closed: string[] = []
    const lighthouse: TestLighthouse = {
      ...base,
      client: (address) =>
        address.url === base.address.url
          ? base.client(address)
          : {
              hello: async () => {
                contacted.push(address.url)
                return err('unreachable')
              },
              request: async () => {
                contacted.push(address.url)
                return err('unreachable')
              },
              close: () => closed.push(address.url),
            },
    }
    return { lighthouse, contacted, closed }
  }

  /** Mika names `hers` in her hello and goes away; Rook writes to her. */
  async function writeToMika(hers: readonly LighthouseAddress[], relayOnly: boolean) {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const base = testLighthouse(clock)
    const { lighthouse, contacted } = watched(base)
    const rook = await messenger(network, 'rook', { clock, lighthouse })
    const mika = await messenger(network, 'mika', { clock, lighthouse: base })
    // Rook's own list has a Lighthouse at home, on a private address he chose.
    await rook.messenger.setLighthouses([base.address, shared])
    await mika.messenger.setLighthouses(hers)
    await pairWith(rook, mika)
    await flush(400)
    const mikaId = only(rook.messenger.friends()).id
    if (relayOnly) await rook.messenger.setRelayOnly(true)
    await away(mika)
    await flush(200)
    contacted.length = 0
    await rook.messenger.send(mikaId, 'are you there?')
    await rook.messenger.loadLetters(mikaId)
    await clock.tick(5000)
    await flush(400)
    const entry = only(rook.messenger.friends()).log.entries[0]
    if (entry === undefined) throw new Error('no entry')
    return { contacted, route: rook.messenger.messageRoute(mikaId, entry) }
  }

  it("leaves a friend's mail at their public Lighthouse, never a private or local one", async () => {
    const { contacted, route } = await writeToMika(
      [testLighthouse(fakeClock()).address, mikasOwn, mikasPrivate, mikasLocal],
      false,
    )
    expect(contacted).toContain(mikasOwn.url)
    expect(contacted).not.toContain(mikasPrivate.url)
    expect(contacted).not.toContain(mikasLocal.url)
    expect(route).toEqual({ kind: 'left', where: ['Test Lighthouse'] })
  })

  it('takes a private address a friend names when it is one you chose', async () => {
    const elsewhere = at('wss://10.0.0.2/api/websocket', 'proxy')
    const { contacted } = await writeToMika([shared, mikasPrivate, elsewhere], false)
    expect(contacted).toContain(shared.url)
    expect(contacted).not.toContain(mikasPrivate.url)
    // The same private host on another path isn't the Lighthouse you chose.
    expect(contacted).not.toContain(elsewhere.url)
  })

  it('with relay-only on, leaves mail only at Lighthouses you chose', async () => {
    const { contacted, route } = await writeToMika(
      [testLighthouse(fakeClock()).address, mikasOwn, shared],
      true,
    )
    expect(contacted).not.toContain(mikasOwn.url)
    expect(contacted).toContain(shared.url)
    expect(route).toEqual({ kind: 'left', where: ['Test Lighthouse'] })
  })

  it('with relay-only on, counts only the same URL as one you chose', async () => {
    const { contacted } = await writeToMika(
      [at('wss://lighthouse.test/someone-else', 'tenant'), at('wss://LIGHTHOUSE.test/', 'caps')],
      true,
    )
    expect(contacted).toEqual([])
  })

  it('mails what waited as soon as relay-only is turned off', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const base = testLighthouse(clock)
    const { lighthouse, contacted } = watched(base)
    const rook = await messenger(network, 'rook', { clock, lighthouse })
    const mika = await messenger(network, 'mika', { clock, lighthouse: base })
    await mika.messenger.setLighthouses([mikasOwn])
    await pairWith(rook, mika)
    await flush(400)
    const mikaId = only(rook.messenger.friends()).id
    await rook.messenger.setRelayOnly(true)
    await away(mika)
    await flush(200)
    await rook.messenger.send(mikaId, 'are you there?')
    await rook.messenger.loadLetters(mikaId)
    await clock.tick(5000)
    await flush(400)
    expect(contacted).not.toContain(mikasOwn.url)
    await rook.messenger.setRelayOnly(false)
    await flush(400)
    await clock.tick(5000)
    await flush(400)
    expect(contacted).toContain(mikasOwn.url)
  })

  it('with relay-only on, sends no receipt to a friend who uses only their own Lighthouse', async () => {
    const rooksOwn = at('wss://rook.example.com/')
    for (const relayOnly of [false, true]) {
      const network = createMemoryNetwork()
      const clock = fakeClock(NOON)
      const base = testLighthouse(clock)
      const rook = await messenger(network, 'rook', { clock, lighthouse: base })
      const mika = await messenger(network, 'mika', { clock, lighthouse: base })
      // Rook's mail comes only to his own Lighthouse; Mika's to the shared one.
      await rook.messenger.setLighthouses([rooksOwn])
      await pairWith(rook, mika)
      await flush(400)
      const mikaId = only(rook.messenger.friends()).id
      if (relayOnly) await mika.messenger.setRelayOnly(true)
      await away(mika)
      await flush(200)
      await rook.messenger.send(mikaId, 'are you there?')
      await clock.tick(5000)
      await flush(400)
      // Mika opens Pigeon alone, takes the letter, and would put her receipt at Rook's.
      const { lighthouse, contacted } = watched(base)
      const back = await messenger(createMemoryNetwork(), 'mika', {
        clock,
        lighthouse,
        store: mika.store,
      })
      await flush(800)
      const rookId = only(back.messenger.friends()).id
      expect(back.messenger.friend(rookId)?.log.entries.map((entry) => entry.text)).toEqual([
        'are you there?',
      ])
      if (relayOnly) expect(contacted).not.toContain(rooksOwn.url)
      else expect(contacted).toContain(rooksOwn.url)
      await back.messenger.close()
      await rook.messenger.close()
    }
  })

  it('with relay-only on, waits to meet a friend who uses only their own Lighthouse', async () => {
    const { contacted, route } = await writeToMika([mikasOwn], true)
    expect(contacted).toEqual([])
    expect(route).toEqual({ kind: 'waiting' })
  })

  it('checks a Lighthouse you are adding at any address, relay-only or not', async () => {
    const clock = fakeClock(NOON)
    const { lighthouse, contacted } = watched(testLighthouse(clock))
    const rook = await messenger(createMemoryNetwork(), 'rook', { clock, lighthouse })
    await rook.messenger.checkLighthouse(mikasLocal)
    await rook.messenger.setRelayOnly(true)
    await rook.messenger.checkLighthouse(mikasPrivate)
    await rook.messenger.checkLighthouse(mikasOwn)
    expect(contacted).toEqual([mikasLocal.url, mikasPrivate.url, mikasOwn.url])
  })

  it('still gives your other devices what you wrote when the friend can’t be mailed', async () => {
    for (const relayOnly of [true, false]) {
      const network = createMemoryNetwork()
      const clock = fakeClock(NOON)
      const lighthouse = testLighthouse(clock)
      const laptop = await messenger(network, 'rook', { clock, lighthouse })
      const mika = await messenger(network, 'mika', { clock, lighthouse })
      // Hers: public, which relay-only won't reach, or private, which nothing of Rook's will.
      await mika.messenger.setLighthouses([relayOnly ? mikasOwn : mikasPrivate])
      await pairWith(laptop, mika)
      const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock, lighthouse)
      await flush(400)
      const mikaId = only(laptop.messenger.friends()).id
      if (relayOnly) await laptop.messenger.setRelayOnly(true)
      await away(mika)
      await away(phone)
      await laptop.messenger.send(mikaId, 'see you saturday')
      await clock.tick(5000)
      await flush(400)
      // A mail check doesn't send the copy again.
      const outbox = async () => ((await laptop.store.get('mail-outbox')) as unknown[]).length
      const queued = await outbox()
      await clock.tick(10 * 60 * 1000)
      await flush(400)
      expect(await outbox()).toBeLessThanOrEqual(queued)
      await laptop.messenger.close()
      laptop.transport.disconnect()
      const back = await messenger(createMemoryNetwork(), 'rook-phone', {
        clock,
        lighthouse,
        store: phone.store,
      })
      await flush(800)
      expect(back.messenger.friend(mikaId)?.log.entries.map((entry) => entry.text)).toEqual([
        'see you saturday',
      ])
      await back.messenger.close()
    }
  })

  it('closes a connection relay-only now refuses, and only that one', async () => {
    const clock = fakeClock(NOON)
    const { lighthouse, contacted, closed } = watched(testLighthouse(clock))
    const rook = await messenger(createMemoryNetwork(), 'rook', { clock, lighthouse })
    await rook.messenger.setLighthouses([lighthouse.address, mikasLocal])
    // Both used once: Mika's public one as a friend's would be, and Rook's own local one.
    await rook.messenger.checkLighthouse(mikasOwn)
    await rook.messenger.checkLighthouse(mikasLocal)
    expect(contacted).toEqual([mikasOwn.url, mikasLocal.url])
    await rook.messenger.setRelayOnly(true)
    expect(closed).toEqual([mikasOwn.url])
  })

  it("looks an invite link's Lighthouse up only when it may", async () => {
    const clock = fakeClock(NOON)
    const base = testLighthouse(clock)
    const rook = await messenger(createMemoryNetwork(), 'rook', { clock, lighthouse: base })
    await rook.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    const made = await rook.messenger.makeInviteLink({ lifetime: 60 * 60 * 1000, uses: 1 })
    if (!made.ok) throw new Error(made.error)
    const { lighthouse, contacted } = watched(base)
    const mika = await messenger(createMemoryNetwork(), 'mika', { clock, lighthouse })
    const naming = (address: LighthouseAddress) =>
      `${made.link.url}?l=${encodeURIComponent(formatLighthouseAddress(address))}`

    for (const address of [mikasPrivate, mikasLocal, at('wss://2130706433/', 'decimal')])
      expect((await mika.messenger.openInviteLink(naming(address))).ok).toBe(true)
    expect(contacted).toEqual([])
    expect((await mika.messenger.openInviteLink(naming(mikasOwn))).ok).toBe(true)
    expect(contacted).toContain(mikasOwn.url)

    contacted.length = 0
    await mika.messenger.setRelayOnly(true)
    expect((await mika.messenger.openInviteLink(naming(mikasOwn))).ok).toBe(true)
    expect(contacted).toEqual([])
  })
})

/**
 * Takes away what says a secret was sealed, as a Pigeon from before kept it: each friend's pair
 * secret, and the self secret, then look as if they were agreed the old way.
 */
async function fromBefore(store: Store) {
  const friends = ((await store.get('friends')) ?? []) as Record<string, unknown>[]
  await store.set(
    'friends',
    friends.map(({ sealed: _sealed, replacing: _replacing, ...rest }) => rest),
  )
  await store.delete('selfSecretState')
}

/** Rook and Mika, paired, closed, and their pair secret made to look as if from before. */
async function oldSecretFriends() {
  const network = createMemoryNetwork()
  const clock = fakeClock(NOON)
  const lighthouse = testLighthouse(clock)
  const a = await messenger(network, 'rook', { clock, lighthouse })
  const b = await messenger(network, 'mika', { clock, lighthouse })
  await pairWith(a, b)
  const old = only(a.messenger.friends()).secret ?? ''
  await a.messenger.close()
  await b.messenger.close()
  await fromBefore(a.store)
  await fromBefore(b.store)
  return { network, clock, lighthouse, old, stores: { a: a.store, b: b.store } }
}

const today = (secret: string) => pairRoomOn(fakeCrypto, secret, '2026-11-24')

describe('replacing secrets from before', () => {
  it('gives a friend a new pair secret by sealed mail, and both leave the old rooms', async () => {
    const { network, clock, lighthouse, old, stores } = await oldSecretFriends()
    // Eve learned the old secret when they paired, and waits in its room for them.
    const eve = await network.transport().join(await today(old), {
      password: await pairPassword(fakeCrypto, old),
    })
    const a = await messenger(network, 'rook', { clock, lighthouse, store: stores.a })
    const b = await messenger(network, 'mika', { clock, lighthouse, store: stores.b })
    await flush(400)
    await a.messenger.checkMail()
    await flush(400)
    await b.messenger.checkMail()
    await flush(800)
    await a.messenger.checkMail()
    await flush(800)
    await b.messenger.checkMail()
    await flush(400)

    const mika = only(a.messenger.friends())
    const rook = only(b.messenger.friends())
    expect(mika.secret).not.toBe(old)
    expect(rook.secret).toBe(mika.secret)
    expect(mika.sealed && rook.sealed).toBe(true)
    // Each has seen every device of the other's holding it, so the old room is left to Eve
    // alone, and nothing more is looked for under the old secret.
    expect(mika.replacing?.settled).toBe(true)
    expect(rook.replacing?.settled).toBe(true)
    expect(network.occupants(await today(old))).toBe(1)
    expect(network.occupants(await today(mika.secret ?? ''))).toBe(2)
    expect(a.messenger.friend(mika.id)?.online).toBe(true)

    // What Eve can find under the old secret's tags is sealed to Rook's and Mika's devices: no
    // key of hers opens it, and the new secret isn't in it.
    const client = lighthouse.client(lighthouse.address)
    for (const [to, sealer] of [
      [mika.id, fakeSealCrypto().sealer('eve')],
      [rook.id, fakeSealCrypto().sealer('eve')],
    ] as const) {
      const tag = await mailTag(fakeCrypto, base32DecodeOk(old), to, '2026-11-24')
      const listed = await client.request({ type: 'list', tags: [tag], cursor: 0 })
      if (!listed.ok || listed.value.type !== 'listed') throw new Error('no list')
      for (const item of listed.value.items) {
        const got = await client.request({ type: 'get', id: item.id })
        if (!got.ok || got.value.type !== 'blob') continue
        expect(got.value.blob).not.toContain(mika.secret ?? '')
        const opened = await openMail(fakeCrypto, fakeSealCrypto(), sealer, got.value.blob, {
          to,
          kinds: ['rekey'],
          dates: ['2026-11-24'],
        })
        expect(opened.ok).toBe(false)
      }
    }
    // Nor can she find the new rooms from the old secret: none of its days names them.
    for (const day of ['2026-11-23', '2026-11-24', '2026-11-25'])
      expect(await pairRoomOn(fakeCrypto, old, day)).not.toBe(await today(mika.secret ?? ''))
    expect(eve.peers()).toEqual([])

    await b.messenger.send(rook.id, 'in the new room')
    await flush()
    expect(a.messenger.friend(mika.id)?.log.entries.map((entry) => entry.text)).toEqual([
      'in the new room',
    ])
    // It sticks across a reload.
    await a.messenger.close()
    const again = await messenger(network, 'rook', { clock, lighthouse, store: stores.a })
    await flush(400)
    expect(only(again.messenger.friends())).toMatchObject({ secret: mika.secret, sealed: true })
    expect(network.occupants(await today(old))).toBe(1)
  })

  it('settles on one secret when both sides propose at once', async () => {
    const { network, clock, lighthouse, old, stores } = await oldSecretFriends()
    // Both open Pigeon while the Lighthouse is down, so neither hears the other's proposal
    // before making its own.
    lighthouse.down(true)
    const a = await messenger(network, 'rook', { clock, lighthouse, store: stores.a })
    const b = await messenger(network, 'mika', { clock, lighthouse, store: stores.b })
    await flush(800)
    lighthouse.down(false)
    const proposed = [only(a.messenger.friends()).secret, only(b.messenger.friends()).secret]
    expect(proposed[0]).not.toBe(proposed[1])
    for (let round = 0; round < 3; round++) {
      await a.messenger.checkMail()
      await flush(400)
      await b.messenger.checkMail()
      await flush(400)
    }
    const mika = only(a.messenger.friends())
    const rook = only(b.messenger.friends())
    expect(mika.secret).toBe(rook.secret)
    expect(mika.secret).not.toBe(old)
    expect(proposed).toContain(mika.secret)
    expect(network.occupants(await today(old))).toBe(0)
    expect(network.occupants(await today(mika.secret ?? ''))).toBe(2)
  })

  it('keeps chatting with a friend whose Pigeon hasn’t updated, and moves once it has', async () => {
    const { network, clock, lighthouse, old, stores } = await oldSecretFriends()
    const a = await messenger(network, 'rook', { clock, lighthouse, store: stores.a })
    // Mika's Pigeon doesn't look for mail of this kind: here, it looks for none at all.
    const b = await messenger(network, 'mika', { clock, store: stores.b })
    await flush(400)
    await a.messenger.checkMail()
    await flush(800)
    const mika = only(a.messenger.friends())
    expect(mika.secret).not.toBe(old)
    expect(mika.replacing?.heardAt).toBeUndefined()
    // Rook waits in both rooms, so Mika, still in the old one, hears him as before.
    expect(network.occupants(await today(old))).toBe(2)
    expect(mika.online).toBe(true)
    const rook = only(b.messenger.friends())
    expect(rook.secret).toBe(old)
    await a.messenger.send(mika.id, 'still here')
    await flush()
    expect(b.messenger.friend(rook.id)?.log.entries.map((entry) => entry.text)).toEqual([
      'still here',
    ])

    // Mika's Pigeon updates: it finds the proposal waiting under the old secret and moves.
    await b.messenger.close()
    await flush()
    const updated = await messenger(network, 'mika', { clock, lighthouse, store: stores.b })
    await flush(800)
    await a.messenger.checkMail()
    await flush(800)
    expect(only(updated.messenger.friends()).secret).toBe(mika.secret)
    expect(only(a.messenger.friends()).secret).toBe(mika.secret)
    expect(network.occupants(await today(old))).toBe(0)
    expect(network.occupants(await today(mika.secret ?? ''))).toBe(2)
  })

  it('brings a device that was away for longer than mail is kept onto the same secret', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const laptop = await messenger(network, 'rook', { clock, lighthouse })
    const mika = await messenger(network, 'mika', { clock, lighthouse })
    await pairWith(laptop, mika)
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock, lighthouse)
    await flush(400)
    const old = only(mika.messenger.friends()).secret ?? ''
    const oldSelf = (await laptop.store.get('selfSecret')) as string
    for (const side of [laptop, mika, phone]) await side.messenger.close()
    for (const side of [laptop, mika, phone]) await fromBefore(side.store)

    // Rook's phone stays away; his laptop and Mika move.
    const a = await messenger(network, 'rook', { clock, lighthouse, store: laptop.store })
    const b = await messenger(network, 'mika', { clock, lighthouse, store: mika.store })
    for (let round = 0; round < 2; round++) {
      await a.messenger.checkMail()
      await flush(400)
      await b.messenger.checkMail()
      await flush(400)
    }
    const moved = only(b.messenger.friends())
    expect(moved.secret).not.toBe(old)
    expect(only(a.messenger.friends()).secret).toBe(moved.secret)
    // Mika still waits on the phone, so she goes on looking under the old secret.
    expect(moved.replacing?.heard).toEqual([laptop.messenger.device])

    // A tablet linked meanwhile carries on the self secret's replacement where the laptop is.
    const { device: tablet } = await linkDevice(network, a, 'rook-tablet', clock, lighthouse)
    const tabletState = (await tablet.store.get('selfSecretState')) as { replacing?: unknown }
    expect(tabletState.replacing).toMatchObject({ old: oldSelf })
    await tablet.messenger.close()

    // Forty days on, every letter about it has expired; the phone comes back.
    await clock.tick(40 * 24 * HOUR)
    const back = await messenger(network, 'rook-phone', { clock, lighthouse, store: phone.store })
    for (let round = 0; round < 3; round++) {
      await back.messenger.checkMail()
      await flush(400)
      await b.messenger.checkMail()
      await flush(400)
      await a.messenger.checkMail()
      await flush(400)
    }
    expect(only(back.messenger.friends()).secret).toBe(moved.secret)
    expect(await phone.store.get('selfSecret')).toBe(await laptop.store.get('selfSecret'))
    expect(network.occupants(await today(old))).toBe(0)
  })

  it('replaces the self secret on every device and asks you to check your list', async () => {
    const { network, clock, lighthouse, laptop, phone } = await laptopAndPhone()
    const old = (await laptop.store.get('selfSecret')) as string
    await laptop.messenger.close()
    await phone.messenger.close()
    await fromBefore(laptop.store)
    await fromBefore(phone.store)
    const a = await messenger(network, 'rook', { clock, lighthouse, store: laptop.store })
    const b = await messenger(network, 'rook-phone', { clock, lighthouse, store: phone.store })
    await flush(400)
    await a.messenger.checkMail()
    await flush(800)
    await b.messenger.checkMail()
    await flush(800)
    await a.messenger.checkMail()
    await flush(800)
    const secret = await laptop.store.get('selfSecret')
    expect(secret).not.toBe(old)
    expect(await phone.store.get('selfSecret')).toBe(secret)
    expect(a.messenger.checkDevices() && b.messenger.checkDevices()).toBe(true)
    // Both devices left the old self room once each saw the other in the new one.
    const [oldRoom] = await selfRoomsAt(fakeCrypto, old, clock.now())
    const [newRoom] = await selfRoomsAt(fakeCrypto, secret as string, clock.now())
    expect(network.occupants(oldRoom?.name ?? 'self:')).toBe(0)
    expect(network.occupants(newRoom?.name ?? 'self:')).toBe(2)
    await a.messenger.devicesChecked()
    expect(a.messenger.checkDevices()).toBe(false)
  })

  it('never lets a removed device choose the new secret by naming another as its maker', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const laptop = await messenger(network, 'rook', { clock, lighthouse })
    const mika = await messenger(network, 'mika', { clock, lighthouse })
    await pairWith(laptop, mika)
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock, lighthouse)
    await flush(400)
    const laptopId = laptop.messenger.device
    const phoneId = phone.messenger.device
    for (const side of [laptop, mika, phone]) await side.messenger.close()
    for (const side of [laptop, mika, phone]) {
      const friends = ((await side.store.get('friends')) ?? []) as Record<string, unknown>[]
      await side.store.set(
        'friends',
        friends.map(({ sealed: _s, replacing: _r, ...rest }) => rest),
      )
    }
    // Rook removes the phone while Mika is away, and his letters can't go out yet.
    lighthouse.down(true)
    const laptop1 = await messenger(network, 'rook', { clock, lighthouse, store: laptop.store })
    await flush(400)
    await laptop1.messenger.removeDevice(phoneId)
    await flush(400)
    await laptop1.messenger.checkMail()
    await flush(400)
    const laptopOwn = only(laptop1.messenger.friends()).secret
    await laptop1.messenger.close()
    laptop1.transport.disconnect()
    await flush(400)
    lighthouse.down(false)
    await clock.tick(60_000)
    // The removed phone, on Mika's list still, proposes at time 0 in the laptop's name.
    forged.by = laptopId
    const phone1 = await messenger(network, 'rook-phone', { clock, lighthouse, store: phone.store })
    await flush(400)
    await phone1.messenger.checkMail()
    await flush(800)
    const phoneSecret = only(phone1.messenger.friends()).secret
    await phone1.messenger.close()
    phone1.transport.disconnect()
    delete forged.by
    await flush(400)
    const mika1 = await messenger(network, 'mika', { clock, lighthouse, store: mika.store })
    await flush(400)
    await mika1.messenger.checkMail()
    await flush(400)
    const laptop2 = await messenger(network, 'rook', { clock, lighthouse, store: laptop.store })
    await flush(400)
    for (let round = 0; round < 4; round++) {
      await clock.tick(60_000)
      for (const side of [laptop2, mika1]) {
        await side.messenger.checkMail()
        await flush(400)
      }
    }
    expect(phoneSecret).not.toBe(laptopOwn)
    // The forged proposal carries no signature of the laptop's, so it never counts.
    expect(only(laptop2.messenger.friends()).secret).toBe(laptopOwn)
    expect(only(mika1.messenger.friends()).secret).toBe(laptopOwn)
  })

  it('reads the self secret from its state, so a tab closed between writes keeps the new one', async () => {
    const store = createMemoryStore()
    const signer = fakeSigner('rook')
    const old = 'a'.repeat(52)
    const next = `${'b'.repeat(51)}a`
    // The state is written first: closed before the secret on its own was written.
    await store.set('selfSecret', old)
    await store.set('selfSecretState', {
      secret: next,
      sealed: true,
      replacing: { old, at: NOON, by: signer.id, sig: 'a'.repeat(52) },
    })
    const devices = await loadDevices({ crypto: fakeCrypto, signer, store, clock: fakeClock(NOON) })
    expect(devices.selfSecretState()?.secret).toBe(next)
    expect(devices.selfSecretState()?.replacing?.old).toBe(old)
  })

  it('keeps a self secret from before that never left this device, asking nothing', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const store = createMemoryStore()
    await store.set('selfSecret', 'a'.repeat(52))
    const a = await messenger(network, 'rook', { clock, lighthouse, store })
    await a.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    await a.messenger.checkMail()
    await flush(400)
    expect(await store.get('selfSecret')).toBe('a'.repeat(52))
    expect(await store.get('selfSecretState')).toEqual({ secret: 'a'.repeat(52), sealed: true })
    expect(a.messenger.checkDevices()).toBe(false)
  })
  it('moves a device that settled early when an earlier proposal from its own side arrives late', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const laptop = await messenger(network, 'rook', { clock, lighthouse })
    const mika = await messenger(network, 'mika', { clock, lighthouse })
    await pairWith(laptop, mika)
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock, lighthouse)
    await flush(400)
    for (const side of [laptop, mika, phone]) await side.messenger.close()
    // Only the pair secret is from before.
    for (const side of [laptop, mika, phone]) {
      const friends = ((await side.store.get('friends')) ?? []) as Record<string, unknown>[]
      await side.store.set(
        'friends',
        friends.map(({ sealed: _s, replacing: _r, ...rest }) => rest),
      )
    }
    // The laptop proposes while its Lighthouse can't be reached, so its letters wait, and closes.
    lighthouse.down(true)
    const laptop1 = await messenger(network, 'rook', { clock, lighthouse, store: laptop.store })
    await flush(400)
    await laptop1.messenger.checkMail()
    await flush(400)
    const first = only(laptop1.messenger.friends()).secret
    await laptop1.messenger.close()
    laptop1.transport.disconnect()
    await flush(400)
    lighthouse.down(false)
    await clock.tick(60_000)
    // Mika, finding nothing, proposes later; the phone takes hers, the only one it sees, and has
    // then seen every device of Mika's with it.
    const mika1 = await messenger(network, 'mika', { clock, lighthouse, store: mika.store })
    await flush(400)
    await mika1.messenger.checkMail()
    await flush(400)
    const second = only(mika1.messenger.friends()).secret
    expect(second).not.toBe(first)
    const phone1 = await messenger(network, 'rook-phone', { clock, lighthouse, store: phone.store })
    await flush(400)
    for (let round = 0; round < 2; round++) {
      await clock.tick(60_000)
      await phone1.messenger.checkMail()
      await flush(400)
    }
    expect(only(phone1.messenger.friends()).secret).toBe(second)
    expect(only(phone1.messenger.friends()).replacing?.settled).toBe(true)
    // The laptop comes back and its earlier proposal goes out: everyone ends on it.
    const laptop2 = await messenger(network, 'rook', { clock, lighthouse, store: laptop.store })
    await flush(400)
    for (let round = 0; round < 4; round++) {
      await clock.tick(60_000)
      for (const side of [laptop2, mika1, phone1]) {
        await side.messenger.checkMail()
        await flush(400)
      }
    }
    for (const side of [laptop2, mika1, phone1])
      expect(only(side.messenger.friends()).secret).toBe(first)
    // And the phone hears Mika.
    const mikaId = only(phone1.messenger.friends()).id
    await mika1.messenger.send(only(mika1.messenger.friends()).id, 'hello phone')
    await flush(400)
    for (let round = 0; round < 2; round++) {
      await clock.tick(60_000)
      await mika1.messenger.checkMail()
      await flush(400)
      await phone1.messenger.checkMail()
      await flush(400)
    }
    expect(phone1.messenger.friend(mikaId)?.log.entries.map((entry) => entry.text)).toContain(
      'hello phone',
    )
  })
})

const base32DecodeOk = (text: string): Uint8Array => {
  const bytes = base32Decode(text)
  if (!bytes.ok) throw new Error('not base32')
  return bytes.value
}

describe('replacing secrets after a removal', () => {
  type Side = Awaited<ReturnType<typeof messenger>>
  /** Each side looks for mail in turn, `rounds` times, a minute apart. */
  async function checkAll(sides: readonly Side[], rounds = 3) {
    for (let round = 0; round < rounds; round++)
      for (const side of sides) {
        await side.messenger.checkMail()
        await flush(400)
      }
  }
  /**
   * How many `mail:rekey` letters to `to`, under `secret`'s tags today, the device called `name`
   * can open, and how many there are.
   */
  async function rekeysFor(lighthouse: TestLighthouse, secret: string, to: string, name: string) {
    const client = lighthouse.client(lighthouse.address)
    const tag = await mailTag(fakeCrypto, base32DecodeOk(secret), to, '2026-11-24')
    const listed = await client.request({ type: 'list', tags: [tag], cursor: 0 })
    if (!listed.ok || listed.value.type !== 'listed') throw new Error('no list')
    let opened = 0
    const secrets: string[] = []
    for (const item of listed.value.items) {
      const got = await client.request({ type: 'get', id: item.id })
      if (!got.ok || got.value.type !== 'blob') continue
      const open = await openMail(
        fakeCrypto,
        fakeSealCrypto(),
        fakeSealCrypto().sealer(name),
        got.value.blob,
        { to, kinds: ['rekey'], dates: ['2026-11-24'] },
      )
      if (!open.ok) continue
      opened += 1
      const body = open.value.letter.body as { secret?: unknown; prior?: { secret?: unknown } }
      for (const secret of [body.secret, body.prior?.secret])
        if (typeof secret === 'string') secrets.push(secret)
    }
    return { opened, listed: listed.value.items.length, secrets }
  }

  /** Rook's laptop, phone and tablet, and Mika, paired since codes went through SPAKE2. */
  async function rookAndMika() {
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
    const pair = only(mika.messenger.friends()).secret ?? ''
    const own = (await laptop.store.get('selfSecret')) as string
    return { network, clock, lighthouse, laptop, mika, phone, tablet, pair, own }
  }

  it('replaces the pair and self secrets, and the removed device is given neither', async () => {
    const { network, lighthouse, laptop, mika, phone, tablet, pair, own } = await rookAndMika()
    expect(only(laptop.messenger.friends()).replacing).toBeUndefined()
    // The phone is lost, and the laptop, which writes Rook's list, takes it off.
    await laptop.messenger.removeDevice(phone.messenger.device)
    await flush(400)
    await laptop.messenger.checkMail()
    await flush(400)
    // What the old secrets' tags lead to now is sealed to the devices still on the lists: the
    // phone can find it, but opens none of it.
    for (const [secret, to, name] of [
      [pair, mika.messenger.self, 'mika'],
      [own, laptop.messenger.self, 'rook-tablet'],
    ] as const) {
      expect((await rekeysFor(lighthouse, secret, to, name)).opened).toBeGreaterThan(0)
      expect((await rekeysFor(lighthouse, secret, to, 'rook-phone')).opened).toBe(0)
    }
    await checkAll([laptop, tablet, mika])

    const onLaptop = only(laptop.messenger.friends())
    const onMika = only(mika.messenger.friends())
    expect(onLaptop.secret).not.toBe(pair)
    expect(onMika.secret).toBe(onLaptop.secret)
    expect(only(tablet.messenger.friends()).secret).toBe(onLaptop.secret)
    expect(onLaptop.replacing?.old).toBe(pair)
    expect(onLaptop.replacing?.settled).toBe(true)
    expect(onMika.replacing?.settled).toBe(true)
    const newOwn = (await laptop.store.get('selfSecret')) as string
    expect(newOwn).not.toBe(own)
    expect(await tablet.store.get('selfSecret')).toBe(newOwn)
    // Sealed, after a removal: nothing from before to ask about.
    expect(laptop.messenger.checkDevices() || tablet.messenger.checkDevices()).toBe(false)

    // The phone stopped, holding only the old secrets.
    expect(phone.messenger.deviceStatus()).toBe('removed')
    expect(only(phone.messenger.friends()).secret).toBe(pair)
    expect(await phone.store.get('selfSecret')).toBe(own)
    // Everyone has left the old rooms, and the new ones can't be found from the old secrets.
    expect(network.occupants(await today(pair))).toBe(0)
    expect(network.occupants(await today(onLaptop.secret ?? ''))).toBe(3)
    // Only the removed phone, which stopped talking, is left in the old self room.
    const [oldSelfRoom] = await selfRoomsAt(fakeCrypto, own, NOON)
    const [newSelfRoom] = await selfRoomsAt(fakeCrypto, newOwn, NOON)
    expect(network.occupants(oldSelfRoom?.name ?? 'self:')).toBe(1)
    expect(network.occupants(newSelfRoom?.name ?? 'self:')).toBe(2)
    // And they chat in the new rooms.
    await mika.messenger.send(onMika.id, 'after the phone')
    await flush()
    expect(only(laptop.messenger.friends()).log.entries.at(-1)?.text).toBe('after the phone')
    expect(only(tablet.messenger.friends()).log.entries.at(-1)?.text).toBe('after the phone')
  })

  it('begins a new round after one that replaced a secret from before', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const laptop0 = await messenger(network, 'rook', { clock, lighthouse })
    const mika0 = await messenger(network, 'mika', { clock, lighthouse })
    await pairWith(laptop0, mika0)
    const { device: phone0 } = await linkDevice(network, laptop0, 'rook-phone', clock, lighthouse)
    await flush(400)
    const old = only(mika0.messenger.friends()).secret ?? ''
    for (const side of [laptop0, mika0, phone0]) await side.messenger.close()
    for (const side of [laptop0, mika0, phone0]) await fromBefore(side.store)
    const laptop = await messenger(network, 'rook', { clock, lighthouse, store: laptop0.store })
    const mika = await messenger(network, 'mika', { clock, lighthouse, store: mika0.store })
    const phone = await messenger(network, 'rook-phone', { clock, lighthouse, store: phone0.store })
    await flush(400)
    await checkAll([laptop, mika, phone])
    // Everyone moved off the secret from before, and let it go.
    // A plain string: the friend as listed is live, and would show the newer secret later.
    const first = only(laptop.messenger.friends()).secret ?? ''
    expect(first).not.toBe(old)
    expect(only(mika.messenger.friends()).replacing?.settled).toBe(true)
    expect(only(phone.messenger.friends()).secret).toBe(first)

    await laptop.messenger.removeDevice(phone.messenger.device)
    await flush(400)
    await checkAll([laptop, mika])
    const onLaptop = only(laptop.messenger.friends())
    const onMika = only(mika.messenger.friends())
    expect(onLaptop.secret).not.toBe(first)
    expect(onMika.secret).toBe(onLaptop.secret)
    // A round of its own, for the secret they were on, with the one before kept.
    expect(onMika.replacing?.old).toBe(first)
    expect(onMika.prior?.old).toBe(old)
    expect(onMika.replacing?.settled).toBe(true)
    expect(only(phone.messenger.friends()).secret).toBe(first)
    expect(network.occupants(await today(first))).toBe(0)
    expect(network.occupants(await today(onLaptop.secret ?? ''))).toBe(2)
    // It sticks across a reload.
    await mika.messenger.close()
    const again = await messenger(network, 'mika', { clock, lighthouse, store: mika0.store })
    await flush(400)
    expect(only(again.messenger.friends())).toMatchObject({
      secret: onLaptop.secret,
      prior: { old },
    })
  })

  it('never ends on a secret proposed before the other side heard of a removal', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    // Mika's clock is two minutes behind Rook's.
    const mikaClock = fakeClock(NOON - 2 * 60_000)
    const lighthouse = testLighthouse(clock)
    const laptop0 = await messenger(network, 'rook', { clock, lighthouse })
    const mika0 = await messenger(network, 'mika', { clock: mikaClock, lighthouse })
    await pairWith(laptop0, mika0)
    const { device: rookPhone } = await linkDevice(
      network,
      laptop0,
      'rook-phone',
      clock,
      lighthouse,
    )
    const linked = await linkDevice(network, mika0, 'mika-phone', mikaClock, lighthouse)
    await flush(400)
    await checkAll([laptop0, mika0, rookPhone, linked.device], 2)
    const pair = only(mika0.messenger.friends()).secret ?? ''
    for (const side of [laptop0, mika0, rookPhone, linked.device]) await away(side)

    // Each removes their phone while the two laptops can't reach each other or the Lighthouse.
    lighthouse.down(true)
    const rook1 = await messenger(createMemoryNetwork(), 'rook', {
      clock,
      lighthouse,
      store: laptop0.store,
    })
    await flush(400)
    await rook1.messenger.removeDevice(fakeSigner('rook-phone').id)
    await flush(400)
    await rook1.messenger.checkMail()
    await flush(400)
    const rooks = only(rook1.messenger.friends()).secret ?? ''
    await away(rook1)
    await clock.tick(60_000)
    await mikaClock.tick(60_000)
    const mika1 = await messenger(createMemoryNetwork(), 'mika', {
      clock: mikaClock,
      lighthouse,
      store: mika0.store,
    })
    await flush(400)
    await mika1.messenger.removeDevice(fakeSigner('mika-phone').id)
    await flush(400)
    await mika1.messenger.checkMail()
    await flush(400)
    const mikas = only(mika1.messenger.friends()).secret ?? ''
    await away(mika1)
    expect(new Set([pair, rooks, mikas]).size).toBe(3)

    // Back together.
    lighthouse.down(false)
    const shared = createMemoryNetwork()
    const rook = await messenger(shared, 'rook', { clock, lighthouse, store: laptop0.store })
    const mika = await messenger(shared, 'mika', {
      clock: mikaClock,
      lighthouse,
      store: mika0.store,
    })
    await flush(400)
    await checkAll([rook, mika], 4)
    const onRook = only(rook.messenger.friends())
    const end = onRook.secret ?? ''
    expect(only(mika.messenger.friends()).secret).toBe(end)
    expect(onRook.renew).toBeUndefined()
    // Neither removed phone can open any letter that names the secret both ended on, though
    // each was sealed the other side's first round, made before that side heard.
    const seen = new Set<string>()
    for (const secret of [pair, rooks, mikas, end])
      for (const to of [rook.messenger.self, mika.messenger.self])
        for (const phone of ['rook-phone', 'mika-phone'])
          for (const found of (await rekeysFor(lighthouse, secret, to, phone)).secrets)
            seen.add(found)
    expect(seen.has(mikas) || seen.has(rooks)).toBe(true)
    expect(seen.has(end)).toBe(false)
    expect(network.occupants(await today(end))).toBe(0)
    expect(shared.occupants(await today(end))).toBe(2)
  })

  it('still finishes a fetch that brings two removals, with a request waiting', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const laptop = await messenger(network, 'rook', { clock, lighthouse })
    await laptop.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
    const { device: tablet } = await linkDevice(network, laptop, 'rook-tablet', clock, lighthouse)
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock, lighthouse)
    const { device: watch } = await linkDevice(network, laptop, 'rook-watch', clock, lighthouse)
    await flush(400)
    await checkAll([laptop, tablet, phone, watch], 1)
    const made = await tablet.messenger.makeInviteLink({ lifetime: 24 * HOUR, uses: 1 })
    if (!made.ok) throw new Error(made.error)
    const stranger = await messenger(network, 'stranger', { clock, lighthouse })
    await stranger.messenger.setProfile({ handle: 'Stranger', status: 'online', message: '' })
    const opened = await stranger.messenger.openInviteLink(made.link.url)
    if (!opened.ok) throw new Error(opened.error)
    expect(await stranger.messenger.askThroughLink(opened)).toBe('sent')
    await tablet.messenger.checkMail()
    await flush(400)
    expect(only(only(tablet.messenger.inviteLinks()).requests).state).toBe('waiting')
    // The tablet is away while the laptop removes two devices, one after the other.
    await away(tablet)
    for (const gone of [phone, watch]) {
      await laptop.messenger.removeDevice(gone.messenger.device)
      await flush(400)
      await laptop.messenger.checkMail()
      await flush(400)
    }
    // The tablet comes back and learns both in one fetch: the fetch still ends.
    const back = await messenger(createMemoryNetwork(), 'rook-tablet', {
      clock,
      lighthouse,
      store: tablet.store,
    })
    const timeout = new Promise<'stuck'>((resolve) => setTimeout(() => resolve('stuck'), 3000))
    const done = back.messenger.checkMail().then(() => 'done' as const)
    for (let i = 0; i < 20; i++) await flush(200)
    expect(await Promise.race([done, timeout])).toBe('done')
    await flush(800)
    // Nothing is closed on a removal: the tablet's own link still waits for it.
    expect(only(back.messenger.inviteLinks())).toMatchObject({ open: true })
    expect(only(only(back.messenger.inviteLinks()).requests).state).toBe('waiting')
  })

  it('acts on a removal kept in the log before the tab closed', async () => {
    const { lighthouse, clock, network, laptop, mika, phone, pair } = await rookAndMika()
    const made = await laptop.messenger.makeInviteLink({ lifetime: 24 * HOUR, uses: 1 })
    if (!made.ok) throw new Error(made.error)
    await flush(400)
    await laptop.messenger.close()
    await flush()
    // The removal was kept, and nothing after it: as if the tab closed right then.
    const removing = await loadDevices({
      crypto: fakeCrypto,
      signer: fakeSigner('rook'),
      store: laptop.store,
      clock,
    })
    expect(await removing.change('remove', phone.messenger.device)).toBe(true)
    const back = await messenger(network, 'rook', { clock, lighthouse, store: laptop.store })
    await flush(400)
    await checkAll([back, mika])
    expect(only(back.messenger.friends()).secret).not.toBe(pair)
    expect(only(mika.messenger.friends()).secret).toBe(only(back.messenger.friends()).secret)
    // Its own link stays open: a removal closes no link.
    expect(only(back.messenger.inviteLinks()).open).toBe(true)
  })

  it('replaces them after a recovery leaves the other devices off', async () => {
    const { network, lighthouse, laptop, mika, phone, tablet, pair, own } = await rookAndMika()
    const key = fakeSigner('rook-recovery-1')
    expect(await laptop.messenger.commitRecoveryKey(key.id)).toBe(true)
    await flush(400)
    await checkAll([laptop, phone, tablet, mika], 1)
    // The laptop is stolen. On the phone, the recovery key makes it the writer, alone.
    await away(tablet)
    expect(await phone.messenger.recoverHere(key, false, fakeSigner('rook-recovery-2').id)).toBe(
      true,
    )
    await flush(400)
    await phone.messenger.checkMail()
    await flush(400)
    expect((await rekeysFor(lighthouse, pair, mika.messenger.self, 'mika')).opened).toBeGreaterThan(
      0,
    )
    for (const name of ['rook', 'rook-tablet'])
      expect((await rekeysFor(lighthouse, pair, mika.messenger.self, name)).opened).toBe(0)
    await checkAll([phone, mika])
    const onPhone = only(phone.messenger.friends())
    expect(onPhone.secret).not.toBe(pair)
    expect(only(mika.messenger.friends()).secret).toBe(onPhone.secret)
    // Every other device is gone: a new self secret kept on the phone alone.
    expect(await phone.store.get('selfSecret')).not.toBe(own)
    expect(laptop.messenger.deviceStatus()).toBe('removed')
    expect(only(laptop.messenger.friends()).secret).toBe(pair)
    expect(network.occupants(await today(onPhone.secret ?? ''))).toBe(2)
  })

  it('keeps chatting with a friend whose Pigeon looks for no mail, and moves once it does', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const laptop = await messenger(network, 'rook', { clock, lighthouse })
    const mika0 = await messenger(network, 'mika', { clock, lighthouse })
    await pairWith(laptop, mika0)
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock, lighthouse)
    await flush(400)
    const pair = only(mika0.messenger.friends()).secret ?? ''
    await mika0.messenger.close()
    // Mika's Pigeon doesn't look for mail of this kind: here, it looks for none at all.
    const mika = await messenger(network, 'mika', { clock, store: mika0.store })
    await flush(400)
    await laptop.messenger.removeDevice(phone.messenger.device)
    await flush(400)
    await checkAll([laptop])
    const onLaptop = only(laptop.messenger.friends())
    expect(onLaptop.secret).not.toBe(pair)
    expect(onLaptop.replacing?.heardAt).toBeUndefined()
    // The laptop waits in both rooms, so Mika, still in the old one, hears it as before.
    expect(network.occupants(await today(pair))).toBe(2)
    expect(only(mika.messenger.friends()).secret).toBe(pair)
    await laptop.messenger.send(onLaptop.id, 'still here')
    await flush()
    expect(only(mika.messenger.friends()).log.entries.at(-1)?.text).toBe('still here')

    // Mika's Pigeon updates: it finds the new round waiting under the old secret and moves.
    await mika.messenger.close()
    await flush()
    const updated = await messenger(network, 'mika', { clock, lighthouse, store: mika0.store })
    await flush(400)
    await checkAll([updated, laptop])
    expect(only(updated.messenger.friends()).secret).toBe(onLaptop.secret)
    expect(network.occupants(await today(pair))).toBe(0)
    expect(network.occupants(await today(onLaptop.secret ?? ''))).toBe(2)
  })

  it('sends the round again to a friend whose Pigeon took it unread, once it’s met there', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const laptop = await messenger(network, 'rook', { clock, lighthouse })
    const mika = await messenger(network, 'mika', { clock, lighthouse })
    await pairWith(laptop, mika)
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock, lighthouse)
    await flush(400)
    const pair = only(mika.messenger.friends()).secret ?? ''
    await laptop.messenger.removeDevice(phone.messenger.device)
    await flush(400)
    await laptop.messenger.checkMail()
    await flush(400)
    // Mika's Pigeon takes the letter, makes nothing of it, and gives its receipt.
    unread.on = true
    await mika.messenger.checkMail()
    await flush(400)
    delete unread.on
    await laptop.messenger.checkMail()
    await flush(400)
    expect(only(mika.messenger.friends()).secret).toBe(pair)
    await mika.messenger.checkMail()
    await flush(400)
    expect(only(mika.messenger.friends()).secret).toBe(pair)

    // It updates, and meets the laptop in the old room: the laptop sends the round again.
    await mika.messenger.close()
    await flush()
    const updated = await messenger(network, 'mika', { clock, lighthouse, store: mika.store })
    await flush(800)
    await checkAll([updated, laptop])
    const secret = only(laptop.messenger.friends()).secret
    expect(secret).not.toBe(pair)
    expect(only(updated.messenger.friends()).secret).toBe(secret)
    expect(network.occupants(await today(pair))).toBe(0)
  })

  it('sends the round again only once, however often it starts and meets them', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const laptop = await messenger(network, 'rook', { clock, lighthouse })
    const mika = await messenger(network, 'mika', { clock, lighthouse })
    await pairWith(laptop, mika)
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock, lighthouse)
    await flush(400)
    const mikaId = mika.messenger.self
    await laptop.messenger.removeDevice(phone.messenger.device)
    await flush(400)
    await laptop.messenger.checkMail()
    await flush(400)
    // Mika's Pigeon takes every letter it's sent and makes nothing of it.
    const rekeysWaiting = async () =>
      (
        ((await laptop.store.get('mail-outbox')) ?? []) as {
          kind: string
          to: { identity: string }
        }[]
      ).filter((letter) => letter.kind === 'rekey' && letter.to.identity === mikaId).length
    const takeUnread = async (rook: Side) => {
      unread.on = true
      await mika.messenger.checkMail()
      await flush(400)
      delete unread.on
      await rook.messenger.checkMail()
      await flush(400)
    }
    await takeUnread(laptop)
    expect(await rekeysWaiting()).toBe(0)
    // The laptop starts while the Lighthouse is down: it meets Mika, but nothing is put, so
    // nothing is marked as sent.
    lighthouse.down(true)
    await laptop.messenger.close()
    await flush()
    let rook = await messenger(network, 'rook', { clock, lighthouse, store: laptop.store })
    await flush(800)
    expect(only(rook.messenger.friends()).replacing?.resent).toBeUndefined()
    lighthouse.down(false)
    // Each time the laptop starts it meets Mika in the old room. Only the first sends again.
    const sent: number[] = []
    for (let start = 0; start < 3; start++) {
      await rook.messenger.close()
      await flush()
      rook = await messenger(network, 'rook', { clock, lighthouse, store: laptop.store })
      await flush(800)
      sent.push(await rekeysWaiting())
      await takeUnread(rook)
    }
    expect(only(rook.messenger.friends()).replacing?.resent).toEqual([mika.messenger.device])
    expect(sent[0]).toBeGreaterThan(0)
    expect(sent.slice(1)).toEqual([0, 0])

    // Another of Mika's devices on the same Pigeon turns up in the old room: it's sent one too.
    unread.on = true
    const { device: tablet } = await linkDevice(network, mika, 'mika-tablet', clock, lighthouse)
    await flush(800)
    delete unread.on
    await rook.messenger.checkMail()
    await flush(400)
    await rook.messenger.close()
    await flush()
    rook = await messenger(network, 'rook', { clock, lighthouse, store: laptop.store })
    await flush(800)
    expect(only(rook.messenger.friends()).replacing?.resent).toEqual([
      mika.messenger.device,
      tablet.messenger.device,
    ])
  })

  it('replaces the pair secret of a friend added from a file', async () => {
    const network = createMemoryNetwork()
    const clock = fakeClock(NOON)
    const lighthouse = testLighthouse(clock)
    const laptop = await messenger(network, 'rook', { clock, lighthouse })
    const mika = await messenger(network, 'mika', { clock, lighthouse })
    await pairWith(laptop, mika)
    await flush(400)
    const pair = only(mika.messenger.friends()).secret ?? ''
    const data = JSON.parse(JSON.stringify(laptop.messenger.exportData())) as unknown
    // A new browser for the same Rook, with nobody on it yet, takes in the file.
    const store = createMemoryStore()
    for (const key of ['self', 'deviceLog', 'selfSecret', 'selfSecretState'])
      await store.set(key, await laptop.store.get(key))
    await laptop.messenger.close()
    laptop.transport.disconnect()
    const here = await messenger(network, 'rook', { clock, lighthouse, store })
    expect(await here.messenger.importData(data)).toBe('imported')
    await here.messenger.close()
    expect((await store.get('friends')) as unknown[]).toMatchObject([{ secret: pair, renew: true }])
    const again = await messenger(network, 'rook', { clock, lighthouse, store })
    await flush(400)
    await checkAll([again, mika])
    const secret = only(again.messenger.friends()).secret
    expect(secret).not.toBe(pair)
    expect(only(mika.messenger.friends()).secret).toBe(secret)
    expect(only(again.messenger.friends()).renew).toBeUndefined()
  })

  it('keeps the rounds a friend from a file was replacing in', async () => {
    const network = createMemoryNetwork()
    const { a: rook } = await pair(network)
    const data = JSON.parse(JSON.stringify(rook.messenger.exportData())) as Record<string, unknown>
    const [mika] = data['friends'] as Record<string, unknown>[]
    const secret = mika?.['secret'] as string
    const round = { old: secret, at: NOON, by: mika?.['id'], sig: 'c2ln' }
    const rounds = { replacing: round, prior: { ...round, at: NOON - 1 }, begun: secret }
    const fresh = await messenger(createMemoryNetwork(), 'rook')
    expect(await fresh.messenger.importData({ ...data, friends: [{ ...mika, ...rounds }] })).toBe(
      'imported',
    )
    expect((await fresh.store.get('friends')) as unknown[]).toMatchObject([
      { ...rounds, renew: true },
    ])
  })
})

/** Rook and Mika, friends, with Rook's Lighthouse requests counted and a wake that Rook obeys. */
async function watched() {
  const clock = fakeClock(NOON)
  const real = testLighthouse(clock)
  const requests = { lists: 0, now: 0, most: 0 }
  const lighthouse: TestLighthouse = {
    ...real,
    client: (address) => {
      const client = real.client(address)
      return {
        ...client,
        async request(request) {
          if (request.type !== 'list') return client.request(request)
          requests.lists += 1
          requests.now += 1
          requests.most = Math.max(requests.most, requests.now)
          try {
            return await client.request(request)
          } finally {
            requests.now -= 1
          }
        },
      }
    },
  }
  const listeners = new Set<() => void>()
  const wake: Wake = {
    on(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
  const network = createMemoryNetwork()
  const rook = await messenger(network, 'rook', { clock, wake, lighthouse })
  const mika = await messenger(network, 'mika', { clock, lighthouse: real })
  await pairWith(rook, mika)
  await flush(400)
  // What one look at the Lighthouse asks, so counts can be read as numbers of looks.
  const before = requests.lists
  await rook.messenger.checkMail()
  const perLook = requests.lists - before
  expect(perLook).toBeGreaterThan(0)
  // Past the least gap, so each test starts with a look that may go at once.
  await clock.tick(MAIL_MIN_GAP_MS)
  await flush(400)
  requests.lists = 0
  requests.most = 0
  const wakeUp = () => {
    for (const listener of [...listeners]) listener()
  }
  const looks = () => requests.lists / perLook
  return { clock, rook, mika, requests, wakeUp, looks, listeners }
}

describe('looking for mail when you come back', () => {
  it('looks when the browser says you are back, and hears what waited', async () => {
    const { clock, rook, mika, wakeUp, looks } = await watched()
    // Mika writes while Rook's Pigeon isn't listening; Rook only hears it from the Lighthouse.
    rook.transport.disconnect()
    mika.transport.disconnect()
    await flush()
    const id = only(mika.messenger.friends()).id
    await mika.messenger.send(id, 'are you there?')
    await clock.tick(MAIL_AFTER_SEND_MS + 1000)
    await flush(400)
    // (Mika looked, not Rook: Rook hears nothing until it is woken.)
    const heard = () => only(rook.messenger.friends()).log.entries.length
    const before = heard()
    expect(looks()).toBe(0)
    wakeUp()
    await flush(400)
    expect(looks()).toBe(1)
    expect(heard()).toBeGreaterThan(before)
  })

  it('looks once for a burst of events, then waits out the gap', async () => {
    const { clock, wakeUp, looks } = await watched()
    wakeUp()
    wakeUp()
    wakeUp()
    await flush(400)
    expect(looks()).toBe(1)
    // Asked again at once, it goes after the gap, and as one look however often it was asked.
    wakeUp()
    wakeUp()
    await flush(400)
    await clock.tick(MAIL_MIN_GAP_MS - 1)
    await flush(400)
    expect(looks()).toBe(1)
    await clock.tick(1)
    await flush(400)
    expect(looks()).toBe(2)
    await clock.tick(MAIL_MIN_GAP_MS * 3)
    await flush(400)
    expect(looks()).toBe(2)
  })

  it('never looks twice at once, and looks again after the one in progress', async () => {
    const { clock, rook, requests, wakeUp, looks } = await watched()
    const running = rook.messenger.checkMail()
    wakeUp()
    await running
    await flush(400)
    expect(looks()).toBe(1)
    await clock.tick(MAIL_MIN_GAP_MS)
    await flush(400)
    expect(looks()).toBe(2)
    expect(requests.most).toBe(1)
  })

  it('looks soon after you send something, not at once', async () => {
    const { clock, rook, mika, looks } = await watched()
    const id = only(rook.messenger.friends()).id
    await rook.messenger.send(id, 'on my way')
    await flush(400)
    expect(looks()).toBe(0)
    await clock.tick(MAIL_AFTER_SEND_MS - 1)
    await flush(400)
    expect(looks()).toBe(0)
    await clock.tick(1)
    await flush(400)
    expect(looks()).toBe(1)
    // Several in a row are one look.
    await clock.tick(MAIL_MIN_GAP_MS)
    for (const text of ['a', 'b', 'c']) await rook.messenger.send(id, text)
    await clock.tick(MAIL_AFTER_SEND_MS)
    await flush(400)
    expect(looks()).toBe(2)
    expect(mika.messenger.friends()).toHaveLength(1)
  })

  it('still looks on its own every ten minutes', async () => {
    const { clock, looks } = await watched()
    await clock.tick(MAIL_EVERY_MS)
    await flush(400)
    expect(looks()).toBe(1)
  })

  it('Check Now looks at once, says when it last looked, and keeps the gap', async () => {
    const { clock, rook, looks } = await watched()
    // Starting looked once already, so there is a time to show.
    const first = rook.messenger.mailLook()
    expect(first.state).toBe('idle')
    expect(first.at).toBeDefined()
    // Past the gap: it goes at once, and the time moves to when it finished.
    expect(rook.messenger.checkNow()).toBe(0)
    await flush(400)
    expect(looks()).toBe(1)
    expect(rook.messenger.mailLook()).toEqual({ at: clock.now(), state: 'idle' })
    // Again within the gap: it waits for what is left of it, says so, and looks once.
    await clock.tick(2000)
    expect(rook.messenger.checkNow()).toBe(MAIL_MIN_GAP_MS - 2000)
    expect(rook.messenger.checkNow()).toBe(MAIL_MIN_GAP_MS - 2000)
    expect(rook.messenger.mailLook().state).toBe('waiting')
    await flush(400)
    expect(looks()).toBe(1)
    await clock.tick(MAIL_MIN_GAP_MS - 2000)
    await flush(400)
    expect(looks()).toBe(2)
    expect(rook.messenger.mailLook()).toEqual({ at: clock.now(), state: 'idle' })
  })

  it('Check Now never runs two looks at once', async () => {
    const { clock, rook, requests, looks } = await watched()
    const running = rook.messenger.checkMail()
    expect(rook.messenger.mailLook().state).toBe('checking')
    rook.messenger.checkNow()
    await running
    await clock.tick(MAIL_MIN_GAP_MS)
    await flush(400)
    expect(looks()).toBe(2)
    expect(requests.most).toBe(1)
  })

  it('stops listening when the Messenger closes', async () => {
    const { rook, wakeUp, looks, listeners } = await watched()
    expect(listeners.size).toBe(1)
    await rook.messenger.close()
    expect(listeners.size).toBe(0)
    wakeUp()
    await flush(400)
    expect(looks()).toBe(0)
  })
})
