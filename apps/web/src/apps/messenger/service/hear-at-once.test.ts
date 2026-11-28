// Hearing about mail at once, the whole way: two friends who never meet, both open, sharing only a
// Lighthouse. A message from one reaches the other within seconds, through a wait, long before
// the next scheduled look.
import { createMemoryNetwork, flush } from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import { fakeClock, made, messenger, NOON, only, testLighthouse } from '../testing/messengers.ts'

/** Rook and Mika, friends through a link, then both open on networks of their own. */
async function friendsApart() {
  const clock = fakeClock(NOON)
  const lighthouse = testLighthouse(clock, 'test-lighthouse', { waits: true })
  const rook = await messenger(createMemoryNetwork(), 'rook', { clock, lighthouse })
  const mika = await messenger(createMemoryNetwork(), 'mika', { clock, lighthouse })
  await rook.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
  await mika.messenger.setProfile({ handle: 'Mika', status: 'online', message: '' })
  const link = await made(rook)
  const opened = await mika.messenger.openInviteLink(link.url)
  if (!opened.ok) throw new Error(opened.error)
  await mika.messenger.askThroughLink(opened)
  await clock.tick(60_000)
  await flush(400)
  const request = only(rook.messenger.inviteLinks()).requests[0]
  await rook.messenger.approveRequest(link.secret, request?.identity ?? '')
  await clock.tick(60_000)
  await flush(400)
  return { clock, lighthouse, rook, mika }
}

type Clock = Awaited<ReturnType<typeof friendsApart>>['clock']

/** Seconds until `heard` holds, a second at a time, or Infinity after `most`. */
async function secondsUntil(clock: Clock, heard: () => boolean, most = 300): Promise<number> {
  for (let second = 0; second <= most; second++) {
    if (heard()) return second
    await clock.tick(1000)
    await flush(50)
  }
  return Number.POSITIVE_INFINITY
}

const texts = (friend: {
  messenger: { friends(): readonly { log: { entries: readonly { text?: string }[] } }[] }
}) => only(friend.messenger.friends()).log.entries.map((entry) => entry.text)

describe('hearing about mail at once', () => {
  it('brings a message between two open friends who never meet within seconds', async () => {
    const { clock, rook, mika } = await friendsApart()
    expect(only(mika.messenger.friends()).handle).toBe('Rook')
    // Mika looks once, and waits.
    await mika.messenger.checkMail()
    await flush(200)
    const friend = only(rook.messenger.friends()).id
    await rook.messenger.send(friend, 'are you there?')
    // The letter is put once Rook's own look after sending is done; Mika hears of it at once and
    // looks a moment later: well within a minute, where the schedule's next look is ten away.
    for (let second = 0; second < 40; second++) {
      await clock.tick(1000)
      await flush(50)
    }
    const texts = only(mika.messenger.friends()).log.entries.map((entry) => entry.text)
    expect(texts).toContain('are you there?')
  })

  it('leaves every wait standing until the next scheduled look, look after look', async () => {
    const { clock, lighthouse, rook } = await friendsApart()
    // With no link open, both look every ten minutes.
    for (const link of rook.messenger.inviteLinks())
      await rook.messenger.cancelInviteLink(link.secret)
    await clock.tick(60_000)
    await flush(200)
    const before = lighthouse.leases().length
    for (let second = 0; second < 45 * 60; second += 10) {
      await clock.tick(10_000)
      await flush(20)
    }
    const leases = lighthouse.leases().slice(before)
    // Each lasts to its Pigeon's next look, ten minutes on, never collapsing to a moment.
    expect(leases.length).toBeGreaterThanOrEqual(8)
    for (const lease of leases) expect(lease).toBeGreaterThan(500)
  })

  type Friend = Awaited<ReturnType<typeof friendsApart>>['mika']
  const endings: readonly (readonly [string, (friend: Friend) => Promise<unknown>])[] = [
    ['waiting is turned off', (friend) => friend.messenger.setHearAtOnce(false)],
    ['relay-only is turned on', (friend) => friend.messenger.setRelayOnly(true)],
    ['its Lighthouse is taken off the list', (friend) => friend.messenger.setLighthouses([])],
  ]
  for (const [what, end] of endings)
    it(`ends Mika's standing wait at once when ${what}, and sends no other`, async () => {
      const { clock, lighthouse, rook, mika } = await friendsApart()
      // Rook's link is gone, so Rook waits, and looks, every ten minutes.
      for (const link of rook.messenger.inviteLinks())
        await rook.messenger.cancelInviteLink(link.secret)
      await rook.messenger.checkMail()
      await mika.messenger.checkMail()
      await flush(200)
      expect(lighthouse.standing()).toBe(2)
      await end(mika)
      await flush(200)
      expect(lighthouse.standing()).toBe(1)
      // Look after look, on screen all the while, only Rook's stands.
      for (let second = 0; second < 25 * 60; second += 10) {
        await clock.tick(10_000)
        await flush(20)
        expect(lighthouse.standing()).toBeLessThanOrEqual(1)
      }
    })

  it('brings a second message as quickly as the first: a look that took a letter isn’t empty', async () => {
    const { clock, rook, mika } = await friendsApart()
    await mika.messenger.checkMail()
    await flush(200)
    const friend = only(rook.messenger.friends()).id
    await rook.messenger.send(friend, 'one')
    expect(await secondsUntil(clock, () => texts(mika).includes('one'))).toBeLessThan(40)
    await rook.messenger.send(friend, 'two')
    // Held back a minute, as after a cue whose look took nothing, it would take over sixty.
    expect(await secondsUntil(clock, () => texts(mika).includes('two'))).toBeLessThan(40)
  })

  it('brings a reply as quickly after a receipt: a look that took a receipt isn’t empty', async () => {
    const { clock, rook, mika } = await friendsApart()
    for (const link of rook.messenger.inviteLinks())
      await rook.messenger.cancelInviteLink(link.secret)
    await rook.messenger.checkMail()
    await mika.messenger.checkMail()
    await flush(200)
    const toMika = only(rook.messenger.friends()).id
    await rook.messenger.send(toMika, 'are you there?')
    expect(await secondsUntil(clock, () => texts(mika).includes('are you there?'))).toBeLessThan(40)
    // Mika's receipt brings Rook a look of its own, which takes nothing but that receipt.
    await secondsUntil(clock, () => false, 30)
    await mika.messenger.send(only(mika.messenger.friends()).id, 'here')
    expect(await secondsUntil(clock, () => texts(rook).includes('here'))).toBeLessThan(40)
  })

  it('leaves no wait at a Lighthouse taken off the list while a look read it', async () => {
    const { lighthouse, rook, mika } = await friendsApart()
    for (const link of rook.messenger.inviteLinks())
      await rook.messenger.cancelInviteLink(link.secret)
    await rook.messenger.checkMail()
    // Mika's wait has ended, as it has while a cue's look is under way: turned off and on again.
    await mika.messenger.setHearAtOnce(false)
    await mika.messenger.setHearAtOnce(true)
    await flush(200)
    expect(lighthouse.standing()).toBe(1)
    // Her look is part way through when the Lighthouse leaves her list, and leaves no wait there.
    const listing = lighthouse.holdNext('list')
    const look = mika.messenger.checkMail()
    await listing.reached
    await mika.messenger.setLighthouses([])
    listing.release()
    await look
    await flush(200)
    expect(lighthouse.standing()).toBe(1)
  })

  it('keeps waiting turned off, and turns it on again', async () => {
    const { mika } = await friendsApart()
    expect(mika.messenger.settings().hearAtOnce).toBeUndefined()
    await mika.messenger.setHearAtOnce(false)
    expect(mika.messenger.settings()).toMatchObject({ hearAtOnce: false })
    await mika.messenger.setHearAtOnce(true)
    expect(mika.messenger.settings()).toMatchObject({ hearAtOnce: true })
  })
})
