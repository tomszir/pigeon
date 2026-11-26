import { describe, expect, it } from 'vitest'
import { utf8Encode } from '../encoding/bytes.ts'
import { PAKE_KEY_BYTES } from '../pake/pake.ts'
import { fakePake } from './fake-pake.ts'

const [idA, idB] = [utf8Encode('alice'), utf8Encode('bob')]

async function exchange(passwordA: string, passwordB: string) {
  const pake = fakePake()
  const a = await pake.start('a', utf8Encode(passwordA), idA, idB)
  const b = await pake.start('b', utf8Encode(passwordB), idA, idB)
  return [await a.finish(b.message), await b.finish(a.message)]
}

describe('fakePake', () => {
  it('agrees on a 32-byte key when the passwords match', async () => {
    const [keyA, keyB] = await exchange('swordfish', 'swordfish')
    expect(keyA).toHaveLength(PAKE_KEY_BYTES)
    expect(keyA).toEqual(keyB)
  })

  it('gives different keys for different passwords', async () => {
    const [keyA, keyB] = await exchange('swordfish', 'swordfisH')
    expect(keyA).not.toEqual(keyB)
  })

  it('refuses a malformed or reflected message, and a second finish', async () => {
    const pake = fakePake()
    const a = await pake.start('a', utf8Encode('pw'), idA, idB)
    expect(await a.finish(a.message)).toBeUndefined()
    const again = await pake.start('a', utf8Encode('pw'), idA, idB)
    expect(await again.finish(new Uint8Array(32))).toBeUndefined()
    await expect(again.finish(new Uint8Array(33))).rejects.toThrow()
  })

  it('refuses bytes it did not make, as the real one refuses non-points', async () => {
    const a = await fakePake().start('a', utf8Encode('pw'), idA, idB)
    const forged = new Uint8Array(33)
    forged[0] = 0x42
    expect(await a.finish(forged)).toBeUndefined()
  })

  it('takes only bytes', async () => {
    const pake = fakePake()
    await expect(pake.start('a', 'pw' as unknown as Uint8Array, idA, idB)).rejects.toThrow(
      TypeError,
    )
    const a = await pake.start('a', utf8Encode('pw'), idA, idB)
    await expect(a.finish([1] as unknown as Uint8Array)).rejects.toThrow(TypeError)
  })

  it('copies its inputs at start', async () => {
    const pake = fakePake()
    const [passwordA, passwordB] = [utf8Encode('one'), utf8Encode('two')]
    const a = await pake.start('a', passwordA, idA, idB)
    const b = await pake.start('b', passwordB, idA, idB)
    passwordA.fill(0)
    passwordB.fill(0)
    expect(await a.finish(b.message)).not.toEqual(await b.finish(a.message))
  })

  it('refuses to finish once abandoned', async () => {
    const pake = fakePake()
    const a = await pake.start('a', utf8Encode('pw'), idA, idB)
    const b = await pake.start('b', utf8Encode('pw'), idA, idB)
    a.abandon()
    await expect(a.finish(b.message)).rejects.toThrow()
  })
})
