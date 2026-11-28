import { describe, expect, it } from 'vitest'
import { appendDeviceEntry, emptyDeviceLog } from '../devices/device-log.ts'
import { base32Decode, base32Encode, base64Decode, base64Encode } from '../encoding/bytes.ts'
import type { LighthouseAddress } from '../lighthouse/address.ts'
import { bindSealingKey } from '../mail/mail.ts'
import { fakeCrypto, fakeSealCrypto, fakeSigner } from '../testing/testing.ts'
import {
  answerIsFor,
  decodeInviteLink,
  encodeInviteLinkFragment,
  type InviteCard,
  type InviteLink,
  inviteAnswerTag,
  inviteAskTag,
  inviteCardClaim,
  inviteCardTag,
  inviteLinkEnd,
  isInviteClaimKey,
  linkFingerprint,
  linkMaker,
  newestCard,
  openInviteCard,
  readInviteAnswer,
  readInviteRequest,
  sealInviteCard,
} from './mailed-invite.ts'

const seal = fakeSealCrypto()
const rook = fakeSigner('rook')
const rookPhone = fakeSigner('rook-phone')
const stranger = fakeSigner('stranger')
const secret = base32Encode(new Uint8Array(16).fill(7))
const loft: LighthouseAddress = { id: fakeSigner('loft').id, name: 'Loft', url: 'wss://loft.test/' }

const END = Date.parse('2026-12-01T10:00:00Z')

async function linkFor(id = rook.id, maker = rook.id): Promise<InviteLink> {
  return {
    secret,
    fingerprint: await linkFingerprint(fakeCrypto, id),
    maker: await linkMaker(fakeCrypto, maker),
    end: END,
  }
}

async function card(
  signer = rook,
  fields: Partial<Omit<InviteCard, 'from' | 'tag'>> = {},
): Promise<string> {
  const sealed = await sealInviteCard(fakeCrypto, seal, signer, secret, {
    identity: rook.id,
    deviceLog: emptyDeviceLog(rook.id),
    keys: [await bindSealingKey(rook, seal.sealer('rook'))],
    name: 'Rook',
    lighthouses: [loft],
    expires: 10_000,
    open: true,
    ...fields,
  })
  if (!sealed.ok) throw new Error(sealed.error)
  return sealed.value
}

describe('invite links', () => {
  it('reads back the link it writes, with its maker and end, with and without a Lighthouse', async () => {
    const link = await linkFor()
    const fragment = encodeInviteLinkFragment(link)
    expect(fragment).toMatch(/^b\/[a-z2-7]{86}$/)
    expect(decodeInviteLink(`https://pigeon.test/#${fragment}`)).toEqual({
      ok: true,
      value: { ...link, lighthouse: undefined },
    })
    const named = encodeInviteLinkFragment({ ...link, lighthouse: loft })
    expect(decodeInviteLink(named)).toEqual({ ok: true, value: { ...link, lighthouse: loft } })
  })

  it('names the device that made it apart from every other device', async () => {
    expect(await linkMaker(fakeCrypto, rook.id)).toMatch(/^[0-9a-f]{32}$/)
    expect(await linkMaker(fakeCrypto, rookPhone.id)).not.toBe(await linkMaker(fakeCrypto, rook.id))
    const fromPhone = await linkFor(rook.id, rookPhone.id)
    const decoded = decodeInviteLink(encodeInviteLinkFragment(fromPhone))
    expect(decoded.ok && decoded.value.maker).toBe(await linkMaker(fakeCrypto, rookPhone.id))
  })

  it('carries its end to the second, with one spelling', async () => {
    expect(inviteLinkEnd(END + 999)).toBe(END)
    const link = await linkFor()
    const fragment = encodeInviteLinkFragment(link)
    // The end is the last 8 characters, 5 bytes with no bits left over.
    const body = fragment.slice(2)
    const decoded = decodeInviteLink(fragment)
    expect(decoded.ok && decoded.value.end).toBe(END)
    expect(decodeInviteLink(`b/${body.slice(0, -8)}aaaaaaaa`).ok).toBe(false)
    // Lowercase only: capitals, or the Kelvin sign that lowercases to `k`, are another spelling.
    expect(decodeInviteLink(fragment.toUpperCase().replace('B/', 'b/')).ok).toBe(false)
    expect(decodeInviteLink(`b/${body.slice(0, 1).toUpperCase()}${body.slice(1)}`).ok).toBe(false)
    expect(decodeInviteLink(`b/\u212a${body.slice(1)}`).ok).toBe(false)
  })

  it('refuses a link that is cut short, or names a Lighthouse with a pass', async () => {
    const fragment = encodeInviteLinkFragment(await linkFor())
    expect(decodeInviteLink(fragment.slice(0, -1))).toEqual({ ok: false, error: 'malformed' })
    expect(decodeInviteLink(`i/${fragment.slice(2)}`).ok).toBe(false)
    expect(decodeInviteLink(`a/${fragment.slice(2)}`).ok).toBe(false)
    const withPass = encodeInviteLinkFragment({ ...(await linkFor()), lighthouse: loft }).replace(
      'name%3DLoft',
      'name%3DLoft%26pass%3Dsecret',
    )
    expect(decodeInviteLink(withPass).ok).toBe(false)
  })

  it('names its card, requests and answers apart', async () => {
    const tags = new Set([
      await inviteCardTag(fakeCrypto, secret),
      await inviteAskTag(fakeCrypto, secret, '2026-11-25'),
      await inviteAskTag(fakeCrypto, secret, '2026-11-26'),
      await inviteAnswerTag(fakeCrypto, secret, '2026-11-25'),
    ])
    expect(tags.size).toBe(4)
  })

  it("claims a card's tag with a value of its own at each Lighthouse", async () => {
    const claimKey = base32Encode(new Uint8Array(32).fill(7))
    expect(isInviteClaimKey(claimKey)).toBe(true)
    expect(isInviteClaimKey(secret)).toBe(false)
    expect(isInviteClaimKey(claimKey.toUpperCase())).toBe(false)
    const here = await inviteCardClaim(fakeCrypto, claimKey, rook.id)
    expect(here).toMatch(/^[a-z2-7]{52}$/)
    expect(await inviteCardClaim(fakeCrypto, claimKey, rook.id)).toBe(here)
    expect(await inviteCardClaim(fakeCrypto, claimKey, stranger.id)).not.toBe(here)
    const otherKey = base32Encode(new Uint8Array(32).fill(8))
    expect(await inviteCardClaim(fakeCrypto, otherKey, rook.id)).not.toBe(here)
  })
})

describe('invite cards', () => {
  it('opens the inviter’s card and keeps its checked keys', async () => {
    const opened = await openInviteCard(fakeCrypto, seal, await linkFor(), await card())
    if (!opened.ok) throw new Error(opened.error)
    expect(opened.value).toMatchObject({
      identity: rook.id,
      name: 'Rook',
      open: true,
      from: rook.id,
    })
    expect(opened.value.keys.map((key) => key.device)).toEqual([rook.id])
  })

  it('cleans the name on a card once its signature is checked', async () => {
    const named = await card(rook, { name: 'Rook\n[9:41 AM] Mika' })
    const opened = await openInviteCard(fakeCrypto, seal, await linkFor(), named)
    expect(opened.ok && opened.value.name).toBe('Rook[9:41 AM] Mika')
  })

  it('refuses a card from someone else who holds the link', async () => {
    const forged = await sealInviteCard(fakeCrypto, seal, stranger, secret, {
      identity: stranger.id,
      deviceLog: emptyDeviceLog(stranger.id),
      keys: [],
      name: 'Rook',
      lighthouses: [],
      expires: 10_000,
      open: true,
    })
    if (!forged.ok) throw new Error('unsealed')
    expect(await openInviteCard(fakeCrypto, seal, await linkFor(), forged.value)).toEqual({
      ok: false,
      error: 'not-theirs',
    })
    // Claiming the inviter's identity, signed by a device not on their list.
    expect(await openInviteCard(fakeCrypto, seal, await linkFor(), await card(stranger))).toEqual({
      ok: false,
      error: 'not-theirs',
    })
  })

  it('refuses a card for a link whose fingerprint is empty or short', async () => {
    const sealed = await card()
    for (const fingerprint of ['', (await linkFor()).fingerprint.slice(0, 4)])
      expect(
        await openInviteCard(fakeCrypto, seal, { ...(await linkFor()), fingerprint }, sealed),
      ).toEqual({ ok: false, error: 'not-theirs' })
  })

  it('refuses a card moved from another of the inviter’s links', async () => {
    // Someone holding two of Rook's links opens the card of one and seals it under the other.
    const other = base32Encode(new Uint8Array(16).fill(3))
    const keyOf = async (text: string) => {
      const bytes = base32Decode(text)
      if (!bytes.ok) throw new Error('bad secret')
      return seal.hkdf(bytes.value, 'pigeon/invite/key', 32)
    }
    const sealed = base64Decode(await card())
    if (!sealed.ok) throw new Error('bad blob')
    const inner = await seal.open(await keyOf(secret), sealed.value)
    if (inner === undefined) throw new Error('unopened')
    const moved = base64Encode(await seal.seal(await keyOf(other), inner))
    const link = { ...(await linkFor()), secret: other }
    expect(await openInviteCard(fakeCrypto, seal, link, moved)).toEqual({
      ok: false,
      error: 'not-theirs',
    })
  })

  it('refuses a card under another secret, and leaves out keys not signed by their device', async () => {
    const other = { ...(await linkFor()), secret: base32Encode(new Uint8Array(16).fill(9)) }
    expect((await openInviteCard(fakeCrypto, seal, other, await card())).ok).toBe(false)
    const forgedKey = { ...(await bindSealingKey(rook, seal.sealer('rook'))), device: rookPhone.id }
    const opened = await openInviteCard(
      fakeCrypto,
      seal,
      await linkFor(),
      await card(rook, { keys: [forgedKey] }),
    )
    expect(opened.ok && opened.value.keys).toEqual([])
  })

  it('takes a card from a linked device, and prefers the one on the newest list', async () => {
    const added = await appendDeviceEntry(
      fakeCrypto,
      emptyDeviceLog(rook.id),
      rook,
      { kind: 'add', device: rookPhone.id, name: 'Phone' },
      1,
    )
    if (!added.ok) throw new Error('no add')
    const fromPhone = await openInviteCard(
      fakeCrypto,
      seal,
      await linkFor(),
      await card(rookPhone, { deviceLog: added.log }),
    )
    if (!fromPhone.ok) throw new Error(fromPhone.error)
    const removed = await appendDeviceEntry(
      fakeCrypto,
      added.log,
      rook,
      { kind: 'remove', device: rookPhone.id },
      2,
    )
    if (!removed.ok) throw new Error('no remove')
    const closed = await openInviteCard(
      fakeCrypto,
      seal,
      await linkFor(),
      await card(rook, { deviceLog: removed.log, open: false }),
    )
    if (!closed.ok) throw new Error(closed.error)
    expect(newestCard([fromPhone.value, closed.value])).toBe(closed.value)
    expect(newestCard([closed.value, fromPhone.value])).toBe(closed.value)
    // The removed phone can't sign a card on the newer list.
    expect(
      (
        await openInviteCard(
          fakeCrypto,
          seal,
          await linkFor(),
          await card(rookPhone, { deviceLog: removed.log }),
        )
      ).ok,
    ).toBe(false)
  })
})

describe('requests and answers', () => {
  it('reads a request and an answer, and nothing that isn’t one', async () => {
    const request = {
      name: 'Mika',
      deviceLog: emptyDeviceLog(stranger.id),
      keys: [],
      lighthouses: [loft],
      reply: secret,
      link: 'tag',
    }
    expect(readInviteRequest(stranger.id, request)).toEqual(request)
    expect(readInviteRequest(rook.id, request)).toBeUndefined()
    expect(readInviteRequest(stranger.id, { ...request, reply: 'short' })).toBeUndefined()
    // A name is cleaned of line breaks and reordering marks; one with nothing else is refused.
    expect(readInviteRequest(stranger.id, { ...request, name: 'Eve\n\u202e' })?.name).toBe('Eve')
    expect(readInviteRequest(stranger.id, { ...request, name: '\u200f' })).toBeUndefined()
    const to = { reply: secret, link: await inviteCardTag(fakeCrypto, secret) }
    const added = {
      answer: 'added',
      secret: 'x',
      name: 'Rook',
      deviceLog: emptyDeviceLog(rook.id),
      ...to,
    }
    expect(readInviteAnswer(rook.id, added)).toEqual(added)
    expect(readInviteAnswer(rook.id, { ...added, name: 'Ro\u2066ok' })).toEqual(added)
    expect(readInviteAnswer(rook.id, { answer: 'declined', extra: 1, ...to })).toEqual({
      answer: 'declined',
      ...to,
    })
    expect(readInviteAnswer(rook.id, { answer: 'maybe', ...to })).toBeUndefined()
    const log = emptyDeviceLog(rook.id)
    expect(readInviteAnswer(rook.id, { answer: 'closed', deviceLog: log, ...to })).toEqual({
      answer: 'closed',
      deviceLog: log,
      ...to,
    })
    // Someone else's log, or none that reads, leaves the answer without one.
    expect(
      readInviteAnswer(rook.id, {
        answer: 'closed',
        deviceLog: emptyDeviceLog(stranger.id),
        ...to,
      }),
    ).toEqual({ answer: 'closed', ...to })
    expect(readInviteAnswer(rook.id, { answer: 'closed', deviceLog: 7, ...to })).toEqual({
      answer: 'closed',
      ...to,
    })
  })
})

describe('what an answer says it answers', () => {
  const rook = fakeSigner('rook')
  const reply = base32Encode(new Uint8Array(16).fill(9))
  const other = base32Encode(new Uint8Array(16).fill(4))
  const secret = base32Encode(new Uint8Array(16).fill(7))

  it('reads an answer only when it names both the reply secret and the card tag', async () => {
    const link = await inviteCardTag(fakeCrypto, secret)
    expect(readInviteAnswer(rook.id, { answer: 'declined', reply, link })).toEqual({
      answer: 'declined',
      reply,
      link,
    })
    // Unbound: naming neither, or only one, is no answer at all.
    expect(readInviteAnswer(rook.id, { answer: 'declined' })).toBeUndefined()
    expect(readInviteAnswer(rook.id, { answer: 'declined', reply })).toBeUndefined()
    expect(readInviteAnswer(rook.id, { answer: 'busy', link })).toBeUndefined()
    const added = { answer: 'added', secret: 'x', name: 'Rook', deviceLog: emptyDeviceLog(rook.id) }
    expect(readInviteAnswer(rook.id, added)).toBeUndefined()
    // Each as Pigeon writes it: lowercase base32 of the right length.
    expect(
      readInviteAnswer(rook.id, { answer: 'busy', reply: reply.toUpperCase(), link }),
    ).toBeUndefined()
    expect(readInviteAnswer(rook.id, { answer: 'busy', reply, link: `${link}a` })).toBeUndefined()
    expect(
      readInviteAnswer(rook.id, { answer: 'busy', reply: reply.slice(0, -1), link }),
    ).toBeUndefined()
    expect(readInviteAnswer(rook.id, { answer: 'busy', reply: 7, link })).toBeUndefined()
  })

  it('answers a request only when both are its own', async () => {
    const link = await inviteCardTag(fakeCrypto, secret)
    const elsewhere = await inviteCardTag(fakeCrypto, other)
    const answer = { answer: 'declined', reply, link } as const
    expect(answerIsFor(answer, reply, link)).toBe(true)
    expect(answerIsFor(answer, other, link)).toBe(false)
    expect(answerIsFor(answer, reply, elsewhere)).toBe(false)
    // Compared as bytes, never as text.
    expect(answerIsFor(answer, reply.toUpperCase(), link)).toBe(true)
  })
})
