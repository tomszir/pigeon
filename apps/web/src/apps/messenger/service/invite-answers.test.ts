// The answers to a request sent through someone's invite link, taken one by one as the mailbox
// hands them over. Only the device the link names answers through it, so an answer of any kind
// from another of the inviter's devices, a removed one included, is dropped and the request goes
// on waiting for the maker, even a `closed` whose device log takes the maker off the list, which a
// device a recovery left off can sign on its old epoch.
import {
  appendDeviceEntry,
  base32Encode,
  bindSealingKey,
  type DeviceLog,
  deviceState,
  emptyDeviceLog,
  type InviteCard,
  type InviteLink,
  inviteCardTag,
  type Json,
  type Letter,
  type LighthouseClient,
  linkFingerprint,
  linkMaker,
  recoverDeviceLog,
  setRecoveryKey,
} from '@pigeon/core'
import { fakeCrypto, fakeSealCrypto, fakeSigner } from '@pigeon/core/testing'
import { createRoot } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../../../platform/storage/memory-storage.ts'
import { type LinkFriend, loadInviteLinks, type SentAsk } from './invite-links.ts'
import type { Mailbox, Source } from './mailbox.ts'

const NOW = Date.parse('2026-11-27T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const seal = fakeSealCrypto()
const rook = fakeSigner('rook')
const phone = fakeSigner('rook-phone')
const mika = fakeSigner('mika')
const secret = base32Encode(new Uint8Array(16).fill(7))
const reply = base32Encode(new Uint8Array(16).fill(9))
const pairSecret = base32Encode(new Uint8Array(32).fill(5))
const lighthouse = { id: fakeSigner('loft').id, name: 'Loft', url: 'wss://loft.test/' }

async function logs(): Promise<{ withPhone: DeviceLog; withoutPhone: DeviceLog }> {
  const added = await appendDeviceEntry(
    fakeCrypto,
    emptyDeviceLog(rook.id),
    rook,
    { kind: 'add', device: phone.id, name: 'Phone' },
    1,
  )
  if (!added.ok) throw new Error('no add')
  const removed = await appendDeviceEntry(
    fakeCrypto,
    added.log,
    rook,
    { kind: 'remove', device: phone.id },
    2,
  )
  if (!removed.ok) throw new Error('no remove')
  return { withPhone: added.log, withoutPhone: removed.log }
}

/** Rook's newest log: the phone taken off, and a recovery key committed to. */
async function newest(): Promise<DeviceLog> {
  const { withoutPhone } = await logs()
  const log = await setRecoveryKey(withoutPhone, rook, fakeSigner('rook-recovery').id, 3)
  if (log === undefined) throw new Error('no recovery key')
  return log
}

/**
 * Mika's invite links, with a request through Rook's link waiting, made by `maker`; `log` is
 * Rook's log as the request keeps it, `known` what Mika keeps for Rook apart from it.
 */
async function mikaAsked(
  maker: string,
  state: SentAsk['state'] = 'waiting',
  options: { log?: DeviceLog; known?: DeviceLog; others?: readonly SentAsk[] } = {},
) {
  const keys = [
    await bindSealingKey(rook, seal.sealer('rook')),
    await bindSealingKey(phone, seal.sealer('rook-phone')),
  ]
  const ask: SentAsk = {
    secret,
    identity: rook.id,
    name: 'Rook',
    fingerprint: 'x',
    keys,
    lighthouses: [lighthouse],
    reply,
    expires: NOW + DAY,
    maker,
    at: NOW,
    state,
    ...(options.log === undefined ? {} : { log: options.log }),
  }
  const store = createMemoryStore({ 'invite-asks': [...(options.others ?? []), ask] })
  const sent: Json[] = []
  const befriended: LinkFriend[] = []
  const mailbox = {
    send: async (_kind: string, _to: unknown, body: Json) => {
      sent.push(body)
      return true
    },
  } as unknown as Mailbox
  const links = await createRoot(() =>
    loadInviteLinks({
      crypto: fakeCrypto,
      seal,
      signer: mika,
      self: mika.id,
      store,
      now: () => NOW,
      random: (n) => new Uint8Array(n).fill(sent.length + 1),
      mailbox,
      client: () => ({}) as LighthouseClient,
      official: [lighthouse],
      lighthouses: () => [lighthouse],
      inviteBase: 'https://pigeon.test/',
      name: () => 'Mika',
      deviceLog: () => emptyDeviceLog(mika.id),
      active: () => true,
      ownKeys: async () => [],
      knownLog: async () => options.known,
      isFriend: () => false,
      isBlocked: () => false,
      newSecret: () => pairSecret,
      befriend: async (friend) => {
        befriended.push(friend)
      },
      friendRecipient: async () => undefined,
      changed: () => undefined,
      friendLogHeard: async () => undefined,
      stopped: () => false,
    }),
  )
  return { links, sent, befriended }
}

const source: Source = {
  sender: rook.id,
  secret: reply,
  tags: 'invite-answer',
  kinds: ['invite-answer'],
}

/** `body`, saying it answers the request with reply secret `to` through Rook's link. */
const bound = async (body: Json, to = reply): Promise<Json> => ({
  ...(body as Record<string, Json>),
  reply: to,
  link: await inviteCardTag(fakeCrypto, secret),
})

/** Where the answers to the request just sent come: its own reply secret. */
const sentTo = (sent: Json[]): Source => ({
  ...source,
  secret: (sent[0] as { reply: string }).reply,
})

/** An answer from `from`, of Rook's, as the mailbox hands it over once it holds. */
const answer = (from: string, body: Json): Letter =>
  ({
    kind: 'invite-answer',
    sender: rook.id,
    to: mika.id,
    date: '2026-11-27',
    id: `answer${from.length}`,
    head: {},
    from,
    at: NOW,
    body,
  }) as unknown as Letter

describe('answers through a link only its maker counts', () => {
  for (const kind of ['declined', 'busy', 'closed', 'closed with its log'] as const)
    it(`drops a removed device's ${kind} on another device's link, still waiting`, async () => {
      const { withPhone } = await logs()
      const { links } = await mikaAsked(rook.id)
      const body =
        kind === 'closed with its log'
          ? { answer: 'closed', deviceLog: withPhone }
          : { answer: kind }
      expect(await links.take(source, answer(phone.id, await bound(body as Json)))).toBe(true)
      expect(links.asks()[0]?.state).toBe('waiting')
      expect(links.sources().some((one) => one.secret === reply)).toBe(true)
    })

  it("takes the maker's added after a removed device's declined in the same fetch", async () => {
    const { withoutPhone } = await logs()
    const { links, befriended } = await mikaAsked(rook.id)
    await links.take(source, answer(phone.id, await bound({ answer: 'declined' })))
    const added = { answer: 'added', secret: pairSecret, name: 'Rook', deviceLog: withoutPhone }
    expect(await links.take(source, answer(rook.id, await bound(added as unknown as Json)))).toBe(
      true,
    )
    expect(befriended.map((friend) => friend.id)).toEqual([rook.id])
  })

  it("still takes the maker's own declined", async () => {
    const { links } = await mikaAsked(rook.id)
    await links.take(source, answer(rook.id, await bound({ answer: 'declined' })))
    expect(links.asks()[0]?.state).toBe('declined')
  })

  it('drops a closed from a writer a recovery left off, signed on its old epoch removing the maker', async () => {
    // Variant A: Rook's first device, the writer of epoch 0, is stolen and a recovery leaves it
    // off, keeping the phone, which made the link. Mika opened the link before the recovery, so her
    // request was sealed to the stolen device too. It signs the phone's removal onto its own copy
    // of epoch 0 and answers `closed` with that: before Mika hears of the recovery, the log holds.
    const { withPhone, withoutPhone } = await logs()
    const { links, befriended, sent } = await mikaAsked(phone.id)
    const base = await opened()
    const card = { ...base.card, from: phone.id, deviceLog: withPhone }
    const link = { ...base.link, maker: await linkMaker(fakeCrypto, phone.id) }
    expect(await links.ask({ ok: true, ...base, link, card })).toBe('sent')
    const to = sentTo(sent)
    const closed = { answer: 'closed', deviceLog: withoutPhone } as unknown as Json
    await links.take(to, answer(rook.id, await bound(closed, to.secret)))
    expect(links.asks()[0]?.state).toBe('waiting')
    // the phone's added, after it in the same fetch, is still taken
    const added = { answer: 'added', secret: pairSecret, name: 'Rook', deviceLog: withPhone }
    await links.take(to, answer(phone.id, await bound(added as unknown as Json, to.secret)))
    expect(befriended.map((friend) => friend.id)).toEqual([rook.id])
  })

  it('drops a closed from a removed device replaying an older epoch on which the maker was off', async () => {
    // Variant B: in epoch 0 the phone was taken off; a recovery's epoch 1 keeps Rook, the phone
    // and the tablet. The phone makes the link; Mika asks with the card's epoch-1 log. The tablet,
    // removed since, replays the epoch-0 log, on which it is still on and the phone is off.
    const tablet = fakeSigner('rook-tablet')
    const key = fakeSigner('rook-recovery')
    let log = emptyDeviceLog(rook.id)
    for (const change of [
      { kind: 'add' as const, device: phone.id, name: 'Phone' },
      { kind: 'add' as const, device: tablet.id, name: 'Tablet' },
    ]) {
      const next = await appendDeviceEntry(fakeCrypto, log, rook, change, 1)
      if (!next.ok) throw new Error('no add')
      log = next.log
    }
    const committed = await setRecoveryKey(log, rook, key.id, 2)
    if (committed === undefined) throw new Error('no key')
    const off = await appendDeviceEntry(
      fakeCrypto,
      committed,
      rook,
      { kind: 'remove', device: phone.id },
      3,
    )
    if (!off.ok) throw new Error('no remove')
    const epoch1 = await recoverDeviceLog(
      rook.id,
      off.log,
      key,
      {
        epoch: 1,
        writer: rook.id,
        keep: [
          { device: rook.id, name: 'Laptop' },
          { device: phone.id, name: 'Phone' },
          { device: tablet.id, name: 'Tablet' },
        ],
        next: fakeSigner('rook-recovery-2').id,
      },
      4,
    )
    if (epoch1 === undefined) throw new Error('no recovery')
    const { links, sent } = await mikaAsked(phone.id)
    const base = await opened()
    const card = { ...base.card, from: phone.id, deviceLog: epoch1 }
    const link = { ...base.link, maker: await linkMaker(fakeCrypto, phone.id) }
    expect(await links.ask({ ok: true, ...base, link, card })).toBe('sent')
    const to = sentTo(sent)
    const closed = { answer: 'closed', deviceLog: off.log } as unknown as Json
    await links.take(to, answer(tablet.id, await bound(closed, to.secret)))
    expect(links.asks()[0]?.state).toBe('waiting')
  })
})

describe('the log a friend added through a link is kept with', () => {
  /** Rook adds Mika with the log from before: the phone still on it, no recovery key. */
  const staleAdded = async (to = reply) =>
    bound(
      {
        answer: 'added',
        secret: pairSecret,
        name: 'Rook',
        deviceLog: (await logs()).withPhone,
      } as unknown as Json,
      to,
    )

  const kept = (friend: LinkFriend | undefined) => {
    if (friend === undefined) throw new Error('not befriended')
    const state = deviceState(friend.deviceLog)
    return { phone: state.active.has(phone.id), recovery: friend.deviceLog.recovery !== undefined }
  }

  it("keeps the card's newer log when the maker's added carries an older one", async () => {
    const { links, befriended, sent } = await mikaAsked(rook.id)
    const base = await opened()
    const card = { ...base.card, deviceLog: await newest() }
    expect(await links.ask({ ok: true, ...base, card })).toBe('sent')
    const to = sentTo(sent)
    await links.take(to, answer(rook.id, await staleAdded(to.secret)))
    expect(kept(befriended[0])).toEqual({ phone: false, recovery: true })
  })

  it('keeps a log a closed answer carried, through asking again, when added with an older one', async () => {
    // Answered `closed` with the newer log, then asked again through a card from before.
    const { links, sent, befriended } = await mikaAsked(rook.id, 'closed', { log: await newest() })
    const base = await opened()
    const card = { ...base.card, deviceLog: (await logs()).withPhone }
    expect(await links.ask({ ok: true, ...base, card })).toBe('sent')
    // Asking again after an answer draws a new reply secret: the added comes under it.
    const again = { ...source, secret: (sent[0] as { reply: string }).reply }
    await links.take(again, answer(rook.id, await staleAdded(again.secret)))
    expect(kept(befriended[0])).toEqual({ phone: false, recovery: true })
  })

  it('keeps the log already kept for them when the added carries an older one', async () => {
    const { links, befriended } = await mikaAsked(rook.id, 'waiting', { known: await newest() })
    await links.take(source, answer(rook.id, await staleAdded()))
    expect(kept(befriended[0])).toEqual({ phone: false, recovery: true })
  })

  it('refuses an added from a device the merged log has taken off', async () => {
    const { links, befriended } = await mikaAsked(phone.id, 'waiting', { log: await newest() })
    const added = {
      answer: 'added',
      secret: pairSecret,
      name: 'Rook',
      deviceLog: (await logs()).withPhone,
    }
    await links.take(source, answer(phone.id, await bound(added as unknown as Json)))
    expect(befriended).toEqual([])
  })
})

async function opened(): Promise<{ link: InviteLink; card: InviteCard; fingerprint: string }> {
  const link: InviteLink = {
    secret,
    fingerprint: await linkFingerprint(fakeCrypto, rook.id),
    maker: await linkMaker(fakeCrypto, rook.id),
    end: NOW + DAY,
  }
  const card: InviteCard = {
    identity: rook.id,
    deviceLog: emptyDeviceLog(rook.id),
    keys: [await bindSealingKey(rook, seal.sealer('rook'))],
    name: 'Rook',
    lighthouses: [lighthouse],
    expires: NOW + DAY,
    open: true,
    from: rook.id,
    tag: 'tag',
  }
  return { link, card, fingerprint: 'x' }
}

describe('asking again through a link', () => {
  it('draws a new reply secret even while the request before still waits, which it replaces', async () => {
    // An answer to the request before, put under the old reply secret, can't end this one.
    const { links, sent } = await mikaAsked(rook.id)
    expect(await links.ask({ ok: true, ...(await opened()) })).toBe('sent')
    expect((sent[0] as { reply: string }).reply).not.toBe(reply)
    expect(links.asks().map((ask) => ask.reply)).toEqual([(sent[0] as { reply: string }).reply])
  })

  it('draws a new reply secret once the request before was answered', async () => {
    const { links, sent } = await mikaAsked(rook.id, 'declined')
    expect(await links.ask({ ok: true, ...(await opened()) })).toBe('sent')
    expect((sent[0] as { reply: string }).reply).not.toBe(reply)
  })

  it('refuses to ask once the card has expired, or the link says it lasts too long', async () => {
    const { links } = await mikaAsked(rook.id)
    const base = await opened()
    const lapsed = { ...base, card: { ...base.card, expires: NOW } }
    expect(await links.ask({ ok: true, ...lapsed })).toBe('expired')
    const long = { ...base, link: { ...base.link, end: NOW + 30 * DAY } }
    expect(await links.ask({ ok: true, ...long })).toBe('too-long')
  })
})
describe('every list heard of the person asked', () => {
  /** A request to Rook through another link of his, made by the laptop, keeping his newest log. */
  const throughTheLaptop = async (): Promise<SentAsk> => ({
    secret: base32Encode(new Uint8Array(16).fill(11)),
    identity: rook.id,
    name: 'Rook',
    fingerprint: 'x',
    keys: [await bindSealingKey(rook, seal.sealer('rook'))],
    lighthouses: [lighthouse],
    reply: base32Encode(new Uint8Array(16).fill(12)),
    expires: NOW + DAY,
    maker: rook.id,
    at: NOW,
    state: 'waiting',
    log: await newest(),
  })

  it("refuses an added from a device another request's log says was taken off", async () => {
    // The phone's own link, with its card on the list from before; another request already
    // heard Rook's newer list, which takes the phone off.
    const { withPhone } = await logs()
    const { links, befriended } = await mikaAsked(phone.id, 'waiting', {
      log: withPhone,
      others: [await throughTheLaptop()],
    })
    const added = { answer: 'added', secret: pairSecret, name: 'Rook', deviceLog: withPhone }
    await links.take(source, answer(phone.id, await bound(added as unknown as Json)))
    expect(befriended).toEqual([])
  })

  it('keeps the newest list heard of theirs when added through a card from before', async () => {
    const { withPhone } = await logs()
    const { links, befriended } = await mikaAsked(rook.id, 'waiting', {
      log: withPhone,
      others: [await throughTheLaptop()],
    })
    const added = { answer: 'added', secret: pairSecret, name: 'Rook', deviceLog: withPhone }
    await links.take(source, answer(rook.id, await bound(added as unknown as Json)))
    const friend = befriended[0]
    expect(
      friend === undefined ? undefined : deviceState(friend.deviceLog).active.has(phone.id),
    ).toBe(false)
    expect(friend?.deviceLog.recovery).toBeDefined()
  })

  it("won't open or ask through a card from a device another request's log says was taken off", async () => {
    const { withPhone } = await logs()
    const { links } = await mikaAsked(rook.id, 'declined', { others: [await throughTheLaptop()] })
    const base = await opened()
    const card = { ...base.card, from: phone.id, deviceLog: withPhone }
    const link = { ...base.link, maker: await linkMaker(fakeCrypto, phone.id) }
    expect(await links.ask({ ok: true, ...base, link, card })).toBe('not-sent')
  })
})

describe('an answer counts only for the request it names', () => {
  const added = (deviceLog: DeviceLog) =>
    ({ answer: 'added', secret: pairSecret, name: 'Rook', deviceLog }) as unknown as Json

  it("leaves a refusal copied under another request's reply tag untaken, and takes the real added", async () => {
    const { withoutPhone } = await logs()
    const elsewhere = base32Encode(new Uint8Array(16).fill(4))
    const { links, befriended } = await mikaAsked(rook.id)
    // The maker's refusal to another request, put under this one's reply tag.
    const copied = answer(rook.id, await bound({ answer: 'declined' }, elsewhere))
    expect(await links.take(source, copied)).toBe(false)
    // One naming this reply secret but another link's card tag is left the same way.
    const otherLink = {
      ...((await bound({ answer: 'declined' })) as Record<string, Json>),
      link: await inviteCardTag(fakeCrypto, elsewhere),
    } as Json
    expect(await links.take(source, answer(rook.id, otherLink))).toBe(false)
    expect(links.asks()[0]?.state).toBe('waiting')
    expect(links.sources().some((one) => one.secret === reply)).toBe(true)
    expect(await links.take(source, answer(rook.id, await bound(added(withoutPhone))))).toBe(true)
    expect(befriended.map((friend) => friend.id)).toEqual([rook.id])
  })

  it('drops an answer that names no request, or names it in another spelling', async () => {
    const { withoutPhone } = await logs()
    const { links, befriended } = await mikaAsked(rook.id)
    const tag = await inviteCardTag(fakeCrypto, secret)
    const unbound = [
      { answer: 'declined' },
      { answer: 'declined', reply },
      { answer: 'busy', link: tag },
      added(withoutPhone),
      { ...(added(withoutPhone) as Record<string, Json>), reply: reply.toUpperCase(), link: tag },
      { ...(added(withoutPhone) as Record<string, Json>), reply, link: tag.toUpperCase() },
    ] as Json[]
    for (const body of unbound) await links.take(source, answer(rook.id, body))
    expect(links.asks()[0]?.state).toBe('waiting')
    expect(befriended).toEqual([])
    await links.take(source, answer(rook.id, await bound(added(withoutPhone))))
    expect(befriended.map((friend) => friend.id)).toEqual([rook.id])
  })

  it('keeps a request through a lookalike link with the same secret apart from the one waiting', async () => {
    const { withPhone } = await logs()
    const eve = fakeSigner('eve')
    const { links } = await mikaAsked(rook.id)
    const base = await opened()
    // The same secret, naming someone else.
    const evesLink = {
      ...base,
      link: {
        ...base.link,
        fingerprint: await linkFingerprint(fakeCrypto, eve.id),
        maker: await linkMaker(fakeCrypto, eve.id),
      },
      card: {
        ...base.card,
        identity: eve.id,
        from: eve.id,
        deviceLog: emptyDeviceLog(eve.id),
        keys: [await bindSealingKey(eve, seal.sealer('eve'))],
      },
    }
    expect(await links.ask({ ok: true, ...evesLink })).toBe('sent')
    // The same secret and identity, naming another of Rook's devices as its maker.
    const phonesLink = {
      ...base,
      link: { ...base.link, maker: await linkMaker(fakeCrypto, phone.id) },
      card: { ...base.card, from: phone.id, deviceLog: withPhone },
    }
    expect(await links.ask({ ok: true, ...phonesLink })).toBe('sent')
    const kept = links.asks()
    expect(kept).toHaveLength(3)
    expect(kept.find((one) => one.reply === reply)).toMatchObject({
      identity: rook.id,
      maker: rook.id,
      state: 'waiting',
    })
    expect(new Set(kept.map((one) => one.reply)).size).toBe(3)
  })

  it("won't let a late refusal to the request before drop the added to the one after (#234)", async () => {
    const { withoutPhone } = await logs()
    const { links, sent, befriended } = await mikaAsked(rook.id)
    expect(await links.ask({ ok: true, ...(await opened()) })).toBe('sent')
    const again = sentTo(sent)
    expect(again.secret).not.toBe(reply)
    // The maker's refusal to the first request, late, under either reply tag.
    expect(await links.take(again, answer(rook.id, await bound({ answer: 'declined' })))).toBe(
      false,
    )
    await links.take(source, answer(rook.id, await bound({ answer: 'declined' })))
    expect(links.asks().map((ask) => ask.state)).toEqual(['waiting'])
    await links.take(again, answer(rook.id, await bound(added(withoutPhone), again.secret)))
    expect(befriended.map((friend) => friend.id)).toEqual([rook.id])
  })

  it('forgets a request by its reply secret, leaving another with the same link secret', async () => {
    const eve = fakeSigner('eve')
    const lookalike: SentAsk = {
      secret,
      identity: eve.id,
      name: 'Eve',
      fingerprint: 'y',
      keys: [],
      lighthouses: [lighthouse],
      reply: base32Encode(new Uint8Array(16).fill(12)),
      expires: NOW + DAY,
      maker: eve.id,
      at: NOW,
      state: 'waiting',
    }
    const { links } = await mikaAsked(rook.id, 'waiting', { others: [lookalike] })
    await links.forgetAsk(reply)
    expect(links.asks().map((ask) => ask.identity)).toEqual([eve.id])
  })
})
