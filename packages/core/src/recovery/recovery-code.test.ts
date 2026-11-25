import { describe, expect, it } from 'vitest'
import { fakeCrypto, fakeSigner } from '../testing/testing.ts'
import { decodeRecoveryCode, encodeRecoveryCode } from './recovery-code.ts'

const identity = fakeSigner('toms-laptop').id
const seed = Uint8Array.from({ length: 32 }, (_, index) => index)

describe('recovery codes', () => {
  it('round-trip, typed any old way', async () => {
    const code = await encodeRecoveryCode(fakeCrypto, { identity, epoch: 1, seed })
    expect(code).toMatch(/^([A-Z2-7]{4}-)+[A-Z2-7]{1,4}$/)
    expect(code.split('-')).toHaveLength(28)
    const typed = ` ${code.toLowerCase().replaceAll('-', ' ')} `
    expect(await decodeRecoveryCode(fakeCrypto, typed)).toEqual({
      ok: true,
      value: { identity, epoch: 1, seed },
    })
  })

  it('catch a letter copied wrong, and text that is no code', async () => {
    const code = await encodeRecoveryCode(fakeCrypto, { identity, epoch: 2, seed })
    const wrong = `${code.slice(0, 5)}${code[5] === 'A' ? 'B' : 'A'}${code.slice(6)}`
    expect(await decodeRecoveryCode(fakeCrypto, wrong)).toEqual({ ok: false, error: 'mistyped' })
    expect(await decodeRecoveryCode(fakeCrypto, 'ABCD-EFGH')).toEqual({
      ok: false,
      error: 'malformed',
    })
  })
})
