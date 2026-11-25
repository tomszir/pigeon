import { describe, expect, it } from 'vitest'
import { appendDeviceEntry, emptyDeviceLog } from '../devices/device-log.ts'
import { base32Decode, base32Encode, base64Decode, base64Encode } from '../encoding/bytes.ts'
import type { LighthouseAddress } from '../lighthouse/address.ts'
import { bindSealingKey } from '../mail/mail.ts'
import { fakeCrypto, fakeSealCrypto, fakeSigner } from '../testing/testing.ts'
import {
  decodeInviteLink,
  encodeInviteLinkFragment,
  type InviteCard,
  type InviteLink,
  inviteAnswerTag,
  inviteAskTag,
  inviteCardTag,
  linkFingerprint,
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

async function linkFor(id = rook.id): Promise<InviteLink> {
  return { secret, fingerprint: await linkFingerprint(fakeCrypto, id) }
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
  it('reads back the link it writes, with and without a Lighthouse', async () => {
    const link = await linkFor()
    const fragment = encodeInviteLinkFragment(link)
    expect(fragment).toMatch(/^a\/[a-z2-7]{52}$/)
    expect(decodeInviteLink(`https://pigeon.test/#${fragment}`)).toEqual({
      ok: true,
      value: { ...link, lighthouse: undefined },
    })
    const named = encodeInviteLinkFragment({ ...link, lighthouse: loft })
    expect(decodeInviteLink(named)).toEqual({ ok: true, value: { ...link, lighthouse: loft } })
  })

  it('refuses a link that is cut short, or names a Lighthouse with a pass', async () => {
    const fragment = encodeInviteLinkFragment(await linkFor())
    expect(decodeInviteLink(fragment.slice(0, -1)).ok).toBe(false)
    expect(decodeInviteLink(`i/${fragment.slice(2)}`).ok).toBe(false)
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
    const added = { answer: 'added', secret: 'x', name: 'Rook', deviceLog: emptyDeviceLog(rook.id) }
    expect(readInviteAnswer(rook.id, added)).toEqual(added)
    expect(readInviteAnswer(rook.id, { answer: 'declined', extra: 1 })).toEqual({
      answer: 'declined',
    })
    expect(readInviteAnswer(rook.id, { answer: 'maybe' })).toBeUndefined()
  })
})
