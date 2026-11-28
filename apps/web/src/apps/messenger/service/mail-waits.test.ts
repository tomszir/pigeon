// Hearing about mail at once: when a wait is left, with which tags, cursor and lease, what each
// answer does, and when a dropped wait is opened again.
import type { LighthouseAddress, LighthouseClient, LighthouseRequest } from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import type { Looked } from './look.ts'
import { createMailWaits, EMPTY_CUE_HOLD_MS, REOPEN_FIRST_MS, waitTags } from './mail-waits.ts'

const lighthouse: LighthouseAddress = { id: 'lh' as never, name: 'Harbour', url: 'wss://h.test/' }
const NOON = Date.UTC(2026, 10, 27, 12)
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

type Answer = Awaited<ReturnType<LighthouseClient['request']>>

/** A clock that moves only when told, a client that holds each wait until it's answered. */
function harness(
  options: {
    on?: () => boolean
    visible?: () => boolean
    listed?: () => boolean
    nextLook?: () => number
  } = {},
) {
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
    listed: options.listed ?? (() => true),
    cue: () => {
      cues += 1
    },
    nextLook: options.nextLook ?? (() => 7 * 60 * 1000),
    closed: () => false,
  })
  return {
    waits,
    waitsFor,
    /** A look that takes something that counts, or nothing. */
    looks: (took: boolean) =>
      waitsFor.look(async (count) => {
        if (took) await count.take(async () => true)()
      }),
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

  it('asks for a look a moment after mail, and never at the end of its lease', async () => {
    const h = harness()
    h.waitsFor.looked(lighthouse, looked())
    await flush()
    h.waits[0]?.answer({ ok: true, value: { type: 'waited', why: 'lease' } })
    await h.pass(5000)
    expect(h.cues()).toBe(0)
    h.waitsFor.looked(lighthouse, looked())
    await flush()
    h.waits.at(-1)?.answer({ ok: true, value: { type: 'waited', why: 'mail' } })
    await flush()
    // A random moment first, at most two seconds.
    expect(h.cues()).toBe(0)
    await h.pass(2000)
    expect(h.cues()).toBe(1)
  })

  it('holds back cues whose looks took nothing, longer each time, until one takes mail', async () => {
    const h = harness()
    /** A look, then `mail` at once (junk put under a tag it waits on), then that cue's look. */
    const junk = async (n: number, took: boolean, after: number) => {
      h.waitsFor.looked(lighthouse, looked())
      await flush()
      h.waits[n]?.answer({ ok: true, value: { type: 'waited', why: 'mail' } })
      await flush()
      const before = h.cues()
      await h.pass(after - 1)
      const early = h.cues() > before
      await h.pass(1)
      if (h.cues() > before) await h.looks(took)
      return { early, cued: h.cues() > before }
    }
    expect(await junk(0, false, 2000)).toEqual({ early: false, cued: true })
    // The next cue waits a minute, the one after two, however often junk comes.
    expect(await junk(1, false, EMPTY_CUE_HOLD_MS + 2000)).toEqual({ early: false, cued: true })
    expect(await junk(2, true, 2 * EMPTY_CUE_HOLD_MS + 2000)).toEqual({ early: false, cued: true })
    // That look took mail: cues come at once again.
    expect(await junk(3, false, 2000)).toEqual({ early: false, cued: true })
  })

  it('holds a Lighthouse that says mail to every wait to a few looks in half an hour', async () => {
    const h = harness()
    let looks = 0
    // Each cue brings a look that takes nothing, and the wait after it hears `mail` at once.
    for (let second = 0; second < 30 * 60; second++) {
      if (h.cues() > looks) {
        looks = h.cues()
        await h.looks(false)
      }
      const standing = h.waits.length
      if (second === 0 || looks > 0) h.waitsFor.looked(lighthouse, looked())
      await flush()
      for (const wait of h.waits.slice(standing))
        wait.answer({ ok: true, value: { type: 'waited', why: 'mail' } })
      await h.pass(1000)
    }
    // At once, then after one, two, four, eight and ten minutes: the schedule's own pace.
    expect(h.cues()).toBeGreaterThanOrEqual(5)
    expect(h.cues()).toBeLessThanOrEqual(7)
  })

  it('waits again to the next look when a lease ends well before it', async () => {
    // An invite's 30-second tick sets the first lease; the invite is answered, and the next look
    // is the schedule's, minutes away.
    let next = 30_000
    const h = harness({ nextLook: () => next })
    h.waitsFor.looked(lighthouse, looked())
    await flush()
    expect(h.waits[0]?.request).toMatchObject({ seconds: 30 })
    next = 9 * 60 * 1000
    h.waits[0]?.answer({ ok: true, value: { type: 'waited', why: 'lease' } })
    await flush()
    expect(h.waits[1]?.request).toMatchObject({ type: 'wait', cursor: 41, seconds: 540 })
  })

  it('waits again to the next look after a lease cut to a moment as a timer’s look began', async () => {
    // A cue's look reads the Lighthouse just as the timer's look comes due and joins it: the lease
    // is a second. Once that look is under way the next is the schedule's, ten minutes on.
    let next = 0
    const h = harness({ nextLook: () => next })
    h.waitsFor.looked(lighthouse, looked())
    await flush()
    expect(h.waits[0]?.request).toMatchObject({ seconds: 1 })
    next = 10 * 60 * 1000
    await h.pass(1000)
    h.waits[0]?.answer({ ok: true, value: { type: 'waited', why: 'lease' } })
    await flush()
    expect(h.waits[1]?.request).toMatchObject({ type: 'wait', seconds: 600 })
  })

  it('doesn’t wait again when the next look is about to come', async () => {
    const h = harness({ nextLook: () => 2000 })
    h.waitsFor.looked(lighthouse, looked())
    await flush()
    h.waits[0]?.answer({ ok: true, value: { type: 'waited', why: 'lease' } })
    await flush()
    expect(h.waits).toHaveLength(1)
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
    await flush()
    await hidden.pass(4 * REOPEN_FIRST_MS)
    expect(hidden.waits).toHaveLength(1)

    const room = harness()
    room.waitsFor.looked(lighthouse, looked())
    await flush()
    room.waits[0]?.answer({ ok: false, error: 'room' })
    await flush()
    await room.pass(4 * REOPEN_FIRST_MS)
    expect(room.waits).toHaveLength(1)
    room.waitsFor.looked(lighthouse, looked())
    await flush()
    expect(room.waits).toHaveLength(2)
  })

  it('waits at no Lighthouse a look read after it was taken off your list', async () => {
    let listed = true
    const h = harness({ listed: () => listed })
    // The look began with it on the list; it was removed before the look said what it read.
    listed = false
    h.waitsFor.retain([])
    h.waitsFor.looked(lighthouse, looked())
    await flush()
    expect(h.waits).toEqual([])
  })

  it('counts a receipt for waiting mail as something taken, so a reply after it isn’t held back', async () => {
    const h = harness()
    h.waitsFor.looked(lighthouse, looked())
    await flush()
    h.waits[0]?.answer({ ok: true, value: { type: 'waited', why: 'mail' } })
    await flush()
    await h.pass(2000)
    // The cue's look brings only the receipt for a letter of yours.
    await h.waitsFor.look(async (count) => count.answered())
    h.waitsFor.looked(lighthouse, looked())
    await flush()
    h.waits.at(-1)?.answer({ ok: true, value: { type: 'waited', why: 'mail' } })
    await flush()
    await h.pass(2000)
    expect(h.cues()).toBe(2)
  })

  it('counts a look that failed as one that took nothing', async () => {
    const h = harness()
    h.waitsFor.looked(lighthouse, looked())
    await flush()
    h.waits[0]?.answer({ ok: true, value: { type: 'waited', why: 'mail' } })
    await flush()
    await h.pass(2000)
    expect(h.cues()).toBe(1)
    await h.waitsFor
      .look(async () => {
        throw new Error('the store failed')
      })
      .catch(() => undefined)
    h.waitsFor.looked(lighthouse, looked())
    await flush()
    h.waits[1]?.answer({ ok: true, value: { type: 'waited', why: 'mail' } })
    await flush()
    await h.pass(2000)
    // Held back like any cue after a look that took nothing.
    expect(h.cues()).toBe(1)
  })

  it('ends the wait at a Lighthouse taken off your list, and never opens it again', async () => {
    const h = harness()
    h.waitsFor.looked(lighthouse, looked())
    await flush()
    h.waitsFor.retain([])
    expect(h.closed()).toBe(1)
    h.waits[0]?.answer({ ok: false, error: 'unreachable' })
    await flush()
    await h.pass(4 * REOPEN_FIRST_MS)
    expect(h.waits).toHaveLength(1)
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
