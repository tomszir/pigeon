import {
  base32Encode,
  base64Encode,
  encodeRequest,
  fakeCrypto,
  fakeSigner,
  LIGHTHOUSE_PROTOCOL,
  type LighthouseReply,
  type LighthouseRequest,
  MAX_MAIL_MS,
  mailBlobId,
  openReply,
} from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import { blobCost, DEFAULT_LIMITS } from '../limits/limits.ts'
import { createMemoryStore } from '../store/memory-store.ts'
import type { MailStore } from '../store/store.ts'
import { createLighthouse, type LighthouseOptions, MAX_PENDING } from './lighthouse.ts'

const signer = fakeSigner('lighthouse')
const bytes = (n: number) => new Uint8Array(32).fill(n)
const key = (n: number) => base32Encode(bytes(n))
const hashOf = async (n: number) => base32Encode(await fakeCrypto.sha256(bytes(n)))
const NOW = 1_000_000
const NONCE = key(250)

/** A reply, which every frame here should get rather than having its connection closed. */
const must = (text: string | undefined): string => {
  if (text === undefined) throw new Error('closed unanswered')
  return text
}

/** A store that notes each call made to it, and a crypto that counts its hashes. */
function watched() {
  const calls: string[] = []
  const inner = createMemoryStore()
  const store = Object.fromEntries(
    Object.entries(inner).map(([name, method]) => [
      name,
      (...args: unknown[]) => {
        calls.push(name)
        return (method as (...a: unknown[]) => unknown)(...args)
      },
    ]),
  ) as unknown as MailStore
  let hashes = 0
  const crypto = {
    ...fakeCrypto,
    sha256: (data: Uint8Array) => {
      hashes += 1
      return fakeCrypto.sha256(data)
    },
  }
  return { store, crypto, calls, hashes: () => hashes }
}

function setup(extra: Partial<LighthouseOptions> = {}) {
  let now = NOW
  const lighthouse = createLighthouse({
    signer,
    crypto: fakeCrypto,
    store: createMemoryStore(),
    now: () => now,
    name: 'Test Lighthouse',
    software: { name: 'pigeon-lighthouse', version: '0.0.0' },
    ...extra,
  })
  const open = (address = '203.0.113.7') => {
    const connection = lighthouse.connect(address)
    let req = 0
    // As a client does: no nonce until its hello gives one.
    let nonce = ''
    return async (request: LighthouseRequest): Promise<LighthouseReply> => {
      req += 1
      if (request.type === 'hello') nonce = request.nonce
      const sent = encodeRequest({ req, request })
      const text = must(await connection.receive(sent))
      const opened = await openReply(fakeCrypto, signer.id, text, { nonce, sent })
      if (!opened.ok) throw new Error(opened.error)
      expect(opened.value.req).toBe(req)
      return opened.value.reply
    }
  }
  return {
    lighthouse,
    open,
    tick: (ms: number) => {
      now += ms
    },
  }
}

const hello: LighthouseRequest = { type: 'hello', protocol: LIGHTHOUSE_PROTOCOL, nonce: NONCE }
const put = async (tag: number, drops: number[], expires = NOW + 1000) =>
  ({
    type: 'put',
    tag: key(tag),
    blob: base64Encode(new Uint8Array([tag, 1, 2])),
    expires,
    drops: await Promise.all(drops.map(hashOf)),
  }) satisfies LighthouseRequest

describe('the Lighthouse', () => {
  it('says who it is, signed, and refuses a protocol it doesn’t speak', async () => {
    const ask = setup().open()
    expect(await ask(hello)).toEqual({
      type: 'hello',
      protocol: LIGHTHOUSE_PROTOCOL,
      name: 'Test Lighthouse',
      software: { name: 'pigeon-lighthouse', version: '0.0.0' },
    })
    expect(await ask({ ...hello, protocol: LIGHTHOUSE_PROTOCOL + 1 })).toEqual({
      type: 'error',
      error: 'protocol',
      protocol: LIGHTHOUSE_PROTOCOL,
    })
  })

  it('answers nothing before hello, or without its pass', async () => {
    const { open } = setup({ pass: 'friends-only' })
    const ask = open()
    expect(await ask(await put(1, [2]))).toEqual({ type: 'error', error: 'hello-first' })
    expect(await ask(hello)).toEqual({ type: 'error', error: 'pass' })
    expect(await ask(await put(1, [2]))).toEqual({ type: 'error', error: 'hello-first' })
    expect((await ask({ ...hello, pass: 'friends-only' })).type).toBe('hello')
    expect((await ask(await put(1, [2]))).type).toBe('stored')
  })

  it('holds mail under its tag until each device drops its copy', async () => {
    const { open } = setup()
    const sender = open('198.51.100.1')
    await sender(hello)
    const request = await put(1, [2, 3])
    const stored = await sender(request)
    const id = await mailBlobId(fakeCrypto, request.tag, request.blob, request.drops)
    expect(stored).toEqual({ type: 'stored', id, expires: request.expires })

    // The recipient's laptop and phone each fetch it, on connections of their own.
    for (const [address, drop, remaining] of [
      ['203.0.113.7', 2, 1],
      ['2001:db8::9', 3, 0],
    ] as const) {
      const device = open(address)
      await device(hello)
      expect(await device({ type: 'list', tags: [key(1), key(9)], cursor: 0 })).toEqual({
        type: 'listed',
        items: [{ id, tag: key(1), size: 3 }],
        cursor: 1,
        more: false,
      })
      expect(await device({ type: 'get', id })).toEqual({
        type: 'blob',
        id,
        tag: key(1),
        blob: request.blob,
        expires: request.expires,
      })
      expect(await device({ type: 'drop', id, key: key(drop) })).toEqual({
        type: 'dropped',
        id,
        remaining,
      })
    }
    const late = open()
    await late(hello)
    expect(await late({ type: 'get', id })).toEqual({ type: 'error', error: 'unknown' })
  })

  it("lets nobody drop a copy without that device's value", async () => {
    const ask = setup().open()
    await ask(hello)
    const stored = await ask(await put(1, [2]))
    const id = stored.type === 'stored' ? stored.id : ''
    expect(await ask({ type: 'drop', id, key: key(7) })).toEqual({
      type: 'error',
      error: 'wrong-drop',
    })
    expect(await ask({ type: 'drop', id, key: key(2) })).toEqual({
      type: 'dropped',
      id,
      remaining: 0,
    })
    expect(await ask({ type: 'drop', id, key: key(2) })).toEqual({
      type: 'error',
      error: 'unknown',
    })
  })

  it('keeps mail no longer than 30 days, and forgets it once expired', async () => {
    const { open, tick, lighthouse } = setup()
    const ask = open()
    await ask(hello)
    expect(await ask(await put(1, [2], NOW + MAX_MAIL_MS + 1))).toEqual({
      type: 'error',
      error: 'malformed',
    })
    expect(await ask(await put(1, [2], NOW))).toEqual({ type: 'error', error: 'malformed' })
    const stored = await ask(await put(1, [2], NOW + 100))
    const id = stored.type === 'stored' ? stored.id : ''
    tick(100)
    expect(await ask({ type: 'get', id })).toEqual({ type: 'error', error: 'unknown' })
    expect((await ask({ type: 'list', tags: [key(1)], cursor: 0 })).type).toBe('listed')
    expect(await lighthouse.sweep()).toBe(1)
  })

  it('takes a retry as the same mail, held as first put, without counting it again', async () => {
    const ask = setup({ limits: { ...DEFAULT_LIMITS, putsPerHour: 2 } }).open()
    await ask(hello)
    const request = await put(1, [2])
    const first = await ask(request)
    expect(await ask({ ...request, expires: request.expires + 500 })).toEqual(first)
    expect((await ask(await put(4, [5]))).type).toBe('stored')
    expect(await ask(await put(6, [7]))).toEqual({ type: 'error', error: 'limit' })
  })

  it('refuses a put over its limits without hashing it or touching the store', async () => {
    const { store, crypto, calls, hashes } = watched()
    const ask = setup({ store, crypto, limits: { ...DEFAULT_LIMITS, putsPerHour: 1 } }).open()
    await ask(hello)
    expect((await ask(await put(1, [2]))).type).toBe('stored')
    calls.length = 0
    const before = hashes()
    expect(await ask(await put(4, [5]))).toEqual({ type: 'error', error: 'limit' })
    expect(calls).toEqual([])
    // The one hash is of the frame the refusal answers, which every signed reply carries.
    expect(hashes() - before).toBe(1)
  })

  it('refuses when full, counting what each blob costs to keep, not just its bytes', async () => {
    const { store, calls } = watched()
    const ask = setup({ store, limits: { ...DEFAULT_LIMITS, maxBytes: blobCost(3, 1) } }).open()
    await ask(hello)
    expect((await ask(await put(1, [2]))).type).toBe('stored')
    calls.length = 0
    expect(await ask(await put(4, [5]))).toEqual({ type: 'error', error: 'full' })
    // Its total is all a refusal reads: nothing is looked up by id.
    expect(calls).toEqual(['totalBytes'])
  })

  it('takes back the count of a put refused for being full', async () => {
    const limits = { ...DEFAULT_LIMITS, putsPerHour: 2, maxBytes: blobCost(3, 1) }
    const { open } = setup({ limits })
    const ask = open()
    await ask(hello)
    const first = await ask(await put(1, [2]))
    const id = first.type === 'stored' ? first.id : ''
    expect(await ask(await put(4, [5]))).toEqual({ type: 'error', error: 'full' })
    // Room again, and the refusal didn’t use up the hour’s second put.
    await ask({ type: 'drop', id, key: key(2) })
    expect((await ask(await put(4, [5]))).type).toBe('stored')
  })

  it('closes, unanswered, a connection whose range sends more frames than it may', async () => {
    const { store, crypto, calls, hashes } = watched()
    const { lighthouse } = setup({
      store,
      crypto,
      limits: { ...DEFAULT_LIMITS, framesPerMinute: 3 },
    })
    const connection = lighthouse.connect('203.0.113.7')
    // Frames that are refused or can't be read count as much as any other.
    expect(await connection.receive('not a frame')).toBeDefined()
    expect(
      await connection.receive(encodeRequest({ req: 1, request: await put(1, [2]) })),
    ).toBeDefined()
    expect(await connection.receive(encodeRequest({ req: 2, request: hello }))).toBeDefined()
    calls.length = 0
    const before = hashes()
    const frame = encodeRequest({ req: 3, request: await put(1, [2]) })
    expect(await connection.receive(frame)).toBeUndefined()
    expect(calls).toEqual([])
    expect(hashes()).toBe(before)
    // The budget is the range's: another connection from it is closed too, until the minute turns.
    expect(await lighthouse.connect('203.0.113.7').receive(frame)).toBeUndefined()
    expect(await lighthouse.connect('198.51.100.1').receive(frame)).toBeDefined()
  })

  it('counts frames before hello against the budget too', async () => {
    const { lighthouse, tick } = setup({ limits: { ...DEFAULT_LIMITS, framesPerMinute: 2 } })
    const connection = lighthouse.connect('203.0.113.7')
    const frame = encodeRequest({ req: 1, request: { type: 'get', id: key(1) } })
    expect(await connection.receive(frame)).toBeDefined()
    expect(await connection.receive(frame)).toBeDefined()
    expect(await connection.receive(frame)).toBeUndefined()
    // Once over, the connection stays closed, even when the minute turns.
    tick(60_000)
    expect(await connection.receive(frame)).toBeUndefined()
  })

  it('counts hellos, lists, gets and drops too', async () => {
    const ask = setup({ limits: { ...DEFAULT_LIMITS, readsPerMinute: 2 } }).open()
    await ask(hello)
    expect((await ask({ type: 'list', tags: [key(1)], cursor: 0 })).type).toBe('listed')
    expect(await ask({ type: 'get', id: key(1) })).toEqual({ type: 'error', error: 'limit' })
  })

  it('answers a frame it can’t read with a signed refusal for that frame', async () => {
    const { lighthouse } = setup()
    const sent = '{"req":5,"request":{"type":"nope"}}'
    const text = must(await lighthouse.connect('203.0.113.7').receive(sent))
    expect(await openReply(fakeCrypto, signer.id, text, { nonce: '', sent })).toEqual({
      ok: true,
      value: { req: 5, at: NOW, reply: { type: 'error', error: 'malformed' } },
    })
  })

  it('refuses requests past what one connection may have waiting', async () => {
    const { lighthouse } = setup()
    const connection = lighthouse.connect('203.0.113.7')
    const frames = Array.from({ length: MAX_PENDING + 2 }, (_, i) =>
      encodeRequest({ req: i + 1, request: hello }),
    )
    const replies = await Promise.all(frames.map((frame) => connection.receive(frame)))
    const kinds = await Promise.all(
      replies.map(async (text, i) => {
        const opened = await openReply(fakeCrypto, signer.id, must(text), {
          nonce: i < MAX_PENDING ? NONCE : '',
          sent: frames[i] ?? '',
        })
        return opened.ok ? opened.value.reply.type : opened.error
      }),
    )
    expect(kinds.filter((kind) => kind === 'hello')).toHaveLength(MAX_PENDING)
    expect(kinds.slice(MAX_PENDING)).toEqual(['error', 'error'])
  })

  it('carries on a connection that slept, from what it saved', async () => {
    const { lighthouse } = setup()
    const first = lighthouse.connect('203.0.113.7')
    await first.receive(encodeRequest({ req: 1, request: hello }))
    expect(first.saved()).toEqual({ greeted: true, nonce: NONCE })
    // The socket woke in a fresh instance: the same connection, from what it saved.
    const woken = lighthouse.connect('203.0.113.7', first.saved())
    const sent = encodeRequest({ req: 2, request: { type: 'list', tags: [key(1)], cursor: 0 } })
    const opened = await openReply(fakeCrypto, signer.id, must(await woken.receive(sent)), {
      nonce: NONCE,
      sent,
    })
    expect(opened.ok && opened.value.reply.type).toBe('listed')
  })

  it('answers one connection’s requests in the order they came', async () => {
    const { lighthouse } = setup()
    const connection = lighthouse.connect('203.0.113.7')
    const request = await put(1, [2])
    const replies = await Promise.all([
      connection.receive(encodeRequest({ req: 1, request: hello })),
      connection.receive(encodeRequest({ req: 2, request })),
    ])
    const opened = await Promise.all(
      replies.map((text, i) =>
        openReply(fakeCrypto, signer.id, must(text), {
          nonce: NONCE,
          sent: encodeRequest({ req: i + 1, request: i === 0 ? hello : request }),
        }),
      ),
    )
    expect(opened.map((reply) => (reply.ok ? reply.value.reply.type : reply.error))).toEqual([
      'hello',
      'stored',
    ])
  })
})
