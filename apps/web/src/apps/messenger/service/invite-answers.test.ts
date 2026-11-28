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
  options: { log?: DeviceLog; known?: DeviceLog } = {},
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
  const store = createMemoryStore({ 'invite-asks': [ask] })
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
      expect(await links.take(source, answer(phone.id, body as Json))).toBe(true)
      expect(links.asks()[0]?.state).toBe('waiting')
      expect(links.sources().some((one) => one.secret === reply)).toBe(true)
    })

  it("takes the maker's added after a removed device's declined in the same fetch", async () => {
    const { withoutPhone } = await logs()
    const { links, befriended } = await mikaAsked(rook.id)
    await links.take(source, answer(phone.id, { answer: 'declined' }))
    const added = { answer: 'added', secret: pairSecret, name: 'Rook', deviceLog: withoutPhone }
    expect(await links.take(source, answer(rook.id, added as unknown as Json))).toBe(true)
    expect(befriended.map((friend) => friend.id)).toEqual([rook.id])
  })

  it("still takes the maker's own declined", async () => {
    const { links } = await mikaAsked(rook.id)
    await links.take(source, answer(rook.id, { answer: 'declined' }))
    expect(links.asks()[0]?.state).toBe('declined')
  })

  it('drops a closed from a writer a recovery left off, signed on its old epoch removing the maker', async () => {
    // Variant A: Rook's first device, the writer of epoch 0, is stolen and a recovery leaves it
    // off, keeping the phone, which made the link. Mika opened the link before the recovery, so her
    // request was sealed to the stolen device too. It signs the phone's removal onto its own copy
    // of epoch 0 and answers `closed` with that: before Mika hears of the recovery, the log holds.
    const { withPhone, withoutPhone } = await logs()
    const { links, befriended } = await mikaAsked(phone.id)
    const base = await opened()
    const card = { ...base.card, from: phone.id, deviceLog: withPhone }
    const link = { ...base.link, maker: await linkMaker(fakeCrypto, phone.id) }
    expect(await links.ask({ ok: true, ...base, link, card })).toBe('sent')
    await links.take(
      source,
      answer(rook.id, { answer: 'closed', deviceLog: withoutPhone } as never),
    )
    expect(links.asks()[0]?.state).toBe('waiting')
    // the phone's added, after it in the same fetch, is still taken
    const added = { answer: 'added', secret: pairSecret, name: 'Rook', deviceLog: withPhone }
    await links.take(source, answer(phone.id, added as unknown as Json))
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
    const { links } = await mikaAsked(phone.id)
    const base = await opened()
    const card = { ...base.card, from: phone.id, deviceLog: epoch1 }
    const link = { ...base.link, maker: await linkMaker(fakeCrypto, phone.id) }
    expect(await links.ask({ ok: true, ...base, link, card })).toBe('sent')
    await links.take(source, answer(tablet.id, { answer: 'closed', deviceLog: off.log } as never))
    expect(links.asks()[0]?.state).toBe('waiting')
  })
})

describe('the log a friend added through a link is kept with', () => {
  /** Rook adds Mika with the log from before: the phone still on it, no recovery key. */
  const staleAdded = async () =>
    ({
      answer: 'added',
      secret: pairSecret,
      name: 'Rook',
      deviceLog: (await logs()).withPhone,
    }) as unknown as Json

  const kept = (friend: LinkFriend | undefined) => {
    if (friend === undefined) throw new Error('not befriended')
    const state = deviceState(friend.deviceLog)
    return { phone: state.active.has(phone.id), recovery: friend.deviceLog.recovery !== undefined }
  }

  it("keeps the card's newer log when the maker's added carries an older one", async () => {
    const { links, befriended } = await mikaAsked(rook.id)
    const base = await opened()
    const card = { ...base.card, deviceLog: await newest() }
    expect(await links.ask({ ok: true, ...base, card })).toBe('sent')
    await links.take(source, answer(rook.id, await staleAdded()))
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
    await links.take(again, answer(rook.id, await staleAdded()))
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
    await links.take(source, answer(phone.id, added as unknown as Json))
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
  it('keeps the reply secret while the request before still waits', async () => {
    const { links, sent } = await mikaAsked(rook.id)
    expect(await links.ask({ ok: true, ...(await opened()) })).toBe('sent')
    expect((sent[0] as { reply: string }).reply).toBe(reply)
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
