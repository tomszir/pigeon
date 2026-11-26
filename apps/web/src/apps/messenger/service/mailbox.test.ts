// The mailbox against a real Lighthouse, in memory, reached over a socket that carries frames
// straight to it.
import {
  base32Encode,
  bindSealingKey,
  createLighthouseClient,
  fakeCrypto,
  fakeSealCrypto,
  fakeSigner,
  type Letter,
  type LighthouseAddress,
  type LighthouseClient,
} from '@pigeon/core'
import { createLighthouse, createMemoryStore as createMailStore } from '@pigeon/lighthouse'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryStore } from '../../../platform/storage/storage.ts'
import { createMailbox, RESEND_AFTER_MS, type Recipient, type Source } from './mailbox.ts'

const DAY = 24 * 60 * 60 * 1000
const NOON = Date.UTC(2026, 10, 25, 12)

function setup(options: { skew?: number; understate?: boolean } = {}) {
  let now = NOON
  const lighthouseSigner = fakeSigner('lighthouse')
  const lighthouse = createLighthouse({
    signer: lighthouseSigner,
    crypto: fakeCrypto,
    store: createMailStore(),
    now: () => now,
    name: 'Test',
    software: { name: 'pigeon-lighthouse', version: '0.0.0' },
  })
  const address: LighthouseAddress = {
    id: lighthouseSigner.id,
    name: 'Test',
    url: 'wss://l.example/',
  }
  let n = 0
  const client = (): LighthouseClient => {
    const real = connect()
    if (options.understate !== true) return real
    // A Lighthouse that lists every blob as one byte, whatever it then hands over.
    return {
      ...real,
      request: async (request) => {
        const answer = await real.request(request)
        if (!answer.ok || answer.value.type !== 'listed') return answer
        const items = answer.value.items.map((item) => ({ ...item, size: 1 }))
        return { ...answer, value: { ...answer.value, items } }
      },
    }
  }
  const connect = (): LighthouseClient =>
    createLighthouseClient({
      address,
      crypto: fakeCrypto,
      random: (length) => new Uint8Array(length).fill(++n % 250),
      sleep: () => new Promise(() => undefined),
      open: (_url, events) => {
        const connection = lighthouse.connect('203.0.113.7')
        void Promise.resolve().then(events.onOpen)
        return {
          send: (text) =>
            void connection
              .receive(text)
              .then((reply) => (reply === undefined ? events.onClose() : events.onMessage(reply))),
          close: () => events.onClose(),
        }
      },
    })
  const seal = fakeSealCrypto()
  let r = 0
  const device = (name: string, identity: string) => {
    const signer = fakeSigner(name)
    const sealer = seal.sealer(name)
    const clients = new Map<string, LighthouseClient>()
    return {
      signer,
      sealer,
      mailbox: createMailbox({
        crypto: fakeCrypto,
        seal,
        sealer,
        signer,
        self: fakeSigner(identity).id,
        store: createMemoryStore(),
        // A device's clock, which may run ahead of the Lighthouse's.
        now: () => now + (options.skew ?? 0),
        random: (length) => new Uint8Array(length).fill(++r % 250),
        client: (lh) => {
          let c = clients.get(lh.id)
          if (c === undefined) {
            c = client()
            clients.set(lh.id, c)
          }
          return c
        },
        head: () => ({ epoch: 0, seq: 0 }),
        stopped: () => false,
      }),
    }
  }
  const recipient = async (d: ReturnType<typeof device>, identity: string, lh = [address]) => ({
    identity: fakeSigner(identity).id,
    secret,
    keys: [await bindSealingKey(d.signer, d.sealer)],
    lighthouses: lh,
  })
  return { address, device, recipient, tick: (ms: number) => (now += ms) }
}

const secret = base32Encode(new Uint8Array(32).fill(7))

describe('the mailbox', () => {
  it('leaves a letter for an offline friend, which they take once and receipt', async () => {
    const { address, device } = setup()
    const rook = device('rook-laptop', 'rook')
    const mika = device('mika-phone', 'mika')
    const toMika: Recipient = {
      identity: fakeSigner('mika').id,
      secret,
      keys: [await bindSealingKey(mika.signer, mika.sealer)],
      lighthouses: [address],
    }
    const toRook: Recipient = {
      identity: fakeSigner('rook').id,
      secret,
      keys: [await bindSealingKey(rook.signer, rook.sealer)],
      lighthouses: [address],
    }
    expect(await rook.mailbox.send('farewell', toMika, { reason: 'bye' })).toBe(true)
    expect(await rook.mailbox.waitingOn()).toEqual([toMika])

    const take = vi.fn(async (_source: Source, _letter: Letter) => true)
    const fromRook: Source = {
      sender: toRook.identity,
      secret,
      kinds: ['farewell'],
      replyTo: toRook,
    }
    await mika.mailbox.fetch([address], [fromRook], take)
    expect(take).toHaveBeenCalledOnce()
    expect(take.mock.calls[0]?.[1]).toMatchObject({ kind: 'farewell', body: { reason: 'bye' } })
    // Fetched again: nothing new, and the Lighthouse dropped its copy.
    await mika.mailbox.fetch([address], [fromRook], take)
    expect(take).toHaveBeenCalledOnce()

    // Rook fetches the receipt, and stops waiting.
    const fromMika: Source = { sender: toMika.identity, secret, kinds: ['receipt'] }
    await rook.mailbox.fetch([address], [fromMika], async () => true)
    expect(await rook.mailbox.waitingOn()).toEqual([])
  })

  it('measures each blob it gets, whatever size the Lighthouse listed', async () => {
    for (const [maxBytes, understate, taken] of [
      [64 * 1024, true, 1],
      [16 * 1024, false, 0],
      // A Lighthouse that lists it as one byte doesn't get it opened either.
      [16 * 1024, true, 0],
    ] as const) {
      const { address, device } = setup({ understate })
      const rook = device('rook-laptop', 'rook')
      const mika = device('mika-phone', 'mika')
      const toMika: Recipient = {
        identity: fakeSigner('mika').id,
        secret,
        keys: [await bindSealingKey(mika.signer, mika.sealer)],
        lighthouses: [address],
      }
      const reason = 'x'.repeat(20_000)
      expect(await rook.mailbox.send('farewell', toMika, { reason })).toBe(true)
      const take = vi.fn(async () => true)
      const fromRook: Source = {
        sender: fakeSigner('rook').id,
        secret,
        kinds: ['farewell'],
        maxBytes,
      }
      await mika.mailbox.fetch([address], [fromRook], take)
      expect(take).toHaveBeenCalledTimes(taken)
    }
  })

  it('puts a letter again after a few days without receipt, taken only once', async () => {
    const { address, device, tick } = setup()
    const rook = device('rook-laptop', 'rook')
    const mika = device('mika-phone', 'mika')
    const toMika: Recipient = {
      identity: fakeSigner('mika').id,
      secret,
      keys: [await bindSealingKey(mika.signer, mika.sealer)],
      lighthouses: [address],
    }
    await rook.mailbox.send('farewell', toMika, {})
    tick(RESEND_AFTER_MS + DAY)
    await rook.mailbox.resend()
    const take = vi.fn(async () => true)
    await mika.mailbox.fetch(
      [address],
      [{ sender: fakeSigner('rook').id, secret, kinds: ['farewell'] }],
      take,
    )
    expect(take).toHaveBeenCalledOnce()
  })

  it('sends no receipt for a letter that didn’t count', async () => {
    const { address, device } = setup()
    const rook = device('rook-laptop', 'rook')
    const mika = device('mika-phone', 'mika')
    const toMika: Recipient = {
      identity: fakeSigner('mika').id,
      secret,
      keys: [await bindSealingKey(mika.signer, mika.sealer)],
      lighthouses: [address],
    }
    const toRook: Recipient = {
      identity: fakeSigner('rook').id,
      secret,
      keys: [await bindSealingKey(rook.signer, rook.sealer)],
      lighthouses: [address],
    }
    await rook.mailbox.send('farewell', toMika, {})
    await mika.mailbox.fetch(
      [address],
      [{ sender: toRook.identity, secret, kinds: ['farewell'], replyTo: toRook }],
      async () => false,
    )
    await rook.mailbox.fetch(
      [address],
      [{ sender: toMika.identity, secret, kinds: ['receipt'] }],
      async () => true,
    )
    expect(await rook.mailbox.waitingOn()).toEqual([toMika])
  })

  it('puts mail from a device whose clock runs ahead of the Lighthouse’s', async () => {
    const { device, recipient } = setup({ skew: 90_000 })
    const rook = device('rook-laptop', 'rook')
    const mika = device('mika-phone', 'mika')
    expect(await rook.mailbox.send('farewell', await recipient(mika, 'mika'), {})).toBe(true)
  })

  it('fetches for more friends than one list takes, over a month', async () => {
    const { address, device, recipient } = setup()
    const rook = device('rook-laptop', 'rook')
    const mika = device('mika-phone', 'mika')
    const others = Array.from({ length: 20 }, (_, n) => ({
      sender: fakeSigner(`friend-${n}`).id,
      secret: base32Encode(new Uint8Array(32).fill(100 + n)),
      kinds: ['farewell' as const],
    }))
    await rook.mailbox.send('farewell', await recipient(mika, 'mika'), {})
    const take = vi.fn(async () => true)
    await mika.mailbox.fetch(
      [address],
      [...others, { sender: fakeSigner('rook').id, secret, kinds: ['farewell'] }],
      take,
    )
    expect(take).toHaveBeenCalledOnce()
  })

  it('sends its receipt again when a letter is put again, in case the first was lost', async () => {
    const { address, device, recipient, tick } = setup()
    const rook = device('rook-laptop', 'rook')
    const mika = device('mika-phone', 'mika')
    const toMika = await recipient(mika, 'mika')
    const fromRook = (lighthouses: LighthouseAddress[]) => ({
      sender: fakeSigner('rook').id,
      secret,
      kinds: ['farewell' as const],
      replyTo: { identity: fakeSigner('rook').id, secret, keys: toMika.keys, lighthouses },
    })
    await rook.mailbox.send('farewell', toMika, {})
    // The first receipt goes nowhere: as if Rook's Lighthouse was down.
    const rookKey = await bindSealingKey(rook.signer, rook.sealer)
    await mika.mailbox.fetch(
      [address],
      [{ ...fromRook([]), replyTo: { ...fromRook([]).replyTo, keys: [rookKey] } }],
      async () => true,
    )
    tick(RESEND_AFTER_MS + DAY)
    await rook.mailbox.resend()
    await mika.mailbox.fetch(
      [address],
      [{ ...fromRook([address]), replyTo: { ...fromRook([address]).replyTo, keys: [rookKey] } }],
      async () => true,
    )
    const heard = await rook.mailbox.fetch(
      [address],
      [{ sender: toMika.identity, secret, kinds: ['receipt'] }],
      async () => true,
    )
    expect(heard).toEqual([toMika.identity])
    expect(await rook.mailbox.waitingOn()).toEqual([])
  })

  it('never says a letter that only expired was heard', async () => {
    const { address, device, recipient, tick } = setup()
    const rook = device('rook-laptop', 'rook')
    const mika = device('mika-phone', 'mika')
    await rook.mailbox.send('farewell', await recipient(mika, 'mika'), {})
    tick(31 * DAY)
    await rook.mailbox.resend()
    expect(await rook.mailbox.waitingOn()).toEqual([])
    expect(
      await rook.mailbox.fetch(
        [address],
        [{ sender: fakeSigner('mika').id, secret, kinds: ['receipt'] }],
        async () => true,
      ),
    ).toEqual([])
  })
})
