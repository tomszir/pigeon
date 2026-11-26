// In a file of its own, so the module hasn't been instantiated by other tests first.
import { readFileSync } from 'node:fs'
import { utf8Encode } from '@pigeon/core'
import { expect, it } from 'vitest'
import { createArgon2id } from './argon2id.ts'

it('loads nothing until the first derivation, and tries again after a failed load', async () => {
  let calls = 0
  const argon2id = createArgon2id(async () => {
    calls += 1
    if (calls === 1) throw new Error('offline')
    return readFileSync(new URL('../../pkg/pigeon_crypto_bg.wasm', import.meta.url))
  })
  expect(calls).toBe(0)
  const derive = () =>
    argon2id.derive(utf8Encode('pw'), new Uint8Array(16), { memoryKiB: 64, passes: 1, lanes: 1 })
  await expect(derive()).rejects.toThrow('offline')
  expect(await derive()).toHaveLength(32)
  expect(calls).toBe(2)
})
