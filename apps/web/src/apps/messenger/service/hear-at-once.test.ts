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
  return { clock, rook, mika }
}

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

  it('keeps waiting turned off, and turns it on again', async () => {
    const { mika } = await friendsApart()
    expect(mika.messenger.settings().hearAtOnce).toBeUndefined()
    await mika.messenger.setHearAtOnce(false)
    expect(mika.messenger.settings()).toMatchObject({ hearAtOnce: false })
    await mika.messenger.setHearAtOnce(true)
    expect(mika.messenger.settings()).toMatchObject({ hearAtOnce: true })
  })
})
