import { readFileSync } from 'node:fs'
import { PAKE_KEY_BYTES, utf8Encode } from '@pigeon/core'
import { describe, expect, it, vi } from 'vitest'
import { createSpake2Pake } from './spake2.ts'

// Node can't fetch a file: URL, so the tests hand the module's bytes over themselves.
const wasm = () => readFileSync(new URL('../../pkg/pigeon_crypto_bg.wasm', import.meta.url))
const pake = createSpake2Pake(wasm)
const [idA, idB] = [utf8Encode('alice'), utf8Encode('bob')]

async function exchange(passwordA: string, passwordB: string) {
  const a = await pake.start('a', utf8Encode(passwordA), idA, idB)
  const b = await pake.start('b', utf8Encode(passwordB), idA, idB)
  return [await a.finish(b.message), await b.finish(a.message)]
}

describe('createSpake2Pake', () => {
  it('agrees on a 32-byte key when the passwords match', async () => {
    const [keyA, keyB] = await exchange('7-crossover-clockwork', '7-crossover-clockwork')
    expect(keyA).toBeInstanceOf(Uint8Array)
    expect(keyA).toHaveLength(PAKE_KEY_BYTES)
    expect(keyA).toEqual(keyB)
  })

  it('gives fresh keys each exchange', async () => {
    const [first] = await exchange('pw', 'pw')
    const [second] = await exchange('pw', 'pw')
    expect(first).not.toEqual(second)
  })

  it('gives different keys for a wrong password', async () => {
    const [keyA, keyB] = await exchange('7-crossover-clockwork', '7-crossover-clockworm')
    expect(keyA).not.toEqual(keyB)
  })

  it('gives different keys when the identities differ', async () => {
    const a = await pake.start('a', utf8Encode('pw'), idA, idB)
    const b = await pake.start('b', utf8Encode('pw'), idA, utf8Encode('mallory'))
    expect(await a.finish(b.message)).not.toEqual(await b.finish(a.message))
  })

  it('sends 33-byte messages that say their side', async () => {
    const a = await pake.start('a', utf8Encode('pw'), idA, idB)
    const b = await pake.start('b', utf8Encode('pw'), idA, idB)
    expect([a.message.length, a.message[0]]).toEqual([33, 0x41])
    expect([b.message.length, b.message[0]]).toEqual([33, 0x42])
  })

  it('refuses malformed messages', async () => {
    const b = await pake.start('b', utf8Encode('pw'), idA, idB)
    const notAPoint = new Uint8Array(33)
    notAPoint.set([0x42, 2])
    const longer = new Uint8Array(34)
    longer.set(b.message)
    for (const message of [new Uint8Array(0), b.message.subarray(0, 32), longer, notAPoint]) {
      const a = await pake.start('a', utf8Encode('pw'), idA, idB)
      expect(await a.finish(message)).toBeUndefined()
    }
  })

  it('takes only bytes, since the glue would read a string as no bytes', async () => {
    const text = 'pw' as unknown as Uint8Array
    await expect(pake.start('a', text, idA, idB)).rejects.toThrow(TypeError)
    const a = await pake.start('a', utf8Encode('pw'), idA, idB)
    await expect(a.finish([1, 2] as unknown as Uint8Array)).rejects.toThrow(TypeError)
    a.abandon()
  })

  it('copies its inputs at start', async () => {
    const [passwordA, passwordB] = [utf8Encode('one'), utf8Encode('two')]
    const a = await pake.start('a', passwordA, idA, idB)
    const b = await pake.start('b', passwordB, idA, idB)
    passwordA.fill(0)
    passwordB.fill(0)
    expect(await a.finish(b.message)).not.toEqual(await b.finish(a.message))
  })

  it('refuses a huge message without copying it into the module', async () => {
    const { memory } = await (await import('../../pkg/pigeon_crypto.js')).default({
      module_or_path: wasm(),
    })
    const before = memory.buffer.byteLength
    const a = await pake.start('a', utf8Encode('pw'), idA, idB)
    expect(await a.finish(new Uint8Array(64 * 1024 * 1024))).toBeUndefined()
    expect(memory.buffer.byteLength).toBe(before)
    await expect(a.finish(new Uint8Array(33))).rejects.toThrow('ended')
  })

  it('refuses its own message reflected back', async () => {
    const a = await pake.start('a', utf8Encode('pw'), idA, idB)
    expect(await a.finish(a.message)).toBeUndefined()
  })

  it('finishes once', async () => {
    const a = await pake.start('a', utf8Encode('pw'), idA, idB)
    const b = await pake.start('b', utf8Encode('pw'), idA, idB)
    await a.finish(b.message)
    await expect(a.finish(b.message)).rejects.toThrow('ended')
  })

  it('refuses to finish once abandoned, and abandons quietly after finishing', async () => {
    const a = await pake.start('a', utf8Encode('pw'), idA, idB)
    const b = await pake.start('b', utf8Encode('pw'), idA, idB)
    a.abandon()
    a.abandon()
    await expect(a.finish(b.message)).rejects.toThrow('ended')
    expect(await b.finish(a.message)).toHaveLength(PAKE_KEY_BYTES)
    b.abandon()
  })

  it('leaves nothing of a session’s randomness in the array getrandom stages it in', async () => {
    // getrandom fills one JavaScript array, kept for the page, and copies from it. Record each
    // fill: the first in a start is the seed of the session's secret scalar.
    const fills: { array: Uint8Array; bytes: Uint8Array }[] = []
    const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
    const spy = vi
      .spyOn(globalThis.crypto, 'getRandomValues')
      .mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
        const filled = real(array as unknown as Uint8Array)
        fills.push({ array: filled, bytes: filled.slice() })
        return array
      })
    try {
      const a = await pake.start('a', utf8Encode('pw'), idA, idB)
      const [seed] = fills
      expect(seed?.bytes).toHaveLength(64)
      const staged = new Uint8Array(seed?.array.buffer ?? new ArrayBuffer(0)).subarray(0, 64)
      expect(staged).not.toEqual(seed?.bytes)
      a.abandon()
    } finally {
      spy.mockRestore()
    }
  })

  it('leaves no copy of the password or the key in the module’s memory', async () => {
    const { memory } = await (await import('../../pkg/pigeon_crypto.js')).default({
      module_or_path: wasm(),
    })
    const contains = (needle: Uint8Array) => {
      const haystack = new Uint8Array(memory.buffer)
      outer: for (let at = 0; at + needle.length <= haystack.length; at++) {
        for (let index = 0; index < needle.length; index++)
          if (haystack[at + index] !== needle[index]) continue outer
        return true
      }
      return false
    }
    const password = utf8Encode('a password to look for, 7-crossover')
    const a = await pake.start('a', password, idA, idB)
    const b = await pake.start('b', password, idA, idB)
    const abandoned = await pake.start('a', utf8Encode('abandoned, 9-clockwork'), idA, idB)
    expect(contains(password)).toBe(true)
    const key = await a.finish(b.message)
    await b.finish(a.message)
    abandoned.abandon()
    expect(key).toHaveLength(PAKE_KEY_BYTES)
    expect(contains(password)).toBe(false)
    expect(contains(utf8Encode('abandoned, 9-clockwork'))).toBe(false)
    expect(contains(key ?? new Uint8Array(0))).toBe(false)
  })
})
