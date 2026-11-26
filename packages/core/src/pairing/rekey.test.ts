import { describe, expect, it } from 'vitest'
import { emptyDeviceLog } from '../devices/device-log.ts'
import { fakeCrypto, fakeSigner } from '../testing/testing.ts'
import {
  type Rekey,
  readRekey,
  rekeyBody,
  rekeyWins,
  replacesId,
  signRekey,
  verifyRekey,
} from './rekey.ts'

const secret = (fill: string) => `${fill.repeat(51)}a`
const rook = fakeSigner('rook').id
const mika = fakeSigner('mika').id

describe('a secret replaced by sealed mail', () => {
  it('names the old secret by a value only its holders can make', async () => {
    const id = await replacesId(fakeCrypto, secret('a'))
    expect(id).toMatch(/^[a-z2-7]{52}$/)
    expect(id).not.toContain(secret('a'))
    expect(await replacesId(fakeCrypto, secret('b'))).not.toBe(id)
  })

  it('reads back exactly what it writes, and nothing spelled another way', async () => {
    const rekey = await signRekey(fakeSigner('rook'), {
      replaces: await replacesId(fakeCrypto, secret('a')),
      secret: secret('b'),
      at: 5,
    })
    expect(readRekey(rekeyBody(rekey))).toEqual({ rekey })
    expect(readRekey(rekeyBody(rekey, { friend: mika }))).toEqual({ rekey, friend: mika })
    const logs = [emptyDeviceLog(rook), emptyDeviceLog(mika)]
    expect(readRekey(rekeyBody(rekey, { logs }))).toEqual({ rekey, logs })
    expect(readRekey({ ...(rekeyBody(rekey) as object), logs: [...logs, ...logs] })).toBeUndefined()
    expect(readRekey({ ...(rekeyBody(rekey) as object), logs: [{}] })).toBeUndefined()
    const body = rekeyBody(rekey) as Record<string, unknown>
    expect(readRekey({ ...body, secret: secret('B') })).toBeUndefined()
    expect(readRekey({ ...body, at: -1 })).toBeUndefined()
    expect(readRekey({ ...body, at: 1.5 })).toBeUndefined()
    expect(readRekey({ ...body, v: 'pigeon/rekey/v2' })).toBeUndefined()
    expect(readRekey({ ...body, extra: 1 })).toBeUndefined()
    expect(readRekey({ ...body, by: 'nobody' })).toBeUndefined()
    expect(readRekey({ ...body, sig: undefined })).toBeUndefined()
    expect(readRekey({ ...body, sig: `${rekey.sig}=` })).toBeUndefined()
    expect(readRekey([])).toBeUndefined()
  })

  it('orders proposals the same way everywhere: earliest, then device, then secret', async () => {
    const replaces = await replacesId(fakeCrypto, secret('a'))
    const one: Rekey = { replaces, secret: secret('b'), at: 1, by: rook, sig: '' }
    const later: Rekey = { ...one, at: 2 }
    expect(rekeyWins(one, later)).toBe(true)
    expect(rekeyWins(later, one)).toBe(false)
    const other: Rekey = { ...one, by: mika }
    expect(rekeyWins(one, other)).not.toBe(rekeyWins(other, one))
    const lower: Rekey = { ...one, secret: secret('a') }
    expect(rekeyWins(lower, one)).toBe(true)
    expect(rekeyWins(one, one)).toBe(false)
  })

  it("counts a proposal only with its maker's signature over all of it", async () => {
    const replaces = await replacesId(fakeCrypto, secret('a'))
    const rekey = await signRekey(fakeSigner('rook'), { replaces, secret: secret('b'), at: 5 })
    expect(rekey.by).toBe(rook)
    expect(await verifyRekey(fakeCrypto, rekey)).toBe(true)
    // Another device can't put its proposal in Rook's name, nor change any part of his.
    expect(await verifyRekey(fakeCrypto, { ...rekey, by: mika })).toBe(false)
    expect(await verifyRekey(fakeCrypto, { ...rekey, at: 0 })).toBe(false)
    expect(await verifyRekey(fakeCrypto, { ...rekey, secret: secret('c') })).toBe(false)
    expect(await verifyRekey(fakeCrypto, { ...rekey, replaces: secret('c') })).toBe(false)
    const mikas = await signRekey(fakeSigner('mika'), { replaces, secret: secret('b'), at: 5 })
    expect(await verifyRekey(fakeCrypto, { ...rekey, sig: mikas.sig })).toBe(false)
  })
})
