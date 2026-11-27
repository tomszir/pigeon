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
import { createMemoryStore } from '../../../platform/storage/memory-storage.ts'
import type { Store } from '../../../platform/storage/storage.ts'
import {
  createMailbox,
  RESEND_AFTER_MS,
  type Recipient,
  type RecipientList,
  type Source,
} from './mailbox.ts'

const DAY = 24 * 60 * 60 * 1000
const NOON = Date.UTC(2026, 10, 25, 12)

function setup(
  options: {
    skew?: number
    understate?: boolean
    /** What the first `get` of a blob gets instead of the blob: the blob gone, or no answer. */
    firstGet?: 'gone' | 'unreachable'
  } = {},
) {
  let now = NOON
  let firstGet = options.firstGet
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
    if (firstGet !== undefined) {
      const wrapped: LighthouseClient = {
        ...real,
        request: async (request) => {
          if (request.type === 'get' && firstGet !== undefined) {
            const instead = firstGet
            firstGet = undefined
            return instead === 'gone'
              ? { ok: true, value: { type: 'error', error: 'unknown' } }
              : { ok: false, error: 'unreachable' }
          }
          return real.request(request)
        },
      }
      return wrapped
    }
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
  const device = (
    name: string,
    identity: string,
    kept: {
      store?: Store
      stopped?: () => boolean
      listOf?: () => Promise<RecipientList | undefined>
      lighthousesOf?: () => Promise<readonly LighthouseAddress[]>
    } = {},
  ) => {
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
        store: kept.store ?? createMemoryStore(),
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
        stopped: kept.stopped ?? (() => false),
        ...(kept.listOf === undefined ? {} : { listOf: kept.listOf }),
        ...(kept.lighthousesOf === undefined ? {} : { lighthousesOf: kept.lighthousesOf }),
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

  it('keeps a letter sent during a fetch before it’s put, and puts it at the next start', async () => {
    const { address, device, recipient } = setup()
    const store = createMemoryStore()
    let closed = false
    const rook = device('rook-laptop', 'rook', { store, stopped: () => closed })
    const mika = device('mika-phone', 'mika')
    const toMika = await recipient(mika, 'mika')
    const toRook = await recipient(rook, 'rook')
    await mika.mailbox.send('farewell', toRook, {})
    const fromMika: Source = { sender: toMika.identity, secret, kinds: ['farewell'] }
    // Rook's answer is sent while his fetch is still taking Mika's letter, and his tab closes
    // before the fetch ends, so before the put the fetch holds up.
    await rook.mailbox.fetch([address], [fromMika], async () => {
      await rook.mailbox.queue('rekey', toMika, { answer: 1 })
      const outbox = (await store.get('mail-outbox')) as { kind: string; putAt: number }[]
      expect(outbox).toMatchObject([{ kind: 'rekey', putAt: 0 }])
      closed = true
      return true
    })
    const fromRook: Source = { sender: toRook.identity, secret, kinds: ['rekey'] }
    const take = vi.fn(async (_source: Source, _letter: Letter) => true)
    await mika.mailbox.fetch([address], [fromRook], take)
    expect(take).not.toHaveBeenCalled()

    // Started again on what the tab kept: the letter goes.
    const again = device('rook-laptop', 'rook', { store })
    await again.mailbox.resend()
    await mika.mailbox.fetch([address], [fromRook], take)
    expect(take).toHaveBeenCalledOnce()
    expect(take.mock.calls[0]?.[1]).toMatchObject({ kind: 'rekey', body: { answer: 1 } })
  })

  it('seals a letter’s first put to the list as it is then, across a restart', async () => {
    const { address, device, recipient } = setup()
    const store = createMemoryStore()
    let closed = false
    const laptop = device('mika-laptop', 'mika')
    const phone = device('mika-phone', 'mika')
    const tablet = device('mika-tablet', 'mika')
    const keyOf = (d: ReturnType<typeof device>) => bindSealingKey(d.signer, d.sealer)
    const listOf =
      (...ds: ReturnType<typeof device>[]) =>
      async () => ({
        devices: ds.map((d) => d.signer.id),
        keys: await Promise.all(ds.map(keyOf)),
      })
    const rook = device('rook-laptop', 'rook', { store, stopped: () => closed })
    const toRook = await recipient(rook, 'rook')
    const toMika: Recipient = { ...toRook, identity: fakeSigner('mika').id, keys: [] }
    await laptop.mailbox.send('farewell', toRook, {})
    // Queued for her laptop and phone while a fetch runs, and the tab closes before the put.
    await rook.mailbox.fetch(
      [address],
      [{ sender: toMika.identity, secret, kinds: ['farewell'] }],
      async () => {
        await rook.mailbox.queue(
          'rekey',
          { ...toMika, keys: (await listOf(laptop, phone)()).keys },
          {},
        )
        closed = true
        return true
      },
    )
    // Before it starts again, Mika takes her phone off her list and links a tablet.
    const again = device('rook-laptop', 'rook', { store, listOf: listOf(laptop, tablet) })
    await again.mailbox.resend()
    const fromRook: Source = { sender: toRook.identity, secret, kinds: ['rekey'], replyTo: toRook }
    const opens = async (d: ReturnType<typeof device>) => {
      let seen = 0
      await d.mailbox.fetch(
        [address],
        [fromRook],
        async () => true,
        async (letters) => {
          seen += letters.length
        },
      )
      return seen
    }
    expect(await opens(phone)).toBe(0)
    expect(await opens(tablet)).toBe(1)
    expect(await opens(laptop)).toBe(1)
    await again.mailbox.fetch(
      [address],
      [{ sender: toMika.identity, secret, kinds: ['receipt'] }],
      async () => true,
    )
    expect(await again.mailbox.waitingOn()).toEqual([])
  })

  it('holds a letter for a list with no key it knows, and drops one with nobody left', async () => {
    const { address, device, recipient } = setup()
    const store = createMemoryStore()
    let closed = false
    const laptop = device('mika-laptop', 'mika')
    const rook = device('rook-laptop', 'rook', { store, stopped: () => closed })
    const toRook = await recipient(rook, 'rook')
    const toMika = await recipient(laptop, 'mika')
    await laptop.mailbox.send('farewell', toRook, {})
    await rook.mailbox.fetch(
      [address],
      [{ sender: toMika.identity, secret, kinds: ['farewell'] }],
      async () => {
        await rook.mailbox.queue('rekey', toMika, {})
        closed = true
        return true
      },
    )
    // Her laptop is on her list, with a key this Pigeon no longer has: nothing is put to the
    // key from before, and the letter waits.
    let list: RecipientList = { devices: [laptop.signer.id], keys: [] }
    const again = device('rook-laptop', 'rook', { store, listOf: async () => list })
    await again.mailbox.resend()
    const take = vi.fn(async () => true)
    await laptop.mailbox.fetch(
      [address],
      [{ sender: toRook.identity, secret, kinds: ['rekey'] }],
      take,
    )
    expect(take).not.toHaveBeenCalled()
    expect((await again.mailbox.waitingOn()).map((to) => to.identity)).toEqual([toMika.identity])
    // Taken off her list: nobody is left to hear it.
    list = { devices: [], keys: [] }
    await again.mailbox.resend()
    expect(await again.mailbox.waitingOn()).toEqual([])
  })

  it('keeps a fixed letter to its devices, and a pinned one to those still listed', async () => {
    const { address, device, recipient } = setup()
    const laptop = device('rook-laptop', 'rook')
    const phone = device('rook-phone', 'rook')
    const tablet = device('rook-tablet', 'rook')
    const keyOf = (d: ReturnType<typeof device>) => bindSealingKey(d.signer, d.sealer)
    // The phone was just taken off the list; the tablet is on it.
    const listOf = async () => ({ devices: [tablet.signer.id], keys: [await keyOf(tablet)] })
    const store = createMemoryStore()
    const desk = device('rook-desk', 'rook', { store, listOf })
    const toPhone = await recipient(phone, 'rook')
    const toTablet = await recipient(tablet, 'rook')
    await desk.mailbox.send('self', toPhone, { gone: 1 }, { fixed: true })
    await desk.mailbox.send('rekey', toTablet, { again: 1 }, { pinned: true })
    await desk.mailbox.send('rekey', toPhone, { again: 2 }, { pinned: true })
    const fromDesk: Source = { sender: toPhone.identity, secret, kinds: ['self', 'rekey'] }
    const bodies = async (d: ReturnType<typeof device>) => {
      const got: unknown[] = []
      await d.mailbox.fetch([address], [fromDesk], async (_source, letter) => {
        got.push(letter.body)
        return true
      })
      return got
    }
    expect(await bodies(phone)).toEqual([{ gone: 1 }])
    expect(await bodies(tablet)).toEqual([{ again: 1 }])
    expect(await bodies(laptop)).toEqual([])
    // The pinned letter to the phone, off the list, waits on nobody and is gone.
    const outbox = (await store.get('mail-outbox')) as { body: unknown }[]
    expect(outbox.map((letter) => letter.body)).toEqual([{ gone: 1 }, { again: 1 }])
  })

  it('puts a letter about a secret again at the friend’s Lighthouses as they are now', async () => {
    const { address, device, recipient, tick } = setup()
    const mika = device('mika-phone', 'mika')
    const rook = device('rook-laptop', 'rook', { lighthousesOf: async () => [address] })
    // Sent when no Lighthouse of hers was known; she has said one since.
    await rook.mailbox.send('rekey', await recipient(mika, 'mika', []), {})
    tick(RESEND_AFTER_MS + DAY)
    await rook.mailbox.resend()
    const take = vi.fn(async () => true)
    await mika.mailbox.fetch(
      [address],
      [{ sender: fakeSigner('rook').id, secret, kinds: ['rekey'] }],
      take,
    )
    expect(take).toHaveBeenCalledOnce()
  })

  it('puts a letter again sealed to the friend’s devices as they are then', async () => {
    const { address, device, tick } = setup()
    const laptop = device('mika-laptop', 'mika')
    const phone = device('mika-phone', 'mika')
    const tablet = device('mika-tablet', 'mika')
    const keyOf = (d: ReturnType<typeof device>) => bindSealingKey(d.signer, d.sealer)
    // Mika's devices as Rook knows them when each put is made.
    let mikas = [laptop, phone]
    const listOf = async () => ({
      devices: mikas.map((d) => d.signer.id),
      keys: await Promise.all(mikas.map(keyOf)),
    })
    const rook = device('rook-laptop', 'rook', { listOf })
    const toRook: Recipient = {
      identity: fakeSigner('rook').id,
      secret,
      keys: [await keyOf(rook)],
      lighthouses: [address],
    }
    const toMika: Recipient = {
      ...toRook,
      identity: fakeSigner('mika').id,
      keys: (await listOf()).keys,
    }
    await rook.mailbox.send('letter', toMika, { hello: 1 })
    const fromRook: Source = { sender: toRook.identity, secret, kinds: ['letter'], replyTo: toRook }
    const take = vi.fn(async (_source: Source, letter: Letter) => letter.id.length > 0)
    const opened = async (d: ReturnType<typeof device>) => {
      const seen: Letter[] = []
      await d.mailbox.fetch([address], [fromRook], take, async (letters) => {
        seen.push(...letters.map(({ letter }) => letter))
      })
      return seen
    }
    const receipts = () =>
      rook.mailbox.fetch(
        [address],
        [{ sender: toMika.identity, secret, kinds: ['receipt'] }],
        async () => true,
      )
    const [first] = await opened(laptop)
    expect(take).toHaveBeenCalledOnce()
    // Mika takes her phone off her list and links a tablet; days pass with no receipt from
    // either, as the tablet is away.
    mikas = [laptop, tablet]
    tick(RESEND_AFTER_MS + DAY)
    await rook.mailbox.resend()
    await receipts()
    // The laptop's receipt came, but the letter waits on the tablet now, so it goes again.
    expect((await rook.mailbox.waitingOn()).map((to) => to.identity)).toEqual([toMika.identity])
    tick(RESEND_AFTER_MS + DAY)
    await rook.mailbox.resend()

    // The tablet gets it, under the same id, once; the removed phone only ever the first put.
    const onTablet = await opened(tablet)
    expect(onTablet.map((letter) => letter.id)).toEqual([first?.id, first?.id])
    expect(take).toHaveBeenCalledTimes(2)
    expect((await opened(phone)).map((letter) => letter.date)).toEqual([first?.date])
    await receipts()
    expect(await rook.mailbox.waitingOn()).toEqual([])
  })

  it('puts a letter again to nobody removed, even when no key is left', async () => {
    const { address, device, recipient, tick } = setup()
    const phone = device('rook-phone', 'rook')
    const tablet = device('rook-tablet', 'rook')
    const keyOf = (d: ReturnType<typeof device>) => bindSealingKey(d.signer, d.sealer)
    let list: RecipientList = { devices: [phone.signer.id], keys: [await keyOf(phone)] }
    const laptop = device('rook-laptop', 'rook', { listOf: async () => list })
    const toPhone = await recipient(phone, 'rook')
    await laptop.mailbox.send('self', toPhone, { news: 1 })
    await laptop.mailbox.send('rekey', toPhone, { again: 1 }, { pinned: true })
    // The phone is taken off the list and a tablet linked: the pinned letter isn't widened to
    // it, and nothing goes to the phone's key again.
    list = { devices: [tablet.signer.id], keys: [await keyOf(tablet)] }
    tick(RESEND_AFTER_MS + DAY)
    await laptop.mailbox.resend()
    const fromLaptop: Source = { sender: toPhone.identity, secret, kinds: ['self', 'rekey'] }
    const bodies = async (d: ReturnType<typeof device>) => {
      const got: unknown[] = []
      await d.mailbox.fetch([address], [fromLaptop], async (_source, letter) => {
        got.push(letter.body)
        return true
      })
      return got
    }
    expect(await bodies(tablet)).toEqual([{ news: 1 }])
    expect(await laptop.mailbox.waitingOn()).toHaveLength(1)
    // With every device removed and no key left, nothing more is put, to anyone.
    list = { devices: [], keys: [] }
    tick(RESEND_AFTER_MS + DAY)
    await laptop.mailbox.resend()
    expect(await laptop.mailbox.waitingOn()).toEqual([])
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

  describe('a blob that is gone or can’t be got mid-fetch', () => {
    async function twoLetters(options: Parameters<typeof setup>[0]) {
      const { address, device, recipient } = setup(options)
      const rook = device('rook-laptop', 'rook')
      const mika = device('mika-phone', 'mika')
      const toMika = await recipient(mika, 'mika')
      await rook.mailbox.send('farewell', toMika, { reason: 'first' })
      await rook.mailbox.send('farewell', toMika, { reason: 'second' })
      const from: Source = { sender: fakeSigner('rook').id, secret, kinds: ['farewell'] }
      const reasons: unknown[] = []
      const take = async (_source: Source, letter: Letter) => {
        reasons.push((letter.body as { reason: string }).reason)
        return true
      }
      return { address, mika, from, take, reasons }
    }

    it('skips it and still gets the rest of that Lighthouse’s list', async () => {
      const { address, mika, from, take, reasons } = await twoLetters({ firstGet: 'gone' })
      await mika.mailbox.fetch([address], [from], take)
      expect(reasons).toEqual(['second'])
      // The cursor moved past what's gone: the next fetch finds nothing left to read.
      await mika.mailbox.fetch([address], [from], take)
      expect(reasons).toEqual(['second'])
    })

    it('doesn’t count it against the source’s item limit', async () => {
      const { address, mika, from, take, reasons } = await twoLetters({ firstGet: 'gone' })
      await mika.mailbox.fetch([address], [{ ...from, maxItems: 1 }], take)
      expect(reasons).toEqual(['second'])
    })

    it('keeps the Lighthouse’s cursor and days when it can’t read it to the end', async () => {
      const { address, device, recipient } = setup({ firstGet: 'unreachable' })
      const store = createMemoryStore()
      const before = { [address.id]: { cursor: 0, at: NOON - 5 * DAY } }
      await store.set('mail-fetched', before)
      const rook = device('rook-laptop', 'rook')
      const mika = device('mika-phone', 'mika', { store })
      await rook.mailbox.send('farewell', await recipient(mika, 'mika'), { reason: 'first' })
      const from: Source = { sender: fakeSigner('rook').id, secret, kinds: ['farewell'] }
      await mika.mailbox.fetch([address], [from], async () => true)
      // The days it read stay where they were, so the next look reads them all again.
      expect(await store.get('mail-fetched')).toEqual(before)
      await mika.mailbox.fetch([address], [from], async () => true)
      expect(await store.get('mail-fetched')).toMatchObject({ [address.id]: { at: NOON } })
    })

    it('still treats a Lighthouse that can’t be reached as unreachable, reading again next time', async () => {
      const { address, mika, from, take, reasons } = await twoLetters({ firstGet: 'unreachable' })
      await mika.mailbox.fetch([address], [from], take)
      expect(reasons).toEqual([])
      // Nothing was skipped for good: the cursor stayed where it was.
      await mika.mailbox.fetch([address], [from], take)
      expect(reasons).toEqual(['first', 'second'])
    })
  })
})
