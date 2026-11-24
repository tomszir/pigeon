import { describe, expect, it } from 'vitest'
import type { Signer } from '../identity/crypto.ts'
import { pairRoom } from '../identity/identity.ts'
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
    room: await transport.join(name),
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
const kinds = (side: Side) => side.events.map((event) => event.type).filter((t) => t !== 'log')

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
    expect(a.events[0]).toEqual({ type: 'online', handle: 'Mika', avatar: 2 })
  })

  it('sees each other come online, chat, type, buzz and go offline', async () => {
    const network = createMemoryNetwork()
    const a = await open(network.transport(), rook, mika)
    const mikaTransport = network.transport()
    const b = await open(mikaTransport, mika, rook)
    await flush()
    expect(a.events[0]).toEqual({ type: 'online', handle: 'Mika', avatar: 1 })
    expect(b.events[0]).toEqual({ type: 'online', handle: 'Rook', avatar: 1 })
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
      room: await network.transport().join(name),
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
