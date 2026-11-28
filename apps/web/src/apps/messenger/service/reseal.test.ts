// A letter put again is sealed again to its recipient's devices as they are then: a device
// linked since gets it, and one removed since doesn't. Here for your own devices, which hear of
// each other's keys by mail; the mailbox's own tests cover a friend's.
import { base32Decode, mailTag, openMail, utcDate } from '@pigeon/core'
import { createMemoryNetwork, fakeCrypto, fakeSealCrypto, flush } from '@pigeon/core/testing'
import { describe, expect, it } from 'vitest'
import {
  away,
  fakeClock,
  linkDevice,
  messenger,
  NOON,
  only,
  pairWith,
  type TestLighthouse,
  testLighthouse,
} from '../testing/messengers.ts'
import { RESEND_AFTER_MS } from './mailbox.ts'

type Side = Awaited<ReturnType<typeof messenger>>
const DAY = 24 * 60 * 60 * 1000

/** Rook's laptop and Mika, friends, at one Lighthouse. */
async function rookAndMika() {
  const network = createMemoryNetwork()
  const clock = fakeClock(NOON)
  const lighthouse = testLighthouse(clock)
  const laptop = await messenger(network, 'rook', { clock, lighthouse })
  const mika = await messenger(network, 'mika', { clock, lighthouse })
  await pairWith(laptop, mika)
  await flush(400)
  return { network, clock, lighthouse, laptop, mika }
}

/** `side`'s Pigeon started again on a network of its own: only Lighthouses reach it. */
const startApart = (
  name: string,
  side: Side,
  clock: ReturnType<typeof fakeClock>,
  lighthouse: TestLighthouse,
) => messenger(createMemoryNetwork(), name, { clock, lighthouse, store: side.store })

/** How many blobs of `kind` to `to` under `secret`'s tags today the device `name` opens. */
async function lettersFor(
  lighthouse: TestLighthouse,
  secret: string,
  to: string,
  name: string,
  now: number,
  kind: 'letter' | 'self' = 'letter',
) {
  const client = lighthouse.client(lighthouse.address)
  const bytes = base32Decode(secret)
  if (!bytes.ok) throw new Error('not base32')
  const tag = await mailTag(fakeCrypto, bytes.value, to, utcDate(now))
  const listed = await client.request({ type: 'list', tags: [tag], cursor: 0 })
  if (!listed.ok || listed.value.type !== 'listed') throw new Error('no list')
  let opened = 0
  for (const item of listed.value.items) {
    const got = await client.request({ type: 'get', id: item.id })
    if (!got.ok || got.value.type !== 'blob') continue
    const open = await openMail(
      fakeCrypto,
      fakeSealCrypto(),
      fakeSealCrypto().sealer(name),
      got.value.blob,
      { to, kinds: [kind], dates: [utcDate(now)] },
    )
    if (open.ok) opened += 1
  }
  return opened
}

/** One of Rook's devices writes to Mika while she and his other devices are away. */
async function writesAlone(clock: ReturnType<typeof fakeClock>, device: Side, text: string) {
  await device.messenger.send(only(device.messenger.friends()).id, text)
  await clock.tick(5000)
  await flush(400)
}

describe('a letter put again', () => {
  it('reaches a device of yours linked since it was first put', async () => {
    const { network, clock, lighthouse, laptop, mika } = await rookAndMika()
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock, lighthouse)
    const { device: ipad } = await linkDevice(network, laptop, 'rook-ipad', clock, lighthouse)
    await flush(400)
    // The iPad goes away for good, so the copy below waits on it however long.
    for (const side of [mika, ipad, laptop]) await away(side)
    await writesAlone(clock, phone, 'before the tablet')
    await away(phone)

    // The laptop links a tablet while its Lighthouse can't be reached, so neither has the copy
    // when they meet, and the tablet goes before the laptop takes it.
    lighthouse.down(true)
    const back = await messenger(network, 'rook', { clock, lighthouse, store: laptop.store })
    const { device: tablet } = await linkDevice(network, back, 'rook-tablet', clock, lighthouse)
    await flush(400)
    await away(tablet)
    lighthouse.down(false)
    // The laptop takes the copy and tells the phone of the tablet, which hears it by mail.
    await back.messenger.checkMail()
    await flush(400)
    await away(back)
    const phoneAgain = await startApart('rook-phone', phone, clock, lighthouse)
    await phoneAgain.messenger.checkMail()
    await flush(400)
    // Days pass with no receipt from the iPad: the copy is put again.
    await clock.tick(RESEND_AFTER_MS + DAY)
    await phoneAgain.messenger.checkMail()
    await flush(400)
    const tabletAgain = await startApart('rook-tablet', tablet, clock, lighthouse)
    await tabletAgain.messenger.checkMail()
    await flush(400)
    expect(only(tabletAgain.messenger.friends()).log.entries.map((entry) => entry.text)).toEqual([
      'before the tablet',
    ])
  })

  it('isn’t sealed to a device of yours removed since it was first put', async () => {
    const { network, clock, lighthouse, laptop, mika } = await rookAndMika()
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock, lighthouse)
    const { device: tablet } = await linkDevice(network, laptop, 'rook-tablet', clock, lighthouse)
    await flush(400)
    for (const side of [mika, phone, tablet]) await away(side)
    const own = (await laptop.store.get('selfSecret')) as string
    await writesAlone(clock, laptop, 'before the removal')
    await laptop.messenger.removeDevice(phone.messenger.device)
    await flush(400)
    await clock.tick(RESEND_AFTER_MS + DAY)
    await laptop.messenger.checkMail()
    await flush(400)
    // Put again today, under the self secret it went under: the tablet opens it, the phone not.
    const self = laptop.messenger.self
    expect(await lettersFor(lighthouse, own, self, 'rook-tablet', clock.now())).toBe(1)
    expect(await lettersFor(lighthouse, own, self, 'rook-phone', clock.now())).toBe(0)
  })

  it('isn’t put again to your only other device once it’s removed', async () => {
    const { network, clock, lighthouse, laptop, mika } = await rookAndMika()
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock, lighthouse)
    await flush(400)
    for (const side of [mika, phone]) await away(side)
    const own = (await laptop.store.get('selfSecret')) as string
    await writesAlone(clock, laptop, 'before the removal')
    await laptop.messenger.removeDevice(phone.messenger.device)
    await flush(400)
    await clock.tick(RESEND_AFTER_MS + DAY)
    await laptop.messenger.checkMail()
    await flush(400)
    // No device of yours is left to seal the copy to: it isn't put to the one removed.
    const self = laptop.messenger.self
    expect(await lettersFor(lighthouse, own, self, 'rook-phone', clock.now())).toBe(0)
  })

  it('puts a removal notice kept from before notices were marked to the removed device', async () => {
    const { network, clock, lighthouse, laptop, mika } = await rookAndMika()
    const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock, lighthouse)
    const { device: tablet } = await linkDevice(network, laptop, 'rook-tablet', clock, lighthouse)
    await flush(400)
    for (const side of [mika, phone, tablet]) await away(side)
    await laptop.messenger.removeDevice(phone.messenger.device)
    await flush(400)
    await away(laptop)
    // The outbox as a Pigeon from before kept it: the notice isn't marked.
    const outbox = (await laptop.store.get('mail-outbox')) as Record<string, unknown>[]
    const notice = outbox.find((letter) => letter['fixed'] === true) as
      | { to: { secret: string } }
      | undefined
    expect(notice).toBeDefined()
    await laptop.store.set(
      'mail-outbox',
      outbox.map(({ fixed: _fixed, ...letter }) => letter),
    )
    const again = await startApart('rook', laptop, clock, lighthouse)
    await clock.tick(RESEND_AFTER_MS + DAY)
    await again.messenger.checkMail()
    await flush(400)
    const self = laptop.messenger.self
    const under = notice?.to.secret ?? ''
    expect(await lettersFor(lighthouse, under, self, 'rook-phone', clock.now(), 'self')).toBe(1)
  })
})
