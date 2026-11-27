// Hearing about mail at once: when a wait is left, with which tags, cursor and lease, what each
// answer does, and when a dropped wait is opened again.
import type { LighthouseAddress, LighthouseClient, LighthouseRequest } from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import type { Looked } from './look.ts'
import { createMailWaits, REOPEN_FIRST_MS, waitTags } from './mail-waits.ts'

const lighthouse: LighthouseAddress = { id: 'lh' as never, name: 'Harbour', url: 'wss://h.test/' }
const NOON = Date.UTC(2026, 10, 27, 12)
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

type Answer = Awaited<ReturnType<LighthouseClient['request']>>

/** A clock that moves only when told, a client that holds each wait until it's answered. */
function harness(options: { on?: () => boolean; visible?: () => boolean } = {}) {
  let now = NOON
  const sleeping: { at: number; wake: () => void }[] = []
  const waits: { request: LighthouseRequest; answer: (answer: Answer) => void }[] = []
  let closed = 0
  let cues = 0
  const client: LighthouseClient = {
    hello: async () => ({ ok: true, value: { name: 'x', version: '0' } }),
    request: (request) =>
      new Promise<Answer>((resolve) => waits.push({ request, answer: resolve })),
    close: () => {
      closed += 1
    },
  }
  const waitsFor = createMailWaits({
    clock: {
      now: () => now,
      sleep: (ms) => new Promise<void>((wake) => sleeping.push({ at: now + ms, wake })),
    },
    random: () => new Uint8Array([255]),
    client: () => client,
    on: options.on ?? (() => true),
    visible: options.visible ?? (() => true),
    cue: () => {
      cues += 1
    },
    nextLook: () => 7 * 60 * 1000,
    closed: () => false,
  })
  return {
    waits,
    waitsFor,
    cues: () => cues,
    closed: () => closed,
    async pass(ms: number) {
      now += ms
      for (const sleeper of sleeping.filter((one) => one.at <= now)) {
        sleeping.splice(sleeping.indexOf(sleeper), 1)
        sleeper.wake()
      }
      await flush()
    },
  }
}

const tag = (n: number) => String.fromCharCode(97 + n).repeat(52)
const looked = (extra: Partial<Looked> = {}): Looked => ({
  at: NOON,
  complete: true,
  cursor: 41,
  tags: [
    { tag: tag(1), date: '2026-11-26', first: false },
    { tag: tag(2), date: '2026-11-27', first: false },
    { tag: tag(3), date: '2026-11-27', first: true },
  ],
  ...extra,
})

describe('the tags a wait names', () => {
  it('are today’s, yours first, then yesterday’s early in the day and tomorrow’s late', () => {
    expect(waitTags(NOON, looked().tags)).toEqual([tag(3), tag(2)])
    const early = Date.UTC(2026, 10, 27, 1)
    expect(waitTags(early, looked().tags)).toEqual([tag(3), tag(1), tag(2)])
    const late = Date.UTC(2026, 10, 26, 23)
    expect(waitTags(late, looked().tags)).toEqual([tag(3), tag(1), tag(2)])
  })

  it('are 128 at most', () => {
    const many = Array.from({ length: 200 }, (_, n) => ({
      tag: `t${n}`,
      date: '2026-11-27',
      first: false,
    }))
    expect(waitTags(NOON, many)).toHaveLength(128)
  })
})

describe('waiting at a Lighthouse', () => {
  it('follows a look that read every list, with its cursor and a lease to the next look', async () => {
    const { waits, waitsFor } = harness()
    waitsFor.looked(lighthouse, looked())
    await flush()
    expect(waits.map((one) => one.request)).toEqual([
      { type: 'wait', tags: [tag(3), tag(2)], cursor: 41, seconds: 420 },
    ])
  })

  it('doesn’t follow a look that didn’t finish, nor while waiting is off', async () => {
    const off = harness({ on: () => false })
    off.waitsFor.looked(lighthouse, looked())
    const unfinished = harness()
    unfinished.waitsFor.looked(lighthouse, looked({ complete: false }))
    await flush()
    expect([...off.waits, ...unfinished.waits]).toEqual([])
  })

  it('asks for a look a moment after mail, and does nothing at the end of its lease', async () => {
    const h = harness()
    h.waitsFor.looked(lighthouse, looked())
    await flush()
    h.waits[0]?.answer({ ok: true, value: { type: 'waited', why: 'lease' } })
    await h.pass(5000)
    expect(h.cues()).toBe(0)
    h.waitsFor.looked(lighthouse, looked())
    await flush()
    h.waits[1]?.answer({ ok: true, value: { type: 'waited', why: 'mail' } })
    await flush()
    // A random moment first, at most two seconds.
    expect(h.cues()).toBe(0)
    await h.pass(2000)
    expect(h.cues()).toBe(1)
  })

  it('asks a Lighthouse from before waits nothing more for a while', async () => {
    const h = harness()
    h.waitsFor.looked(lighthouse, looked())
    await flush()
    h.waits[0]?.answer({ ok: true, value: { type: 'error', error: 'malformed' } })
    await flush()
    h.waitsFor.looked(lighthouse, looked())
    await flush()
    expect(h.waits).toHaveLength(1)
  })

  it('opens a dropped wait again while on screen, after a few seconds, with the same tags', async () => {
    const h = harness()
    h.waitsFor.looked(lighthouse, looked())
    await flush()
    h.waits[0]?.answer({ ok: false, error: 'unreachable' })
    await flush()
    await h.pass(REOPEN_FIRST_MS - 1)
    expect(h.waits).toHaveLength(1)
    await h.pass(1)
    expect(h.waits[1]?.request).toMatchObject({ type: 'wait', tags: [tag(3), tag(2)], cursor: 41 })
  })

  it('leaves a dropped wait off screen, and one closed for room until the next look', async () => {
    const hidden = harness({ visible: () => false })
    hidden.waitsFor.looked(lighthouse, looked())
    await flush()
    hidden.waits[0]?.answer({ ok: false, error: 'unreachable' })
    await hidden.pass(10 * 60 * 1000)
    expect(hidden.waits).toHaveLength(1)

    const room = harness()
    room.waitsFor.looked(lighthouse, looked())
    await flush()
    room.waits[0]?.answer({ ok: false, error: 'room' })
    await room.pass(10 * 60 * 1000)
    expect(room.waits).toHaveLength(1)
    room.waitsFor.looked(lighthouse, looked())
    await flush()
    expect(room.waits).toHaveLength(2)
  })

  it('closes the connection of a wait standing when waiting is turned off', async () => {
    const h = harness()
    h.waitsFor.looked(lighthouse, looked())
    await flush()
    h.waitsFor.stop()
    expect(h.closed()).toBe(1)
    // Its answer, if one comes after all, asks for nothing.
    h.waits[0]?.answer({ ok: true, value: { type: 'waited', why: 'mail' } })
    await h.pass(5000)
    expect(h.cues()).toBe(0)
  })
})
