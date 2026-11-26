import { argon2Sync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { ARGON2ID_KEY_BYTES, type Argon2idParams, utf8Encode } from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import { createArgon2id } from './argon2id.ts'

// Node can't fetch a file: URL, so the tests hand the module's bytes over themselves.
const wasm = () => readFileSync(new URL('../../pkg/pigeon_crypto_bg.wasm', import.meta.url))
const argon2id = createArgon2id(wasm)
const salt = Uint8Array.from({ length: 16 }, (_, index) => index)
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')
const cheap: Argon2idParams = { memoryKiB: 64, passes: 1, lanes: 1 }

describe('createArgon2id', () => {
  it('matches known answers from OpenSSL, which also reproduces RFC 9106’s own vector', async () => {
    const key = (text: string, memoryKiB: number, passes: number, lanes: number) =>
      argon2id.derive(utf8Encode(text), salt, { memoryKiB, passes, lanes })
    expect(hex(await key('password', 64, 1, 1))).toBe(
      '9c493022877348e034719bce110c99301e5d4d16acacc6a829000ff2044b1b0c',
    )
    expect(hex(await key('correct horse battery staple', 1024, 3, 2))).toBe(
      'c6acf874997f47dbbde84359fde02b8a99d29d7ed745e9a5e99a9fdce46e0724',
    )
    expect(hex(await key('pässword', 19456, 2, 1))).toBe(
      'e7f5bcedca960c494fda0b674c8abfa8348fd73a2900dc592e89e4a1b4b65d6c',
    )
    // And against Node's own, live, at the parameters files are made with.
    const openssl = argon2Sync('argon2id', {
      message: 'password',
      nonce: salt,
      parallelism: 4,
      tagLength: 32,
      memory: 65536,
      passes: 3,
    })
    expect(hex(await key('password', 65536, 3, 4))).toBe(hex(openssl))
  })

  it('gives 32 bytes, the same each time', async () => {
    const first = await argon2id.derive(utf8Encode('pw'), salt, cheap)
    expect(first).toBeInstanceOf(Uint8Array)
    expect(first).toHaveLength(ARGON2ID_KEY_BYTES)
    expect(await argon2id.derive(utf8Encode('pw'), salt, cheap)).toEqual(first)
  })

  it('takes only bytes and whole 32-bit counts, which the glue would otherwise bend', async () => {
    const text = 'pw' as unknown as Uint8Array
    await expect(argon2id.derive(text, salt, cheap)).rejects.toThrow(TypeError)
    await expect(
      argon2id.derive(utf8Encode('pw'), [1] as unknown as Uint8Array, cheap),
    ).rejects.toThrow(TypeError)
    for (const memoryKiB of [-1, 1.5, Number.NaN, 2 ** 32, '64' as unknown as number])
      await expect(
        argon2id.derive(utf8Encode('pw'), salt, { ...cheap, memoryKiB }),
      ).rejects.toThrow(RangeError)
  })

  it('refuses what the library refuses', async () => {
    const pw = utf8Encode('pw')
    await expect(argon2id.derive(pw, new Uint8Array(7), cheap)).rejects.toThrow(RangeError)
    await expect(argon2id.derive(pw, salt, { ...cheap, passes: 0 })).rejects.toThrow(RangeError)
    await expect(argon2id.derive(pw, salt, { ...cheap, lanes: 0 })).rejects.toThrow(RangeError)
    await expect(argon2id.derive(pw, salt, { ...cheap, memoryKiB: 7 })).rejects.toThrow(RangeError)
  })

  it('says so, and goes on working, when the module has no memory for the request', async () => {
    const huge = { memoryKiB: 0xffff_ffff, passes: 1, lanes: 1 }
    await expect(argon2id.derive(utf8Encode('pw'), salt, huge)).rejects.toThrow(RangeError)
    expect(await argon2id.derive(utf8Encode('pw'), salt, cheap)).toHaveLength(ARGON2ID_KEY_BYTES)
  })

  it('copies its inputs', async () => {
    const [passphrase, mine] = [utf8Encode('one'), Uint8Array.from(salt)]
    const first = await argon2id.derive(passphrase, mine, cheap)
    expect([...passphrase]).toEqual([...utf8Encode('one')])
    expect([...mine]).toEqual([...salt])
    expect(await argon2id.derive(utf8Encode('one'), salt, cheap)).toEqual(first)
  })

  it('leaves no copy of the passphrase or the key in the module’s memory', async () => {
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
    const passphrase = utf8Encode('a passphrase to look for, 7-crossover')
    const key = await argon2id.derive(passphrase, salt, { memoryKiB: 1024, passes: 2, lanes: 2 })
    expect(contains(passphrase)).toBe(false)
    expect(contains(key)).toBe(false)
  })
})
