// In a file of its own, so the module hasn't been instantiated by other tests first.
import { readFileSync } from 'node:fs'
import { utf8Encode } from '@pigeon/core'
import { expect, it } from 'vitest'
import { createSpake2Pake } from './spake2.ts'

it('loads nothing until the first start, and tries again after a failed load', async () => {
  let calls = 0
  const pake = createSpake2Pake(async () => {
    calls += 1
    if (calls === 1) throw new Error('offline')
    return readFileSync(new URL('../../pkg/pigeon_crypto_bg.wasm', import.meta.url))
  })
  expect(calls).toBe(0)
  const start = () => pake.start('a', utf8Encode('pw'), utf8Encode('A'), utf8Encode('B'))
  await expect(start()).rejects.toThrow('offline')
  expect((await start()).message).toHaveLength(33)
  expect(calls).toBe(2)
})
