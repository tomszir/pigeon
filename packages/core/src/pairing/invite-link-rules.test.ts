import { describe, expect, it } from 'vitest'
import { appendDeviceEntry, type DeviceLog, emptyDeviceLog } from '../devices/device-log.ts'
import { base32Encode } from '../encoding/bytes.ts'
import type { LighthouseAddress } from '../lighthouse/address.ts'
import { bindSealingKey } from '../mail/mail.ts'
import { fakeCrypto, fakeSealCrypto, fakeSigner } from '../testing/testing.ts'
import {
  cardFitsLink,
  chooseLinkCard,
  INVITE_LINK_CLOCK_SLACK,
  inviteLinkEnded,
  inviteLinkTooLong,
} from './invite-link-rules.ts'
import {
  type InviteCard,
  type InviteLink,
  linkFingerprint,
  linkMaker,
  MAX_INVITE_LINK_LIFETIME,
} from './mailed-invite.ts'

const seal = fakeSealCrypto()
const rook = fakeSigner('rook')
const rookPhone = fakeSigner('rook-phone')
const secret = base32Encode(new Uint8Array(16).fill(7))
const loft: LighthouseAddress = { id: fakeSigner('loft').id, name: 'Loft', url: 'wss://loft.test/' }
const NOW = Date.parse('2026-11-27T10:00:00Z')
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const END = NOW + 7 * DAY

/** Rook's link, made by `maker`, ending at `end`. */
async function link(maker = rook.id, end = END): Promise<InviteLink> {
  return {
    secret,
    fingerprint: await linkFingerprint(fakeCrypto, rook.id),
    maker: await linkMaker(fakeCrypto, maker),
    end,
  }
}

async function withPhone(): Promise<DeviceLog> {
  const added = await appendDeviceEntry(
    fakeCrypto,
    emptyDeviceLog(rook.id),
    rook,
    { kind: 'add', device: rookPhone.id, name: 'Phone' },
    1,
  )
  if (!added.ok) throw new Error('no add')
  return added.log
}

async function card(fields: Partial<InviteCard> = {}): Promise<InviteCard> {
  return {
    identity: rook.id,
    deviceLog: await withPhone(),
    keys: [await bindSealingKey(rook, seal.sealer('rook'))],
    name: 'Rook',
    lighthouses: [loft],
    expires: END,
    open: true,
    from: rook.id,
    tag: 'tag',
    ...fields,
  }
}

describe('whose cards a link takes', () => {
  it('takes cards only from the device that made the link', async () => {
    expect(await cardFitsLink(fakeCrypto, await link(), await card())).toBe(true)
    // The phone is on the same list, but the link names the laptop.
    const phones = await card({ from: rookPhone.id })
    expect(await cardFitsLink(fakeCrypto, await link(), phones)).toBe(false)
    expect(await cardFitsLink(fakeCrypto, await link(), { ...phones, open: false })).toBe(false)
    expect(await cardFitsLink(fakeCrypto, await link(rookPhone.id), phones)).toBe(true)
  })

  it("refuses the maker's open card that outlasts the end the link carries", async () => {
    expect(await cardFitsLink(fakeCrypto, await link(), await card({ expires: END + 1000 }))).toBe(
      false,
    )
    expect(await cardFitsLink(fakeCrypto, await link(), await card({ expires: END - HOUR }))).toBe(
      true,
    )
    // A closed card says nothing that lets anyone in, whatever end it gives.
    const closed = await card({ expires: END + DAY, open: false })
    expect(await cardFitsLink(fakeCrypto, await link(), closed)).toBe(true)
  })

  it("chooses the newest of the maker's cards, and none of anyone else's", async () => {
    const mine = await card()
    const phones = await card({ from: rookPhone.id, open: false })
    expect(await chooseLinkCard(fakeCrypto, await link(), [phones, mine])).toBe(mine)
    expect(await chooseLinkCard(fakeCrypto, await link(), [phones])).toBeUndefined()
    const closed = await card({ open: false })
    expect(await chooseLinkCard(fakeCrypto, await link(), [mine, closed])).toBe(closed)
  })
})

describe('how long a link lasts', () => {
  it('lasts a week at most, with a day for clocks that disagree', async () => {
    expect(MAX_INVITE_LINK_LIFETIME).toBe(7 * DAY)
    expect(INVITE_LINK_CLOCK_SLACK).toBe(DAY)
    const longest = NOW + MAX_INVITE_LINK_LIFETIME + INVITE_LINK_CLOCK_SLACK
    expect(inviteLinkTooLong(await link(rook.id, longest), NOW)).toBe(false)
    expect(inviteLinkTooLong(await link(rook.id, longest + 1000), NOW)).toBe(true)
    // A link made to end far off opens only in its last week, and a day.
    expect(inviteLinkTooLong(await link(rook.id, longest + 1000), NOW + 1000)).toBe(false)
  })

  it('has ended on its end and after it', async () => {
    expect(inviteLinkEnded(await link(), END - 1)).toBe(false)
    expect(inviteLinkEnded(await link(), END)).toBe(true)
    expect(inviteLinkEnded(await link(), END + DAY)).toBe(true)
  })
})

describe('naming the maker', () => {
  it('compares the maker the link names as bytes, refusing one that is not hex', async () => {
    const fromRook = await card()
    expect(await cardFitsLink(fakeCrypto, { ...(await link()), maker: 'zz' }, fromRook)).toBe(false)
    const upper = { ...(await link()), maker: (await link()).maker.toUpperCase() }
    expect(await cardFitsLink(fakeCrypto, upper, fromRook)).toBe(false)
  })

  it('refuses a maker that is empty or shorter than 16 bytes, which would name every device', async () => {
    const fromRook = await card()
    const full = (await link()).maker
    for (const maker of ['', full.slice(0, 2), full.slice(0, 30), `${full}00`])
      expect(await cardFitsLink(fakeCrypto, { ...(await link()), maker }, fromRook)).toBe(false)
  })
})
