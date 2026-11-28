import { describe, expect, it } from 'vitest'
import { emptyDeviceLog } from '../devices/device-log.ts'
import { utf8Decode } from '../encoding/bytes.ts'
import type { Signer } from '../identity/crypto.ts'
import { pairRoom } from '../identity/identity.ts'
import type { LighthouseAddress } from '../lighthouse/address.ts'
import { bindSealingKey, type SealingKey } from '../mail/mail.ts'
import { type Body, openEnvelope, sealEnvelope } from '../messages/envelope.ts'
import {
  createMemoryNetwork,
  fakeCrypto,
  fakeSealCrypto,
  fakeSigner,
  flush,
} from '../testing/testing.ts'
import type { Room, Transport } from '../transport/transport.ts'
import { appendMessage, type ChatLog, emptyLog } from './chat-log.ts'
import { type PairEvent, type PairSession, startPairSession } from './pair-session.ts'

const rook = fakeSigner('rook')
const mika = fakeSigner('mika')
const { random } = fakeSealCrypto(7)

interface Side {
  session: PairSession
  events: PairEvent[]
  log: () => ChatLog
}

async function open(
  transport: Transport,
  self: Signer,
  friend: Signer,
  log?: ChatLog,
  avatar?: () => number,
  handle?: () => string,
) {
  const name = await pairRoom(fakeCrypto, self.id, friend.id)
  const events: PairEvent[] = []
  let current = log ?? emptyLog(name)
  const session = startPairSession({
    crypto: fakeCrypto,
    signer: self,
    friend: friend.id,
    chat: name,
    rooms: [await transport.join(name)],
    handle: handle ?? (() => (self === rook ? 'Rook' : 'Mika')),
    presence: () => ({ status: 'online', message: '' }),
    ...(avatar === undefined ? {} : { avatar }),
    log: current,
    now: () => 1,
    random,
    onEvent: (event) => {
      events.push(event)
      if (event.type === 'log') current = event.log
    },
  })
  const side: Side = { session, events, log: () => current }
  return side
}

const texts = (log: ChatLog) => log.entries.map((entry) => entry.text)
const kinds = (side: Side) =>
  side.events.map((event) => event.type).filter((t) => t !== 'log' && t !== 'met')

describe('pair sessions', () => {
  it('tells the friend when you remove them', async () => {
    const network = createMemoryNetwork()
    const a = await open(network.transport(), rook, mika)
    const b = await open(network.transport(), mika, rook)
    await flush()
    await a.session.unfriend()
    await flush()
    expect(kinds(b)).toContain('unfriended')
  })

  it('tells the friend which version your bird is drawn with', async () => {
    const network = createMemoryNetwork()
    const a = await open(network.transport(), rook, mika)
    await open(network.transport(), mika, rook, undefined, () => 2)
    await flush()
    expect(a.events[0]).toEqual({ type: 'online', handle: 'Mika', avatar: 2, current: true })
  })

  it('hears a device’s own signed sealing key and its Lighthouses, and no one else’s', async () => {
    const network = createMemoryNetwork()
    const seal = fakeSealCrypto()
    const name = await pairRoom(fakeCrypto, rook.id, mika.id)
    const lighthouse: LighthouseAddress = {
      id: fakeSigner('lighthouse').id,
      name: 'Lighthouse',
      url: 'wss://lighthouse.example/',
    }
    const start = async (self: Signer, friend: Signer, sealing: () => SealingKey | undefined) => {
      const events: PairEvent[] = []
      startPairSession({
        crypto: fakeCrypto,
        signer: self,
        friend: friend.id,
        chat: name,
        rooms: [await network.transport().join(name)],
        handle: () => 'Someone',
        presence: () => ({ status: 'online', message: '' }),
        log: emptyLog(name),
        now: () => 1,
        random,
        sealing,
        lighthouses: () => [lighthouse],
        onEvent: (event) => events.push(event),
      })
      return events
    }
    const rookKey = await bindSealingKey(rook, seal.sealer('rook'))
    const mikaEvents = await start(mika, rook, () => undefined)
    await start(rook, mika, () => rookKey)
    await flush()
    expect(mikaEvents).toContainEqual({
      type: 'keys',
      device: rook.id,
      sealing: rookKey,
      lighthouses: [lighthouse],
    })

    // Rook hands out a key bound to some other device: it's dropped, the Lighthouses still heard.
    const other = await bindSealingKey(fakeSigner('elsewhere'), seal.sealer('elsewhere'))
    const network2Events = await start(mika, rook, () => undefined)
    await start(rook, mika, () => other)
    await flush()
    expect(network2Events.filter((event) => event.type === 'keys').at(-1)).toEqual({
      type: 'keys',
      device: rook.id,
      lighthouses: [lighthouse],
    })
  })

  it('hears a new handle from a friend who is already online', async () => {
    const network = createMemoryNetwork()
    const a = await open(network.transport(), rook, mika)
    let name = 'Mika'
    const b = await open(network.transport(), mika, rook, undefined, undefined, () => name)
    await flush()
    name = 'Mika M.'
    b.session.announce()
    await flush()
    expect(a.events).toContainEqual({ type: 'renamed', handle: 'Mika M.' })
    // Presence alone, or the same handle again, isn't a rename.
    b.session.announce()
    await flush()
    expect(a.events.filter((event) => event.type === 'renamed')).toHaveLength(1)
  })

  it('sees each other come online, chat, type, buzz and go offline', async () => {
    const network = createMemoryNetwork()
    const a = await open(network.transport(), rook, mika)
    const mikaTransport = network.transport()
    const b = await open(mikaTransport, mika, rook)
    await flush()
    expect(a.events[0]).toEqual({ type: 'online', handle: 'Mika', avatar: 1, current: true })
    expect(b.events[0]).toEqual({ type: 'online', handle: 'Rook', avatar: 1, current: true })
    expect(a.session.online()).toBe(true)

    await a.session.send('hi Mika')
    b.session.typing(true)
    b.session.buzz()
    await flush()
    await b.session.send('hey')
    await flush()
    expect(texts(a.log())).toEqual(['hi Mika', 'hey'])
    expect(texts(b.log())).toEqual(['hi Mika', 'hey'])
    expect(a.events).toContainEqual({ type: 'typing', active: true })
    expect(kinds(a)).toContain('buzz')

    mikaTransport.disconnect()
    await flush()
    expect(a.events.at(-1)).toEqual({ type: 'offline' })
    expect(a.session.online()).toBe(false)
  })

  it('catches up on what was written while apart', async () => {
    const network = createMemoryNetwork()
    const name = await pairRoom(fakeCrypto, rook.id, mika.id)
    let rookLog = emptyLog(name)
    for (const text of ['one', 'two']) rookLog = (await appendMessage(rookLog, rook, text, 0)).log
    let mikaLog = emptyLog(name)
    mikaLog = (await appendMessage(mikaLog, mika, 'uno', 0)).log

    const a = await open(network.transport(), rook, mika, rookLog)
    const b = await open(network.transport(), mika, rook, mikaLog)
    await flush()
    expect(a.log().entries).toEqual(b.log().entries)
    expect(texts(a.log()).sort()).toEqual(['one', 'two', 'uno'])
  })

  it('ignores a stranger in the room', async () => {
    const network = createMemoryNetwork()
    const a = await open(network.transport(), rook, mika)
    // Eve claims to be Mika in Rook and Mika's room; her envelopes are signed as Eve.
    const name = await pairRoom(fakeCrypto, rook.id, mika.id)
    const eve = startPairSession({
      crypto: fakeCrypto,
      signer: fakeSigner('eve'),
      friend: rook.id,
      chat: name,
      rooms: [await network.transport().join(name)],
      handle: () => 'Mika',
      presence: () => ({ status: 'online', message: '' }),
      log: emptyLog(name),
      now: () => 1,
      random,
      onEvent: () => undefined,
    })
    await flush()
    eve.buzz()
    await eve.send('it is me, Mika')
    await flush()
    expect(a.events).toEqual([])
  })
})

describe('goodbye', () => {
  it('shows the friend offline at once, and a new hello brings them back', async () => {
    const network = createMemoryNetwork()
    const a = await open(network.transport(), rook, mika)
    const b = await open(network.transport(), mika, rook)
    await flush()
    expect(a.session.online()).toBe(true)

    b.session.goodbye()
    await flush()
    expect(a.session.online()).toBe(false)
    expect(a.events.at(-1)).toEqual({ type: 'offline' })

    b.session.announce()
    await flush()
    expect(a.session.online()).toBe(true)
  })
})

/** Comings and goings only. */
const presence = (side: Side) =>
  kinds(side).filter((kind) => kind === 'online' || kind === 'offline')

describe('several rooms', () => {
  it('is one friend across rooms, and offline only once every room is left', async () => {
    const network = createMemoryNetwork()
    const rookTransport = network.transport()
    const a = await open(rookTransport, rook, mika)
    const b = await open(network.transport(), mika, rook)
    a.session.addRoom(await rookTransport.join('pair:today', { password: 'p' }))
    b.session.addRoom(await network.transport().join('pair:today', { password: 'p' }))
    await flush()
    expect(presence(a)).toEqual(['online'])
    expect(a.events.filter((event) => event.type === 'met')).toHaveLength(2)

    const first = await pairRoom(fakeCrypto, rook.id, mika.id)
    await b.session.removeRoom(first)
    await flush()
    expect(a.session.online()).toBe(true)
    await b.session.send('still here')
    await flush()
    expect(texts(a.log())).toEqual(['still here'])

    await b.session.removeRoom('pair:today')
    await flush()
    expect(presence(a)).toEqual(['online', 'offline'])
    expect(b.session.rooms()).toEqual([])
  })

  it('says nothing when it closes', async () => {
    const network = createMemoryNetwork()
    const a = await open(network.transport(), rook, mika)
    await open(network.transport(), mika, rook)
    await flush()
    await a.session.close()
    await flush()
    expect(presence(a)).toEqual(['online'])
  })
})

describe('several devices', () => {
  const mikaPhone = fakeSigner('mika-phone')
  const rookPhone = fakeSigner('rook-phone')

  async function device(
    transport: Transport,
    self: Signer,
    identity: Signer,
    friend: Signer,
    friendDevices: readonly string[],
    ownDevices: readonly string[],
  ) {
    const name = await pairRoom(fakeCrypto, identity.id, friend.id)
    const events: PairEvent[] = []
    let current = emptyLog(name)
    const logsSeen: unknown[] = []
    const session = startPairSession({
      crypto: fakeCrypto,
      signer: self,
      friend: friend.id,
      chat: name,
      rooms: [await transport.join(name)],
      handle: () => (identity === rook ? 'Rook' : 'Mika'),
      presence: () => ({ status: 'online', message: '' }),
      log: current,
      now: () => 1,
      random,
      onEvent: (event) => {
        events.push(event)
        if (event.type === 'log') current = event.log
      },
      accepts: (id) =>
        friendDevices.includes(id) ? 'friend' : ownDevices.includes(id) ? 'self' : undefined,
      authors: () => new Set([...friendDevices, ...ownDevices, self.id]),
      onDeviceLog: async (log) => void logsSeen.push(log),
    })
    return { session, events, log: () => current, logsSeen }
  }

  it('takes any of the friend’s devices as the friend, and catches your own devices up', async () => {
    const network = createMemoryNetwork()
    const rookLaptop = await device(
      network.transport(),
      rook,
      rook,
      mika,
      [mika.id, mikaPhone.id],
      [rookPhone.id],
    )
    const mikasPhone = await device(
      network.transport(),
      mikaPhone,
      mika,
      rook,
      [rook.id, rookPhone.id],
      [mika.id],
    )
    await flush()
    expect(rookLaptop.events[0]).toMatchObject({ type: 'online', handle: 'Mika' })
    await mikasPhone.session.send('from my phone')
    await flush()
    expect(texts(rookLaptop.log())).toEqual(['from my phone'])

    // Rook's phone joins later and catches up from his laptop as well as from Mika.
    const rooksPhone = await device(
      network.transport(),
      rookPhone,
      rook,
      mika,
      [mika.id, mikaPhone.id],
      [rook.id],
    )
    await flush()
    expect(texts(rooksPhone.log())).toEqual(['from my phone'])
    // His laptop isn't a friend to his phone: one online, from Mika's phone.
    expect(presence(rooksPhone)).toEqual(['online'])
  })

  it('ignores a device that isn’t on the friend’s list', async () => {
    const network = createMemoryNetwork()
    const rookLaptop = await device(network.transport(), rook, rook, mika, [mika.id], [])
    const stranger = await device(network.transport(), mikaPhone, mika, rook, [rook.id], [])
    await flush()
    await stranger.session.send('hi, it is Mika')
    await flush()
    expect(rookLaptop.events).toEqual([])
  })
})

describe('a copied profile', () => {
  async function run(transport: Transport, instance: string, twins: string[]) {
    const name = await pairRoom(fakeCrypto, rook.id, mika.id)
    return startPairSession({
      crypto: fakeCrypto,
      signer: rook,
      friend: mika.id,
      chat: name,
      rooms: [await transport.join(name)],
      handle: () => 'Rook',
      presence: () => ({ status: 'online', message: '' }),
      log: emptyLog(name),
      now: () => 1,
      random,
      onEvent: () => undefined,
      instance,
      onTwin: () => twins.push(instance),
    })
  }

  it('notices its own key in another run, on both sides', async () => {
    const network = createMemoryNetwork()
    const twins: string[] = []
    await run(network.transport(), 'aaaaaaaa', twins)
    await run(network.transport(), 'bbbbbbbb', twins)
    await flush()
    expect([...new Set(twins)].sort()).toEqual(['aaaaaaaa', 'bbbbbbbb'])
  })

  it('says nothing about a friend, or the same run', async () => {
    const network = createMemoryNetwork()
    const twins: string[] = []
    await run(network.transport(), 'aaaaaaaa', twins)
    await run(network.transport(), 'aaaaaaaa', twins)
    await open(network.transport(), mika, rook)
    await flush()
    expect(twins).toEqual([])
  })
})

describe('a relay in the room', () => {
  /** One side of a chat between Rook and Mika, talking in `room`. */
  async function side(room: Room, self: Signer, friend: Signer, instance?: string) {
    const chat = await pairRoom(fakeCrypto, rook.id, mika.id)
    const events: PairEvent[] = []
    let current = emptyLog(chat)
    const twins: string[] = []
    const session = startPairSession({
      crypto: fakeCrypto,
      signer: self,
      friend: friend.id,
      chat,
      rooms: [room],
      handle: () => (self === rook ? 'Rook' : 'Mika'),
      presence: () => ({ status: 'online', message: '' }),
      log: current,
      now: () => 1,
      random,
      onEvent: (event) => {
        events.push(event)
        if (event.type === 'log') current = event.log
      },
      ...(instance === undefined ? {} : { instance, onTwin: () => twins.push(instance) }),
    })
    return { session, events, log: () => current, twins }
  }

  /** What each of Eve's connections sent her, opened. */
  async function bodies(heard: readonly { from: string; bytes: Uint8Array }[], from: string) {
    const chat = await pairRoom(fakeCrypto, rook.id, mika.id)
    const out: Body[] = []
    for (const message of heard.filter((m) => m.from === from)) {
      const opened = await openEnvelope(fakeCrypto, chat, message.bytes)
      if (opened.ok) out.push(opened.value.body)
    }
    return out
  }

  it('ignores a hello forwarded from another connection, so a relay never gets the chat', async () => {
    // Rook and Mika never meet directly: each is in a room alone with Eve, who knows both
    // rooms and passes every message between them, both ways, with one certificate for both.
    const network = createMemoryNetwork()
    const eve = network.transport('e'.repeat(64))
    const rookRoom = await eve.join('pair:rook-side')
    const mikaRoom = await eve.join('pair:mika-side')
    const heard: { from: string; bytes: Uint8Array }[] = []
    const relay = (here: Room, there: Room) =>
      here.onMessage((_from, bytes) => {
        heard.push({ from: `${here.name}`, bytes })
        for (const peer of there.peers()) there.send(peer, bytes)
      })
    relay(rookRoom, mikaRoom)
    relay(mikaRoom, rookRoom)

    const a = await side(await network.transport().join('pair:rook-side'), rook, mika)
    const b = await side(await network.transport().join('pair:mika-side'), mika, rook)
    await flush()
    // Each did say hello through Eve, signed for Eve's channel, not the one it reached.
    expect((await bodies(heard, 'pair:mika-side')).map((body) => body.type)).toContain('hello')
    expect(a.session.online()).toBe(false)
    expect(b.session.online()).toBe(false)

    await a.session.send('secret plans')
    await flush()
    const leaked = (await bodies(heard, 'pair:rook-side')).filter(
      (body) => body.type === 'log-entries',
    )
    expect(leaked).toEqual([])
    expect(texts(b.log())).toEqual([])
    expect(kinds(a)).toEqual([])
    expect(kinds(b)).toEqual([])
  })

  it('ignores a replayed unfriend, hello and buzz, and the real session goes on', async () => {
    const network = createMemoryNetwork()
    const chat = await pairRoom(fakeCrypto, rook.id, mika.id)
    const a = await side(await network.transport().join(chat), rook, mika)
    const b = await side(await network.transport().join(chat), mika, rook)
    await flush()
    expect(a.session.online()).toBe(true)
    const heardBefore = [kinds(a), kinds(b)]

    // Eve joins with envelopes of Mika's she kept: as sent before binding, and a hello
    // bound to another channel. Her own connection gets Rook's nonce like any other.
    const eveRoom = await network.transport().join(chat)
    const nonces: string[] = []
    eveRoom.onMessage(async (_from, bytes) => {
      const opened = await openEnvelope(fakeCrypto, chat, bytes)
      if (opened.ok && opened.value.body.type === 'nonce') nonces.push(opened.value.body.nonce)
    })
    await flush()
    const kept: Body[] = [
      { type: 'hello', handle: 'Mika' },
      {
        type: 'hello',
        handle: 'Mika',
        binding: { nonce: nonces[0] ?? '', local: 'a'.repeat(64), remote: 'b'.repeat(64) },
      },
      { type: 'unfriend' },
      { type: 'buzz' },
      { type: 'log-sync', have: {} },
    ]
    for (const peer of eveRoom.peers())
      for (const body of kept) eveRoom.send(peer, await sealEnvelope(mika, chat, 1, body))
    await flush()
    expect([kinds(a), kinds(b)]).toEqual(heardBefore)

    await a.session.send('still here')
    await b.session.send('me too')
    await flush()
    expect(texts(a.log()).sort()).toEqual(['me too', 'still here'])
    expect(texts(b.log()).sort()).toEqual(['me too', 'still here'])
  })

  it('greets a peer afresh when it reconnects under the same id', async () => {
    // Trystero keeps a page's peer id, so a dropped connection can come back under it.
    const reconnectable = (room: Room) => {
      const joins: ((peer: string) => void)[] = []
      const leaves: ((peer: string) => void)[] = []
      const wrapped: Room = {
        ...room,
        onPeerJoin: (handler) => {
          joins.push(handler)
          return room.onPeerJoin(handler)
        },
        onPeerLeave: (handler) => {
          leaves.push(handler)
          return room.onPeerLeave(handler)
        },
      }
      const reconnect = () => {
        for (const peer of room.peers()) for (const handler of leaves) handler(peer)
        for (const peer of room.peers()) for (const handler of joins) handler(peer)
      }
      return { wrapped, reconnect }
    }
    const network = createMemoryNetwork()
    const chat = await pairRoom(fakeCrypto, rook.id, mika.id)
    const rookRoom = reconnectable(await network.transport().join(chat))
    const mikaRoom = reconnectable(await network.transport().join(chat))
    const a = await side(rookRoom.wrapped, rook, mika)
    const b = await side(mikaRoom.wrapped, mika, rook)
    await flush()
    expect([a.session.online(), b.session.online()]).toEqual([true, true])

    rookRoom.reconnect()
    mikaRoom.reconnect()
    await flush()
    expect([a.session.online(), b.session.online()]).toEqual([true, true])
    expect(kinds(a).filter((kind) => kind === 'online')).toHaveLength(2)
    await a.session.send('back')
    await flush()
    expect(texts(b.log())).toEqual(['back'])
  })

  it('sends nothing to a connection id taken over after its peer left', async () => {
    // Trystero lets a new connection take a gone peer's id. Eve takes Mika's while Rook is still
    // busy reading what came before, held up here by a device log he hasn't taken in yet.
    const eve = fakeSigner('eve')
    const network = createMemoryNetwork()
    const chat = await pairRoom(fakeCrypto, rook.id, mika.id)
    const inner = await network.transport().join(chat)
    await side(await network.transport().join(chat), mika, rook)
    const eveRoom = await network.transport().join(chat)
    const eveHeard: Body[] = []
    eveRoom.onMessage(async (_from, bytes) => {
      const opened = await openEnvelope(fakeCrypto, chat, bytes)
      if (opened.ok) eveHeard.push(opened.value.body)
    })
    await flush()
    const [mikaId, eveId] = inner.peers() as [string, string]
    // Rook's room shows whoever holds the id "x": Mika first, then Eve.
    let holder = mikaId
    const joins: ((peer: string) => void)[] = []
    const leaves: ((peer: string) => void)[] = []
    const rookRoom: Room = {
      ...inner,
      peers: () => ['x'],
      binding: (peer) => inner.binding(peer === 'x' ? holder : peer),
      send: (to, message) => inner.send(to === 'x' ? holder : to, message),
      onMessage: (handler) =>
        inner.onMessage((from, message) => {
          if (from === holder) handler('x', message)
          else if (from === eveId) handler(eveId, message)
        }),
      onPeerJoin: (handler) => {
        joins.push(handler)
        return () => undefined
      },
      onPeerLeave: (handler) => {
        leaves.push(handler)
        return () => undefined
      },
    }
    let held = Promise.resolve()
    const a = startPairSession({
      crypto: fakeCrypto,
      signer: rook,
      friend: mika.id,
      chat,
      rooms: [rookRoom],
      handle: () => 'Rook',
      presence: () => ({ status: 'online', message: '' }),
      log: emptyLog(chat),
      now: () => 1,
      random,
      onDeviceLog: () => held,
      onEvent: () => undefined,
    })
    await flush()
    expect(a.online()).toBe(true)

    let release: () => void = () => undefined
    held = new Promise((resolve) => {
      release = resolve
    })
    for (const peer of eveRoom.peers())
      eveRoom.send(
        peer,
        await sealEnvelope(eve, chat, 1, { type: 'device-log', log: emptyDeviceLog(mika.id) }),
      )
    await flush()
    for (const handler of leaves) handler('x')
    holder = eveId
    for (const handler of joins) handler('x')
    expect(a.online()).toBe(false)
    await a.send('for Mika only')
    release()
    await flush()
    expect(JSON.stringify(eveHeard)).not.toContain('for Mika only')
    expect(a.online()).toBe(false)
  })

  it('still takes what came before a friend left, however long it waits to be read', async () => {
    // Rook says his last words and removes Mika, then leaves at once, as a farewell does, while
    // Eve holds up Mika's reading with a device log Mika hasn't taken in yet.
    const eve = fakeSigner('eve')
    const network = createMemoryNetwork()
    const chat = await pairRoom(fakeCrypto, rook.id, mika.id)
    let held = Promise.resolve()
    const events: PairEvent[] = []
    let mikaLog = emptyLog(chat)
    const mikaSession = startPairSession({
      crypto: fakeCrypto,
      signer: mika,
      friend: rook.id,
      chat,
      rooms: [await network.transport().join(chat)],
      handle: () => 'Mika',
      presence: () => ({ status: 'online', message: '' }),
      log: mikaLog,
      now: () => 1,
      random,
      onDeviceLog: () => held,
      onEvent: (event) => {
        events.push(event)
        if (event.type === 'log') mikaLog = event.log
      },
    })
    const a = await side(await network.transport().join(chat), rook, mika)
    await flush()
    expect(mikaSession.online()).toBe(true)

    const eveRoom = await network.transport().join(chat)
    await flush()
    let release: () => void = () => undefined
    held = new Promise((resolve) => {
      release = resolve
    })
    for (const peer of eveRoom.peers())
      eveRoom.send(
        peer,
        await sealEnvelope(eve, chat, 1, { type: 'device-log', log: emptyDeviceLog(eve.id) }),
      )
    await flush()
    await a.session.send('last words')
    await a.session.unfriend()
    await a.session.close()
    await flush()
    release()
    await flush()
    expect(events.map((event) => event.type)).toContain('unfriended')
    expect(texts(mikaLog)).toEqual(['last words'])
    expect(mikaSession.online()).toBe(false)
  })

  it('hears a farewell from a friend who left before their hello was read', async () => {
    // Rook's farewell session removes Mika as soon as she's proved herself to him, and leaves.
    // Eve's device log lands in Mika's reading just ahead of Rook's hello and holds it up.
    const eve = fakeSigner('eve')
    const network = createMemoryNetwork()
    const chat = await pairRoom(fakeCrypto, rook.id, mika.id)
    const eveLog = await sealEnvelope(eve, chat, 1, {
      type: 'device-log',
      log: emptyDeviceLog(eve.id),
    })
    let held = Promise.resolve()
    let release: () => void = () => undefined
    const inner = await network.transport().join(chat)
    let injected = false
    const mikaRoom: Room = {
      ...inner,
      onMessage: (handler) =>
        inner.onMessage(async (from, bytes) => {
          const opened = await openEnvelope(fakeCrypto, chat, bytes)
          if (!injected && opened.ok && opened.value.body.type === 'hello') {
            injected = true
            held = new Promise((resolve) => {
              release = resolve
            })
            handler('eve', eveLog)
          }
          handler(from, bytes)
        }),
    }
    const mikaEvents: PairEvent[] = []
    startPairSession({
      crypto: fakeCrypto,
      signer: mika,
      friend: rook.id,
      chat,
      rooms: [mikaRoom],
      handle: () => 'Mika',
      presence: () => ({ status: 'online', message: '' }),
      log: emptyLog(chat),
      now: () => 1,
      random,
      onDeviceLog: () => held,
      onEvent: (event) => mikaEvents.push(event),
    })
    let farewellSent = false
    const farewell: PairSession = startPairSession({
      crypto: fakeCrypto,
      signer: rook,
      friend: mika.id,
      chat,
      rooms: [await network.transport().join(chat)],
      handle: () => 'Rook',
      presence: () => ({ status: 'online', message: '' }),
      log: emptyLog(chat),
      now: () => 1,
      random,
      onEvent: (event) => {
        if (event.type !== 'online') return
        void farewell.unfriend().then(async () => {
          farewellSent = true
          await farewell.close()
        })
      },
    })
    await flush()
    expect(injected).toBe(true)
    release()
    await flush()
    expect(farewellSent).toBe(true)
    expect(mikaEvents.map((event) => event.type)).toContain('unfriended')
  })

  it('answers each nonce once, so replaying them gets no stream of hellos', async () => {
    const network = createMemoryNetwork()
    const chat = await pairRoom(fakeCrypto, rook.id, mika.id)
    await side(await network.transport().join(chat), rook, mika)
    await side(await network.transport().join(chat), mika, rook)
    const eveRoom = await network.transport().join(chat)
    const nonces: Uint8Array[] = []
    let hellos = 0
    eveRoom.onMessage(async (_from, bytes) => {
      const opened = await openEnvelope(fakeCrypto, chat, bytes)
      if (!opened.ok) return
      if (opened.value.body.type === 'nonce') nonces.push(bytes)
      if (opened.value.body.type === 'hello') hellos += 1
    })
    await flush()
    // Rook's and Mika's nonces to Eve, each signed by a key the other answers.
    expect(nonces).toHaveLength(2)
    for (let i = 0; i < 100; i += 1)
      for (const peer of eveRoom.peers()) eveRoom.send(peer, nonces[i % 2] as Uint8Array)
    await flush(2000)
    // Each answers the other's nonce, and its own (a copied profile), once.
    expect(hellos).toBeLessThanOrEqual(4)
  })

  it('drops what was queued for a connection once its id is someone else’s', async () => {
    // Mika asks for the chat and leaves while Rook is still signing his answer; Eve's
    // connection takes her id.
    const network = createMemoryNetwork()
    const chat = await pairRoom(fakeCrypto, rook.id, mika.id)
    const inner = await network.transport().join(chat)
    const mikaRoom = await network.transport().join(chat)
    const eveRoom = await network.transport().join(chat)
    const eveHeard: Body[] = []
    eveRoom.onMessage(async (_from, bytes) => {
      const opened = await openEnvelope(fakeCrypto, chat, bytes)
      if (opened.ok) eveHeard.push(opened.value.body)
    })
    await flush()
    const [mikaId, eveId] = inner.peers() as [string, string]
    // Rook's room shows whoever holds the Trystero id "x": Mika, then Eve.
    let holder = mikaId
    let present = false
    const joins: ((peer: string) => void)[] = []
    const leaves: ((peer: string) => void)[] = []
    const rookRoom: Room = {
      ...inner,
      peers: () => (present ? ['x'] : []),
      binding: (peer) => inner.binding(peer === 'x' ? holder : peer),
      send: (to, message) => inner.send(to === 'x' ? holder : to, message),
      onMessage: (handler) =>
        inner.onMessage((from, message) => {
          if (from === holder) handler('x', message)
        }),
      onPeerJoin: (handler) => {
        joins.push(handler)
        return () => undefined
      },
      onPeerLeave: (handler) => {
        leaves.push(handler)
        return () => undefined
      },
    }
    // Rook's history with Mika.
    let log = emptyLog(chat)
    for (const text of ['the safe code is 4711', 'meet at noon'])
      log = (await appendMessage(log, rook, text, 1)).log
    // Signing takes a while, as WebCrypto's does: here the log-entries reply is held.
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let held = 0
    const slowRook: Signer = {
      id: rook.id,
      sign: async (data) => {
        const text = utf8Decode(data)
        if (text.ok && text.value.includes('"type":"log-entries"')) {
          held += 1
          await gate
        }
        return rook.sign(data)
      },
    }
    const rookSession = startPairSession({
      crypto: fakeCrypto,
      signer: slowRook,
      friend: mika.id,
      chat,
      rooms: [rookRoom],
      handle: () => 'Rook',
      presence: () => ({ status: 'online', message: '' }),
      log,
      now: () => 1,
      random,
      onEvent: () => undefined,
    })
    // Mika, honest, on her own connection.
    startPairSession({
      crypto: fakeCrypto,
      signer: mika,
      friend: rook.id,
      chat,
      rooms: [mikaRoom],
      handle: () => 'Mika',
      presence: () => ({ status: 'online', message: '' }),
      log: emptyLog(chat),
      now: () => 1,
      random,
      onEvent: () => undefined,
    })
    present = true
    for (const handler of joins) handler('x')
    await flush()
    // Mika proved herself and asked for the log; Rook's reply is being signed.
    expect(rookSession.online()).toBe(true)
    expect(held).toBe(1)
    // Mika's tab closes; Eve's connection takes the id.
    for (const handler of leaves) handler('x')
    holder = eveId
    for (const handler of joins) handler('x')
    expect(rookSession.online()).toBe(false)
    release()
    await flush()
    const leaked = eveHeard.filter((body) => body.type === 'log-entries')
    expect(leaked).toEqual([])
  })

  it('counts no device taken off the list while its hello was being checked', async () => {
    const rook2 = fakeSigner('rook2')
    const network = createMemoryNetwork()
    const chat = await pairRoom(fakeCrypto, rook.id, mika.id)
    const inner = await network.transport().join(chat)
    let open: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    // Reading the channel takes a while, as getStats would.
    const slowRoom: Room = {
      ...inner,
      binding: async (peer) => {
        await gate
        return inner.binding(peer)
      },
    }
    let removed = false
    const base = {
      crypto: fakeCrypto,
      friend: mika.id,
      chat,
      handle: () => 'Rook',
      presence: () => ({ status: 'online' as const, message: '' }),
      log: emptyLog(chat),
      now: () => 1,
      random,
      authors: () => new Set([rook.id, rook2.id, mika.id]),
    }
    const laptop = startPairSession({
      ...base,
      signer: rook,
      rooms: [slowRoom],
      accepts: (id) =>
        id === mika.id ? 'friend' : id === rook2.id && !removed ? 'self' : undefined,
      onEvent: () => undefined,
    })
    let phoneLog = emptyLog(chat)
    startPairSession({
      ...base,
      signer: rook2,
      rooms: [await network.transport().join(chat)],
      accepts: (id) => (id === rook.id ? 'self' : id === mika.id ? 'friend' : undefined),
      onEvent: (event) => {
        if (event.type === 'log') phoneLog = event.log
      },
    })
    await flush()
    removed = true
    laptop.recheck()
    open()
    await flush()
    await laptop.send('after the removal')
    await flush()
    expect(texts(phoneLog)).toEqual([])
  })

  it('raises no copied-profile warning for a replayed hello of its own', async () => {
    const network = createMemoryNetwork()
    const chat = await pairRoom(fakeCrypto, rook.id, mika.id)
    const a = await side(await network.transport().join(chat), rook, mika, 'aaaaaaaa')
    const eveRoom = await network.transport().join(chat)
    await flush()
    for (const peer of eveRoom.peers())
      eveRoom.send(
        peer,
        await sealEnvelope(rook, chat, 1, { type: 'hello', handle: 'Rook', instance: 'bbbbbbbb' }),
      )
    await flush()
    expect(a.twins).toEqual([])
  })
})
