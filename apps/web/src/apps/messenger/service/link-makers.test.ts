// A device taken off your list keeps every invite link it heard of, with its secret and claim key,
// can still write cards for them on the list from before, and can tell your other devices anything
// about its links while it is still on the list. A link names the device that made it and when it
// ends, so whoever opens it takes cards and an `added` only from that device, and nothing through
// it after its end. These are the ways a removed device could add someone as you, each refused,
// and what is left: its own links, until each one's end, at most a week.
import {
  decodeInviteLink,
  encodeInviteLinkFragment,
  INVITE_LINK_CLOCK_SLACK,
  MAX_INVITE_LINK_LIFETIME,
} from '@pigeon/core'
import { createMemoryNetwork, flush } from '@pigeon/core/testing'
import { describe, expect, it } from 'vitest'
import type { Clock } from '../../../platform/clock/clock.ts'
import {
  apart,
  asks,
  away,
  laptopAndPhone,
  made,
  messenger,
  only,
  type TestLighthouse,
} from '../testing/messengers.ts'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

type Pigeon = Awaited<ReturnType<typeof messenger>>
type Stored = Record<string, unknown>

/**
 * A removed device's Pigeon brought back on a network of its own, reading the Lighthouse's mail
 * only from `cursor` on, past everything put so far unless given, so it never hears it was
 * removed: what someone who kept it can do. `edit` changes the links it keeps first.
 */
async function thief(
  device: Pigeon,
  clock: Clock,
  lighthouse: TestLighthouse,
  edit: (links: Stored[]) => Stored[] = (links) => links,
  cursor = lighthouse.lastSeq(),
) {
  await device.store.set('mail-fetched', {
    [lighthouse.address.id]: { cursor, at: clock.now() },
  })
  const links = ((await device.store.get('invite-links')) ?? []) as Stored[]
  await device.store.set('invite-links', edit(links))
  const back = await messenger(createMemoryNetwork(), 'rook-phone', {
    clock,
    lighthouse,
    store: device.store,
  })
  await flush(400)
  return back
}

async function mikaAt(clock: Clock, lighthouse: TestLighthouse) {
  const mika = await messenger(createMemoryNetwork(), 'mika', { clock, lighthouse })
  await mika.messenger.setProfile({ handle: 'Mika', status: 'online', message: '' })
  return mika
}

/** The phone's Pigeon, closed, keeps `edit` of its links, and opens again on its own network. */
async function phoneKeeps(
  phone: Pigeon,
  clock: Clock,
  lighthouse: TestLighthouse,
  network: ReturnType<typeof createMemoryNetwork>,
  edit: (links: Stored[]) => Stored[],
) {
  await phone.messenger.close()
  await flush(400)
  const links = ((await phone.store.get('invite-links')) ?? []) as Stored[]
  await phone.store.set('invite-links', edit(links))
  const back = await messenger(network, 'rook-phone', { clock, lighthouse, store: phone.store })
  await flush(400)
  return back
}

/** `link` as the thief keeps it, its card to be put again at every Lighthouse, lasting to `until`. */
const stretch = (link: Stored, lighthouse: TestLighthouse, until: number): Stored => ({
  ...link,
  expires: until,
  open: true,
  behind: [lighthouse.address.id],
})

/** The thief's Pigeon looks for requests through `secret`'s link, and adds whoever asked. */
async function thiefAdds(back: Pigeon, secret: string) {
  await back.messenger.checkMail()
  await flush(400)
  const link = back.messenger.inviteLinks().find((one) => one.secret === secret)
  const request = only(link?.requests ?? [])
  expect(await back.messenger.approveRequest(secret, request.identity)).toBe(true)
  await flush(400)
}

/** A link like `url`, made to end at `end` instead. */
function endingAt(url: string, end: number): string {
  const decoded = decodeInviteLink(url)
  if (!decoded.ok) throw new Error(decoded.error)
  return `https://pigeon.test/#${encodeInviteLinkFragment({ ...decoded.value, end })}`
}

/** What the phone, hostile while still on the list, tells the laptop of its own link. */
type Forgery = 'omit' | 'early' | 'shut'

const FORGERIES: Record<Forgery, (link: Stored) => Stored[]> = {
  // Its next list leaves the link out.
  omit: () => [],
  // The link ends yesterday, as far as the list says.
  early: (link) => [{ ...link, expires: (link['madeAt'] as number) - DAY }],
  // The link is no longer open, as far as the list says.
  shut: (link) => [{ ...link, open: false }],
}

/**
 * The phone makes a link for a week and, still on the list, tells the laptop `forgery` of it. The
 * laptop then removes the phone. The thief keeps the real link.
 */
async function forgedThenRemoved(forgery: Forgery) {
  const { network, clock, lighthouse, laptop, phone } = await laptopAndPhone()
  const link = await made(phone)
  await flush(400)
  const real = only((await phone.store.get('invite-links')) as Stored[])
  const lying = await phoneKeeps(phone, clock, lighthouse, network, () => FORGERIES[forgery](real))
  await lying.messenger.setLighthouses([lighthouse.address])
  await flush(400)
  await laptop.messenger.checkMail()
  await flush(400)
  await away(lying)
  await laptop.messenger.removeDevice(phone.messenger.device)
  await flush(400)
  await laptop.messenger.checkMail()
  await flush(400)
  return { clock, lighthouse, laptop, phone: lying, link, real }
}

describe("a removed device's own links, whatever it said of them", () => {
  for (const forgery of ['omit', 'early', 'shut'] as const) {
    it(`opens none after its end, its card stretched, when its list said ${forgery}`, async () => {
      const { clock, lighthouse, phone, link, real } = await forgedThenRemoved(forgery)
      // Mika is shown the phone's card before the link ends, and asks only after.
      const mika = await mikaAt(clock, lighthouse)
      const opened = await mika.messenger.openInviteLink(link.url)
      if (!opened.ok) throw new Error(opened.error)
      await clock.tick(link.expires - clock.now())
      // The thief moves its own copy of the end on a week, and puts its card again.
      const back = await thief(phone, clock, lighthouse, () => [
        stretch(real, lighthouse, clock.now() + 7 * DAY),
      ])
      await back.messenger.checkMail()
      await flush(400)
      const before = lighthouse.lastSeq()
      expect(await mika.messenger.askThroughLink(opened)).toBe('expired')
      expect(lighthouse.lastSeq()).toBe(before)
      expect(mika.messenger.sentAsks()).toEqual([])
      // Opened again, the link has ended, whatever its card says.
      expect(await mika.messenger.openInviteLink(link.url)).toEqual({
        ok: false,
        error: 'expired',
      })
      await back.messenger.checkMail()
      expect(only(back.messenger.inviteLinks()).requests).toEqual([])
      expect(mika.messenger.friends()).toEqual([])
    })
  }

  it('works for the thief until its end, and not after, when it was never told of', async () => {
    const { clock, lighthouse, laptop, phone } = await laptopAndPhone()
    const link = await made(phone, { lifetime: DAY, uses: 5 })
    await flush(400)
    // The laptop removes the phone before ever hearing of the link.
    await away(phone)
    await laptop.messenger.removeDevice(phone.messenger.device)
    await flush(400)
    await laptop.messenger.checkMail()
    await flush(400)
    expect(laptop.messenger.inviteLinksElsewhere()).toEqual([])
    const back = await thief(phone, clock, lighthouse)
    // Accepted: before its end, the thief adds Mika as Rook through a link it made.
    const mika = await mikaAt(clock, lighthouse)
    await asks(mika, link.url)
    await thiefAdds(back, link.secret)
    await mika.messenger.checkMail()
    await flush(400)
    expect(only(mika.messenger.friends()).id).toBe(laptop.messenger.self)
    // After its end, nobody else gets in, the thief's card stretched or not.
    await back.messenger.close()
    await clock.tick(link.expires - clock.now())
    const late = await thief(phone, clock, lighthouse, (links) =>
      links.map((one) => stretch(one, lighthouse, clock.now() + 7 * DAY)),
    )
    await late.messenger.checkMail()
    await flush(400)
    const lena = await messenger(createMemoryNetwork(), 'lena', { clock, lighthouse })
    await lena.messenger.setProfile({ handle: 'Lena', status: 'online', message: '' })
    expect(await lena.messenger.openInviteLink(link.url)).toEqual({ ok: false, error: 'expired' })
  })
})

describe("another device's links, after a removal", () => {
  /**
   * The laptop makes a link the phone hears of, and Mika is shown its card while the phone is
   * still on the list. The phone is removed, and the thief keeps the laptop's link as if it were
   * its own, so its Pigeon puts cards for it and answers through it.
   */
  async function theirsKeptByThief(options: { listedAsOwn?: boolean } = {}) {
    const { network, clock, lighthouse, laptop, phone } = await laptopAndPhone()
    // A Lighthouse from before claims keeps every card unclaimed, so none is read ahead of
    // another for being claimed: the newest is read first.
    if (options.listedAsOwn === true) lighthouse.unclaimed(true)
    const link = await made(laptop)
    await flush(400)
    await phone.messenger.checkMail()
    await flush(400)
    const heard = only(phone.messenger.inviteLinksElsewhere())
    const asOwn: Stored = {
      secret: heard.secret,
      drop: 'a'.repeat(52),
      cards: {},
      behind: [lighthouse.address.id],
      madeAt: clock.now(),
      expires: link.expires,
      uses: 5,
      used: 0,
      open: true,
      url: link.url,
      requests: [],
      closedAnswers: 0,
    }
    let current = phone
    if (options.listedAsOwn === true) {
      // Still on the list, the phone tells the laptop the link is its own, ending six days early,
      // and puts an open card for it on the same list as the laptop's, read before the laptop's.
      const early = { ...asOwn, expires: link.expires - 6 * DAY }
      current = await phoneKeeps(phone, clock, lighthouse, network, (links) => [...links, early])
      await current.messenger.setLighthouses([lighthouse.address])
      await flush(400)
      await laptop.messenger.checkMail()
      await flush(400)
      expect(only(laptop.messenger.inviteLinksElsewhere()).secret).toBe(link.secret)
      // Its card put again last, so it's the first read, on the same list as the laptop's.
      current = await phoneKeeps(current, clock, lighthouse, network, (links) =>
        links.map((one) =>
          one['secret'] === link.secret ? { ...one, behind: [lighthouse.address.id] } : one,
        ),
      )
      await current.messenger.checkMail()
      await flush(400)
    }
    const mika = await mikaAt(clock, lighthouse)
    const opened = await mika.messenger.openInviteLink(link.url)
    if (!opened.ok) throw new Error(opened.error)
    expect(opened.card.from).toBe(laptop.messenger.device)
    await away(current)
    await laptop.messenger.removeDevice(phone.messenger.device)
    await flush(400)
    await laptop.messenger.checkMail()
    await flush(400)
    await away(laptop)
    const back = await thief(current, clock, lighthouse, (links) => [
      ...links.filter((one) => one['secret'] !== link.secret),
      stretch(asOwn, lighthouse, link.expires),
    ])
    await back.messenger.checkMail()
    await flush(400)
    return { clock, lighthouse, laptop, back, mika, opened, link }
  }

  it("refuses the thief's `added` through a link the laptop made", async () => {
    const { clock, lighthouse, laptop, back, mika, opened, link } = await theirsKeptByThief()
    expect(await mika.messenger.askThroughLink(opened)).toBe('sent')
    await thiefAdds(back, link.secret)
    await mika.messenger.checkMail()
    await flush(400)
    expect(mika.messenger.friends()).toEqual([])
    expect(only(mika.messenger.sentAsks()).state).toBe('waiting')
    // The laptop, which made the link, still adds her.
    const started = await messenger(createMemoryNetwork(), 'rook', {
      clock,
      lighthouse,
      store: laptop.store,
    })
    await flush(400)
    await started.messenger.checkMail()
    await flush(400)
    const request = only(only(started.messenger.inviteLinks()).requests)
    expect(await started.messenger.approveRequest(link.secret, request.identity)).toBe(true)
    await flush(400)
    await mika.messenger.checkMail()
    await flush(400)
    expect(only(mika.messenger.friends()).id).toBe(laptop.messenger.self)
  })

  it("ignores the thief's no on a link the laptop made, and the laptop still adds", async () => {
    const { clock, lighthouse, laptop, back, mika, opened, link } = await theirsKeptByThief()
    expect(await mika.messenger.askThroughLink(opened)).toBe('sent')
    await back.messenger.checkMail()
    await flush(400)
    const asked = back.messenger.inviteLinks().find((one) => one.secret === link.secret)
    await back.messenger.declineRequest(link.secret, only(asked?.requests ?? []).identity)
    await flush(400)
    await mika.messenger.checkMail()
    await flush(400)
    expect(only(mika.messenger.sentAsks()).state).toBe('waiting')
    const started = await messenger(createMemoryNetwork(), 'rook', {
      clock,
      lighthouse,
      store: laptop.store,
    })
    await flush(400)
    await started.messenger.checkMail()
    await flush(400)
    const request = only(only(started.messenger.inviteLinks()).requests)
    expect(await started.messenger.approveRequest(link.secret, request.identity)).toBe(true)
    await flush(400)
    await mika.messenger.checkMail()
    await flush(400)
    expect(only(mika.messenger.friends()).id).toBe(laptop.messenger.self)
  })

  it("refuses the thief's card and `added` when its list called the laptop's link its own", async () => {
    const { clock, lighthouse, back, mika, opened, link } = await theirsKeptByThief({
      listedAsOwn: true,
    })
    // Opened afresh, the thief's cards are there, and only the laptop's is taken.
    const lena = await messenger(createMemoryNetwork(), 'lena', { clock, lighthouse })
    await lena.messenger.setProfile({ handle: 'Lena', status: 'online', message: '' })
    const again = await lena.messenger.openInviteLink(link.url)
    expect(again.ok && again.card.from).toBe(opened.card.from)
    expect(await mika.messenger.askThroughLink(opened)).toBe('sent')
    await thiefAdds(back, link.secret)
    await mika.messenger.checkMail()
    await flush(400)
    expect(mika.messenger.friends()).toEqual([])
    expect(only(mika.messenger.sentAsks()).state).toBe('waiting')
  })

  it('keeps working once another device is removed', async () => {
    const { clock, lighthouse, laptop, phone } = await laptopAndPhone()
    const link = await made(laptop)
    await flush(400)
    await phone.messenger.checkMail()
    await flush(400)
    await away(phone)
    await laptop.messenger.removeDevice(phone.messenger.device)
    await flush(400)
    await laptop.messenger.checkMail()
    await flush(400)
    expect(only(laptop.messenger.inviteLinks()).open).toBe(true)
    const mika = await mikaAt(clock, lighthouse)
    const opened = await asks(mika, link.url)
    // Its card says the list as it is now, without the phone.
    expect(opened.card.keys.map((key) => key.device)).toEqual([laptop.messenger.device])
    await clock.tick(30_000)
    await laptop.messenger.checkMail()
    await flush(400)
    const request = only(only(laptop.messenger.inviteLinks()).requests)
    expect(await laptop.messenger.approveRequest(link.secret, request.identity)).toBe(true)
    await flush(400)
    await mika.messenger.checkMail()
    await flush(400)
    expect(only(mika.messenger.friends()).id).toBe(laptop.messenger.self)
  })
})

describe('when a link ends', () => {
  it('refuses a card that says it lasts longer than the link, before the link ends', async () => {
    const { clock, lighthouse, laptop, phone } = await laptopAndPhone()
    const link = await made(phone)
    await flush(400)
    await away(phone)
    await laptop.messenger.removeDevice(phone.messenger.device)
    await flush(400)
    // The thief moves its own copy of the end on a week, and puts its card again in place of the
    // one that ended with the link.
    const back = await thief(phone, clock, lighthouse, (links) =>
      links.map((one) => stretch(one, lighthouse, link.expires + 7 * DAY)),
    )
    await back.messenger.checkMail()
    await flush(400)
    const mika = await mikaAt(clock, lighthouse)
    expect(await mika.messenger.openInviteLink(link.url)).toEqual({
      ok: false,
      error: 'not-found',
    })
  })

  it('refuses to ask through a card shown before the end, once the end has come', async () => {
    const { clock, lighthouse, laptop, phone } = await laptopAndPhone()
    const link = await made(phone, { lifetime: DAY, uses: 5 })
    await flush(400)
    const mika = await mikaAt(clock, lighthouse)
    const opened = await mika.messenger.openInviteLink(link.url)
    if (!opened.ok) throw new Error(opened.error)
    await away(phone)
    await laptop.messenger.removeDevice(phone.messenger.device)
    await flush(400)
    await clock.tick(DAY)
    await clock.tick(HOUR)
    const before = lighthouse.lastSeq()
    expect(await mika.messenger.askThroughLink(opened)).toBe('expired')
    expect(lighthouse.lastSeq()).toBe(before)
    expect(mika.messenger.sentAsks()).toEqual([])
  })

  it('refuses a link that says it ends more than a week and a day from now', async () => {
    const { clock, lighthouse, rook, mika } = await apart()
    const link = await made(rook)
    await rook.messenger.close()
    const far = link.expires + 30 * DAY
    // Rook's own copy is moved on, and its card put again to say so.
    const links = (await rook.store.get('invite-links')) as Stored[]
    await rook.store.set('invite-links', [stretch(only(links), lighthouse, far)])
    const back = await messenger(createMemoryNetwork(), 'rook', {
      clock,
      lighthouse,
      store: rook.store,
    })
    await flush(400)
    await back.messenger.checkMail()
    await flush(400)
    const url = endingAt(link.url, far)
    expect(await mika.messenger.openInviteLink(url)).toEqual({ ok: false, error: 'too-long' })
    // In its last week, and a day, it opens.
    await clock.tick(far - MAX_INVITE_LINK_LIFETIME - INVITE_LINK_CLOCK_SLACK - clock.now())
    const opened = await mika.messenger.openInviteLink(url)
    expect(opened.ok && opened.card.name).toBe('Rook')
  })

  it('closes your own link made by an older Pigeon when it starts, adding nobody through it', async () => {
    const { clock, lighthouse, rook, mika } = await apart()
    const link = await made(rook)
    await asks(mika, link.url)
    await clock.tick(30_000)
    await flush(400)
    expect(only(only(rook.messenger.inviteLinks()).requests).state).toBe('waiting')
    await rook.messenger.close()
    // As a link made before links named their maker and end is kept.
    const old = `https://pigeon.test/#a/${'b'.repeat(26)}${'c'.repeat(26)}`
    const links = (await rook.store.get('invite-links')) as Stored[]
    await rook.store.set('invite-links', [{ ...only(links), url: old }])
    const back = await messenger(createMemoryNetwork(), 'rook', {
      clock,
      lighthouse,
      store: rook.store,
    })
    await flush(400)
    const kept = only(back.messenger.inviteLinks())
    expect(kept.open).toBe(false)
    expect(only(kept.requests).state).toBe('closed')
    expect(await back.messenger.approveRequest(link.secret, mika.messenger.self)).toBe(false)
  })

  it('leaves an add Pigeon closed in the middle of unfinished on your own old link', async () => {
    const { clock, lighthouse, rook, mika } = await apart()
    const link = await made(rook)
    await asks(mika, link.url)
    await clock.tick(30_000)
    await flush(400)
    await rook.messenger.close()
    // Add was chosen on a link made before links named their maker and end, and Pigeon closed
    // before the answer went: kept as `adding`, with its pair secret.
    const old = `https://pigeon.test/#a/${'b'.repeat(26)}${'c'.repeat(26)}`
    const links = (await rook.store.get('invite-links')) as Stored[]
    const kept = only(links)
    const requests = (kept['requests'] as Stored[]).map((request) => ({
      ...request,
      state: 'adding',
      pairSecret: 'a'.repeat(52),
    }))
    await rook.store.set('invite-links', [{ ...kept, url: old, requests, used: 1 }])
    const back = await messenger(createMemoryNetwork(), 'rook', {
      clock,
      lighthouse,
      store: rook.store,
    })
    await flush(400)
    expect(back.messenger.friends()).toEqual([])
    expect(only(only(back.messenger.inviteLinks()).requests).state).toBe('closed')
  })

  it('refuses a link made by an older Pigeon', async () => {
    const { mika } = await apart()
    const old = `https://pigeon.test/#a/${'b'.repeat(26)}${'c'.repeat(26)}`
    expect(await mika.messenger.openInviteLink(old)).toEqual({ ok: false, error: 'retired' })
  })
})
