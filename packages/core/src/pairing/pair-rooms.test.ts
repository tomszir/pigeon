import { describe, expect, it } from 'vitest'
import { fakeCrypto } from '../testing/testing.ts'
import {
  encodePairSecret,
  isPairSecret,
  PAIR_SECRET_BYTES,
  pairDaysAt,
  pairPassword,
  pairRoomOn,
  pairRoomsAt,
  untilPairDaysChange,
  utcDay,
} from './pair-rooms.ts'

const secret = encodePairSecret(new Uint8Array(PAIR_SECRET_BYTES).fill(7))
const other = encodePairSecret(new Uint8Array(PAIR_SECRET_BYTES).fill(8))
const at = (iso: string) => Date.parse(iso)
const HOUR = 60 * 60 * 1000

describe('pair secrets', () => {
  it('are 32 bytes of base32', () => {
    expect(secret).toHaveLength(52)
    expect(isPairSecret(secret)).toBe(true)
    expect(isPairSecret(secret.slice(1))).toBe(false)
    expect(isPairSecret(secret.toUpperCase())).toBe(false)
    expect(isPairSecret(42)).toBe(false)
  })
})

describe('pair rooms', () => {
  it('are named from the secret and the day, not the ids', async () => {
    const today = await pairRoomOn(fakeCrypto, secret, '2026-11-24')
    expect(today).toMatch(/^pair:[a-z2-7]{52}$/)
    expect(await pairRoomOn(fakeCrypto, secret, '2026-11-25')).not.toBe(today)
    expect(await pairRoomOn(fakeCrypto, other, '2026-11-24')).not.toBe(today)
    expect(await pairRoomOn(fakeCrypto, secret, '2026-11-24')).toBe(today)
  })

  it('are locked with a password from the secret', async () => {
    const password = await pairPassword(fakeCrypto, secret)
    expect(password).toMatch(/^[a-z2-7]{52}$/)
    expect(password).not.toBe(secret)
    expect(await pairPassword(fakeCrypto, other)).not.toBe(password)
  })

  it('overlap around midnight UTC', () => {
    expect(pairDaysAt(at('2026-11-24T12:00:00Z'))).toEqual(['2026-11-24'])
    expect(pairDaysAt(at('2026-11-24T22:59:59Z'))).toEqual(['2026-11-24'])
    expect(pairDaysAt(at('2026-11-24T23:00:00Z'))).toEqual(['2026-11-24', '2026-11-25'])
    expect(pairDaysAt(at('2026-11-25T00:30:00Z'))).toEqual(['2026-11-24', '2026-11-25'])
    expect(pairDaysAt(at('2026-11-25T01:00:00Z'))).toEqual(['2026-11-25'])
    expect(pairDaysAt(at('2026-12-31T23:30:00Z'))).toEqual(['2026-12-31', '2027-01-01'])
  })

  it('meet when clocks either side of midnight are less than an hour apart', () => {
    const MINUTE = 60 * 1000
    const start = at('2026-11-24T21:30:00Z')
    for (let rook = start; rook < start + 5 * HOUR; rook += 5 * MINUTE)
      for (let apart = 0; apart < HOUR; apart += 5 * MINUTE) {
        const mika = pairDaysAt(rook + apart)
        expect(pairDaysAt(rook).some((day) => mika.includes(day))).toBe(true)
      }
  })

  it('know when to change next', () => {
    expect(untilPairDaysChange(at('2026-11-24T12:00:00Z'))).toBe(11 * HOUR)
    expect(untilPairDaysChange(at('2026-11-24T23:30:00Z'))).toBe(HOUR / 2)
    expect(untilPairDaysChange(at('2026-11-25T00:00:00Z'))).toBe(HOUR)
    expect(untilPairDaysChange(at('2026-11-25T00:10:00Z'))).toBe(50 * 60 * 1000)
    expect(utcDay(at('2026-11-25T00:10:00Z'))).toBe('2026-11-25')
  })

  it('are the secret’s rooms for the days around now, locked with its password', async () => {
    const noon = at('2026-11-24T12:00:00Z')
    const password = await pairPassword(fakeCrypto, secret)
    const today = { name: await pairRoomOn(fakeCrypto, secret, '2026-11-24'), password }
    expect(await pairRoomsAt(fakeCrypto, secret, noon)).toEqual([today])
  })
})
