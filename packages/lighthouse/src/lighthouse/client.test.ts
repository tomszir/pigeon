// Core's Lighthouse client against the real mailbox, over a socket that carries frames straight
// to a Lighthouse connection, and can be made to drop, swap or forge them like a bad relay.
import {
  base32Encode,
  createLighthouseClient,
  fakeCrypto,
  fakeSigner,
  flush,
  type LighthouseAddress,
  MAX_WAITING,
  type OpenSocket,
} from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../store/memory-store.ts'
import { createLighthouse } from './lighthouse.ts'

const signer = fakeSigner('lighthouse')
const address: LighthouseAddress = { id: signer.id, name: 'Test', url: 'wss://lighthouse.example/' }
const key = (n: number) => base32Encode(new Uint8Array(32).fill(n))

function setup(
  relay: { rewrite?: (frame: string) => string; mute?: boolean } = {},
  extra: { pass?: string } = {},
) {
  const lighthouse = createLighthouse({
    signer,
    crypto: fakeCrypto,
    store: createMemoryStore(),
    now: () => 1_000,
    name: 'Test',
    software: { name: 'pigeon-lighthouse', version: '0.0.0' },
    ...extra,
  })
  let opened = 0
  const open: OpenSocket = (_url, events) => {
    opened += 1
    const connection = lighthouse.connect('203.0.113.7')
    void Promise.resolve().then(events.onOpen)
    return {
      send(text) {
        if (relay.mute) return
        // Unanswered is closed, as the runners close it.
        void connection
          .receive(relay.rewrite?.(text) ?? text)
          .then((reply) =>
            reply === undefined
              ? events.onClose()
              : reply === null
                ? undefined
                : events.onMessage(reply),
          )
      },
      close: () => events.onClose(),
    }
  }
  let n = 0
  const timers: (() => void)[] = []
  const client = (pass?: string) =>
    createLighthouseClient({
      address: pass === undefined ? address : { ...address, pass },
      crypto: fakeCrypto,
      open,
      random: (length) => new Uint8Array(length).fill(++n),
      sleep: () => new Promise<void>((resolve) => timers.push(resolve)),
    })
  return {
    client,
    opens: () => opened,
    timeOut: () => {
      for (const run of timers.splice(0)) run()
    },
  }
}

describe('the Lighthouse client', () => {
  it('gives up on a socket that never opens, so nothing waits on it for good', async () => {
    const timers: (() => void)[] = []
    let opened = 0
    const c = createLighthouseClient({
      address,
      crypto: fakeCrypto,
      // Neither opens nor closes, as a connection stuck on its way can.
      open: () => {
        opened += 1
        return { send: () => undefined, close: () => undefined }
      },
      random: (length) => new Uint8Array(length).fill(1),
      sleep: () => new Promise<void>((resolve) => timers.push(resolve)),
    })
    const answer = c.request({ type: 'list', tags: [key(1)], cursor: 0 })
    await flush()
    for (const run of timers.splice(0)) run()
    expect(await answer).toEqual({ ok: false, error: 'unreachable' })
    // The next call opens anew.
    void c.hello()
    await flush()
    expect(opened).toBe(2)
  })

  it('says hello once per connection, then carries requests and checked replies', async () => {
    const { client, opens } = setup()
    const c = client()
    expect(await c.hello()).toEqual({
      ok: true,
      value: { name: 'pigeon-lighthouse', version: '0.0.0' },
    })
    const stored = await c.request({
      type: 'put',
      tag: key(1),
      blob: 'AQID',
      expires: 2_000,
      drops: [key(2)],
    })
    expect(stored.ok && stored.value.type).toBe('stored')
    const listed = await c.request({ type: 'list', tags: [key(1)], cursor: 0 })
    expect(listed.ok && listed.value.type === 'listed' && listed.value.items).toHaveLength(1)
    expect(opens()).toBe(1)
  })

  it('never takes the answer to a request a relay changed on the way', async () => {
    // The relay turns every list into a list from a cursor far ahead, hiding the mail.
    const { client, timeOut } = setup({
      rewrite: (frame) => frame.replace('"cursor":0', '"cursor":999999'),
    })
    const c = client()
    await c.hello()
    const listing = c.request({ type: 'list', tags: [key(1)], cursor: 0 })
    await flush()
    timeOut()
    expect(await listing).toEqual({ ok: false, error: 'timeout' })
  })

  it('says when the Lighthouse needs a pass it lacks, and opens afresh after', async () => {
    const { client, opens } = setup({}, { pass: 'friends' })
    const wrong = client()
    expect(await wrong.request({ type: 'get', id: key(1) })).toEqual({ ok: false, error: 'pass' })
    expect(await wrong.request({ type: 'get', id: key(1) })).toEqual({ ok: false, error: 'pass' })
    expect(opens()).toBe(2)
    expect((await client('friends').hello()).ok).toBe(true)
  })

  it('gives up on a request when no answer comes, and on all of them when closed', async () => {
    const { client, timeOut } = setup({ mute: true })
    const c = client()
    const hello = c.hello()
    await flush()
    timeOut()
    expect(await hello).toEqual({ ok: false, error: 'timeout' })
    const other = client()
    const waiting = other.request({ type: 'get', id: key(1) })
    await flush()
    other.close()
    expect(await waiting).toEqual({ ok: false, error: 'unreachable' })
  })

  it('opens afresh when hello is asked again after it failed', async () => {
    const { client, opens, timeOut } = setup({ mute: true })
    const c = client()
    const first = c.hello()
    await flush()
    timeOut()
    expect(await first).toEqual({ ok: false, error: 'timeout' })
    void c.hello()
    await flush()
    expect(opens()).toBe(2)
  })

  it('takes a socket that fails as it opens as unreachable, never a throw', async () => {
    const base = { address, crypto: fakeCrypto, random: (n: number) => new Uint8Array(n).fill(9) }
    const sleep = () => new Promise<void>(() => undefined)
    const throwing = createLighthouseClient({
      ...base,
      sleep,
      open: () => {
        throw new Error('SecurityError')
      },
    })
    expect(await throwing.request({ type: 'get', id: key(1) })).toEqual({
      ok: false,
      error: 'unreachable',
    })
    const closing = createLighthouseClient({
      ...base,
      sleep,
      open: (_url, events) => {
        events.onClose()
        return { send: () => undefined, close: () => undefined }
      },
    })
    expect(await closing.hello()).toEqual({ ok: false, error: 'unreachable' })
  })

  it('keeps no more requests waiting than a Lighthouse takes from one connection', async () => {
    // Hello gets through; every frame after comes back answering something else, so it waits.
    const { client } = setup({
      rewrite: (frame) => (frame.includes('"hello"') ? frame : frame.replace('"get"', '"nope"')),
    })
    const c = client()
    await c.hello()
    const waiting = Array.from({ length: MAX_WAITING }, () =>
      c.request({ type: 'get', id: key(1) }),
    )
    await flush()
    expect(await c.request({ type: 'get', id: key(1) })).toEqual({ ok: false, error: 'busy' })
    c.close()
    expect((await Promise.all(waiting)).every((answer) => !answer.ok)).toBe(true)
  })
})
