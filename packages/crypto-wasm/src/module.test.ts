// In a file of its own, so the module hasn't been instantiated by other tests first.
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { moduleLoader } from './module.ts'

const bytes = () => readFileSync(new URL('../pkg/pigeon_crypto_bg.wasm', import.meta.url))

it('gives one instance, refuses another source, and keeps refusing it after a joiner', async () => {
  let calls = 0
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const sourceA = async () => {
    calls += 1
    await gate
    return bytes()
  }
  const sourceB = async () => bytes()
  const joinerFails = async () => {
    throw new Error('this source must not be called')
  }

  // A load in flight: the same source joins it, another is refused.
  const first = moduleLoader(sourceA)()
  await expect(moduleLoader(sourceB)()).rejects.toThrow('different source')
  await expect(moduleLoader()()).rejects.toThrow('different source')
  const joined = moduleLoader(sourceA)()
  release()
  const [glue, same] = await Promise.all([first, joined])
  expect(same).toBe(glue)
  expect(calls).toBe(1)

  // Loaded: the same source gets it without calling anything, and the others stay refused.
  expect(await moduleLoader(sourceA)()).toBe(glue)
  await expect(moduleLoader(sourceB)()).rejects.toThrow('different source')
  await expect(moduleLoader(joinerFails)()).rejects.toThrow('different source')
  await expect(moduleLoader()()).rejects.toThrow('different source')
  expect(calls).toBe(1)
})
