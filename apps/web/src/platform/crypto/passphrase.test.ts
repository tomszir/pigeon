import type { Argon2id, Argon2idParams } from '@pigeon/core'
import { describe, expect, it, vi } from 'vitest'
import {
  ARGON2ID_LIMITS,
  ARGON2ID_PARAMS,
  createPassphraseSeal,
  type PassphraseSealer,
} from './passphrase.ts'

const data = new TextEncoder().encode('{"friends":[]}')
const cheap: Argon2idParams = { memoryKiB: 64, passes: 1, lanes: 1 }

/**
 * A stand-in that is fast, deterministic and uses every input, so these tests are about the
 * file format; the real Argon2id has its own tests in packages/crypto-wasm.
 */
const stretches: Argon2idParams[] = []
const stand: Argon2id = {
  async derive(passphrase, salt, params) {
    stretches.push(params)
    const input = new Uint8Array([
      ...passphrase,
      ...salt,
      ...new TextEncoder().encode(JSON.stringify(params)),
    ])
    return new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  },
}
const sealer = (params = cheap) => createPassphraseSeal({ argon2id: stand, params })

// Sealed by 0.8.0's code (PBKDF2-SHA256 in WebCrypto, version 1), with these passphrases.
const V1_AT_600K =
  'pigeon-sealed:v1:600000:VatgPb3dXHCvQYQ3AI/A+Q==:1pvM9+gm+nN8ehAq:LK0HGLlBWbDdVu5vzEpnHwO8y8VSP5Hkv7RhIuCu'
const V1_AT_1000 =
  'pigeon-sealed:v1:1000:z+jaBD8z1b99xVe1O2y9XA==:uBPdgj+z3umqa+fb:ZsRP+Ijlpfdkz8Ds3RKBTOMMBSBFAmEDQo5jcZCL'

describe('sealing with a passphrase', () => {
  it('writes version 2 with its Argon2id parameters, and opens it, inside a text file too', async () => {
    const sealed = await sealer().seal('correct horse', data)
    expect(sealed).toMatch(/^pigeon-sealed:v2:64:1:1:[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]{16}:/)
    const file = `Pigeon data\nSomething to read first.\n${sealed}\n`
    expect(await sealer().open('correct horse', file)).toEqual(data)
  })

  it('seals new files with RFC 9106’s second recommended parameters', async () => {
    stretches.length = 0
    const sealed = await createPassphraseSeal({ argon2id: stand }).seal('correct horse', data)
    expect(stretches).toEqual([{ memoryKiB: 65536, passes: 3, lanes: 4 }])
    expect(ARGON2ID_PARAMS).toEqual({ memoryKiB: 65536, passes: 3, lanes: 4 })
    expect(sealed).toMatch(/^pigeon-sealed:v2:65536:3:4:/)
  })

  it('opens with the parameters in the file, not the ones it would seal with now', async () => {
    const sealed = await sealer({ memoryKiB: 128, passes: 2, lanes: 2 }).seal('correct horse', data)
    stretches.length = 0
    expect(await sealer(cheap).open('correct horse', sealed)).toEqual(data)
    expect(stretches).toEqual([{ memoryKiB: 128, passes: 2, lanes: 2 }])
  })

  it('refuses a wrong passphrase, a changed file and text that was never sealed', async () => {
    const sealed = await sealer().seal('correct horse', data)
    expect(await sealer().open('wrong horse', sealed)).toBeUndefined()
    expect(await sealer().open('correct horse', `${sealed.slice(0, -4)}AAA=`)).toBeUndefined()
    expect(await sealer().open('correct horse', 'hello')).toBeUndefined()
    expect(await sealer().open('correct horse', '')).toBeUndefined()
  })

  it('skips lines that only look sealed, to the one that is', async () => {
    const sealed = await sealer().seal('correct horse', data)
    const file = `pigeon-sealed:v3:x\npigeon-sealed:\n${sealed}\n`
    expect(await sealer().open('correct horse', file)).toEqual(data)
  })

  it('treats the same text typed in either Unicode form as one passphrase', async () => {
    const sealed = await sealer().seal('pässword', data)
    expect(await sealer().open('pässword', sealed)).toEqual(data)
  })

  it('opens a file from 0.8.0, sealed with PBKDF2, without touching Argon2id', async () => {
    const never = { derive: vi.fn() }
    const seal: PassphraseSealer = createPassphraseSeal({ argon2id: never })
    expect(await seal.open('correct horse', V1_AT_600K)).toEqual(data)
    expect(await seal.open('pässwörd one', `Pigeon data\n${V1_AT_1000}\n`)).toEqual(data)
    expect(await seal.open('wrong horse', V1_AT_1000)).toBeUndefined()
    expect(never.derive).not.toHaveBeenCalled()
  })

  it('writes a different salt and iv each time', async () => {
    const [first, second] = [await sealer().seal('pw', data), await sealer().seal('pw', data)]
    const [a, b] = [first.split(':'), second.split(':')]
    expect(a[5]).not.toEqual(b[5])
    expect(a[6]).not.toEqual(b[6])
    expect(a[7]).not.toEqual(b[7])
  })

  it('lets a failure to stretch the passphrase through, as no verdict on it', async () => {
    const sealed = await sealer().seal('pw', data)
    const failing: Argon2id = {
      derive: () => Promise.reject(new RangeError('no memory')),
    }
    const seal = createPassphraseSeal({ argon2id: failing, params: cheap })
    await expect(seal.open('pw', sealed)).rejects.toThrow(RangeError)
    await expect(seal.seal('pw', data)).rejects.toThrow(RangeError)
  })

  it('wipes the passphrase bytes and the key it handed over', async () => {
    const seen: Uint8Array[] = []
    const spying: Argon2id = {
      async derive(passphrase, salt, params) {
        seen.push(passphrase)
        const key = await stand.derive(passphrase, salt, params)
        seen.push(key)
        return key
      },
    }
    await createPassphraseSeal({ argon2id: spying, params: cheap }).seal('correct horse', data)
    expect(seen).toHaveLength(2)
    for (const bytes of seen) expect([...bytes].every((byte) => byte === 0)).toBe(true)
  })

  it('won’t be made to seal with parameters a file couldn’t ask for', () => {
    expect(() => sealer({ memoryKiB: ARGON2ID_LIMITS.memoryKiB + 1, passes: 1, lanes: 1 })).toThrow(
      RangeError,
    )
    expect(() => sealer({ memoryKiB: 4, passes: 1, lanes: 1 })).toThrow(RangeError)
  })
})

describe('a hostile file', () => {
  const salt = 'AAECAwQFBgcICQoLDA0ODw=='
  const iv = 'AAECAwQFBgcICQoL'
  const body = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYX'
  const line = (...fields: (string | number)[]) => ['pigeon-sealed', 'v2', ...fields].join(':')

  /** Opens it with a stretcher that fails the test if it is ever asked. */
  async function refused(text: string) {
    const derive = vi.fn(() => Promise.reject(new Error('should not have stretched')))
    const result = await createPassphraseSeal({ argon2id: { derive } }).open('correct horse', text)
    expect(derive).not.toHaveBeenCalled()
    return result
  }

  it('does reach the stretcher when it is well formed, so the refusals below are for cause', async () => {
    const derive = vi.fn(() => Promise.resolve(new Uint8Array(32)))
    const seal = createPassphraseSeal({ argon2id: { derive } })
    const { memoryKiB, passes, lanes } = ARGON2ID_LIMITS
    for (const text of [
      line(64, 1, 1, salt, iv, body),
      line(8 * lanes, 1, lanes, salt, iv, body),
      line(memoryKiB, passes, lanes, salt, iv, body),
    ])
      expect(await seal.open('pw', text)).toBeUndefined()
    expect(derive).toHaveBeenCalledTimes(3)
  })

  it('can’t ask for more memory, time or lanes than a file may', async () => {
    const { memoryKiB, passes, lanes } = ARGON2ID_LIMITS
    expect(await refused(line(memoryKiB + 1, 3, 1, salt, iv, body))).toBeUndefined()
    expect(await refused(line(4294967295, 1, 1, salt, iv, body))).toBeUndefined()
    expect(await refused(line(65536, passes + 1, 1, salt, iv, body))).toBeUndefined()
    expect(await refused(line(65536, 4294967295, 1, salt, iv, body))).toBeUndefined()
    expect(await refused(line(65536, 3, lanes + 1, salt, iv, body))).toBeUndefined()
    expect(await refused(line(65536, 3, 16777215, salt, iv, body))).toBeUndefined()
  })

  it('can’t ask for less than Argon2id takes', async () => {
    expect(await refused(line(0, 3, 1, salt, iv, body))).toBeUndefined()
    expect(await refused(line(7, 3, 1, salt, iv, body))).toBeUndefined()
    expect(await refused(line(8, 3, 2, salt, iv, body))).toBeUndefined()
    expect(await refused(line(64, 0, 1, salt, iv, body))).toBeUndefined()
    expect(await refused(line(64, 1, 0, salt, iv, body))).toBeUndefined()
  })

  it('has to spell its numbers one way', async () => {
    for (const memory of ['064', '+64', '64.0', '6.4e1', '0x40', ' 64', '64 ', '-64', 'NaN', ''])
      expect(await refused(line(memory, 1, 1, salt, iv, body))).toBeUndefined()
  })

  it('has to be exactly the fields, with salt and iv of one length and canonical base64', async () => {
    expect(await refused(line(64, 1, 1, salt, iv))).toBeUndefined()
    expect(await refused(`${line(64, 1, 1, salt, iv, body)}:extra`)).toBeUndefined()
    expect(await refused(line(64, 1, 1, 'AAECAwQFBgcICQoL', iv, body))).toBeUndefined()
    expect(await refused(line(64, 1, 1, salt, 'AAECAwQFBgcICQoLDA0ODw==', body))).toBeUndefined()
    // The same 16 bytes of salt with a stray bit set in the padding: not the spelling we write.
    expect(await refused(line(64, 1, 1, 'AAECAwQFBgcICQoLDA0ODx==', iv, body))).toBeUndefined()
    expect(await refused(line(64, 1, 1, salt, iv, `${body}!`))).toBeUndefined()
    expect(await refused(line(64, 1, 1, salt, iv, ' '))).toBeUndefined()
    expect(await refused(line(64, 1, 1, salt, iv, 'AAECAwQFBgcICQoLDA0O'))).toBeUndefined()
  })

  it('can’t name a version Pigeon doesn’t write', async () => {
    expect(await refused('pigeon-sealed:v3:1:2:3:4:5:6')).toBeUndefined()
    expect(await refused('pigeon-sealed::64:1:1')).toBeUndefined()
    expect(await refused('pigeon-sealed:')).toBeUndefined()
  })

  it('can’t ask for a million PBKDF2 rounds more than Pigeon ever wrote', async () => {
    expect(
      await refused('pigeon-sealed:v1:10000001:AAECAwQFBgcICQoLDA0ODw==:AAECAwQFBgcICQoL:AAAA'),
    ).toBeUndefined()
    expect(
      await refused('pigeon-sealed:v1:1e9:AAECAwQFBgcICQoLDA0ODw==:AAECAwQFBgcICQoL:AAAA'),
    ).toBeUndefined()
    expect(
      await refused('pigeon-sealed:v1:0:AAECAwQFBgcICQoLDA0ODw==:AAECAwQFBgcICQoL:AAAA'),
    ).toBeUndefined()
  })
})
