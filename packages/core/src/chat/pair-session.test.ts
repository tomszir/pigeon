import { describe, expect, it } from 'vitest'
import type { Signer } from '../identity/crypto.ts'
import { pairRoom } from '../identity/identity.ts'
import { encodePairSecret, PAIR_SECRET_BYTES } from '../pairing/pair-rooms.ts'
import { createMemoryNetwork, fakeCrypto, fakeSigner, flush } from '../testing/testing.ts'
import type { Transport } from '../transport/transport.ts'
import { appendMessage, type ChatLog, emptyLog } from './chat-log.ts'
import { type PairEvent, type PairSession, startPairSession } from './pair-session.ts'

const rook = fakeSigner('rook')
const mika = fakeSigner('mika')

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
    handle: () => (self === rook ? 'Rook' : 'Mika'),
    presence: () => ({ status: 'online', message: '' }),
    ...(avatar === undefined ? {} : { avatar }),
    log: current,
    now: () => 1,
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
  const secret = encodePairSecret(new Uint8Array(PAIR_SECRET_BYTES).fill(3))

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

    const legacy = await pairRoom(fakeCrypto, rook.id, mika.id)
    await b.session.removeRoom(legacy)
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

  it('passes the pair secret and its confirmation along', async () => {
    const network = createMemoryNetwork()
    const a = await open(network.transport(), rook, mika)
    const b = await open(network.transport(), mika, rook)
    await flush()
    await a.session.sendSecret(secret)
    await flush()
    expect(b.events).toContainEqual({ type: 'secret', secret })
    await b.session.confirmSecret()
    await flush()
    expect(kinds(a)).toContain('secret-ok')
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

describe('several devices (decision 0024)', () => {
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

describe('a copied profile (decision 0028)', () => {
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
