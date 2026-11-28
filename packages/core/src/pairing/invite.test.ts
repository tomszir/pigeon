import { describe, expect, it } from 'vitest'
import { fakeCrypto } from '../testing/testing.ts'
import {
  CODE_RANDOM_BYTES,
  decodeDeviceLink,
  decodeInvite,
  encodeDeviceLink,
  encodeInviteLink,
  formatCode,
  isLiveCode,
  isOwnCode,
  newCode,
  roomFor,
  roomsFor,
} from './invite.ts'

const code = newCode(Uint8Array.from({ length: CODE_RANDOM_BYTES }, (_, i) => (i * 37 + 11) % 256))
const print = '7f3a91c204bed817'

describe('live codes', () => {
  it('are a 4-character nameplate and a 6-character password, shown in three groups', () => {
    expect(code.nameplate).toMatch(/^[a-z2-7]{4}$/)
    expect(code.password).toMatch(/^[a-z2-7]{6}$/)
    expect(code.secret).toMatch(/^[a-z2-7]{26}$/)
    expect(isLiveCode(code)).toBe(true)
    expect(formatCode({ ...code, nameplate: 'k7rt', password: 'vp2bxq' })).toBe('K7RT-VP2-BXQ')
  })

  it('name the typed code’s room by the nameplate alone, and the link’s by its secret', async () => {
    const rooms = await roomsFor(fakeCrypto, 'invite', code)
    expect(rooms.code).toBe(`invite/v2:${code.nameplate}`)
    expect(rooms.link).toMatch(/^invite\/v2:[a-z2-7]{26}$/)
    for (const room of [rooms.code, rooms.link]) {
      expect(room).not.toContain(code.password)
      expect(room).not.toContain(code.secret)
    }
    expect((await roomsFor(fakeCrypto, 'link', code)).link).not.toBe(rooms.link)
    const typed = { via: 'code', nameplate: code.nameplate, secret: code.password } as const
    expect(await roomFor(fakeCrypto, 'invite', typed)).toBe(rooms.code)
    const linked = { via: 'link', secret: code.secret, fingerprint: print } as const
    expect(await roomFor(fakeCrypto, 'invite', linked)).toBe(rooms.link)
    expect(isOwnCode(code, typed) && isOwnCode(code, linked)).toBe(true)
    expect(isOwnCode(code, { ...typed, secret: 'aaaaaa' })).toBe(false)
  })

  it('read back typed any way, forgiving the digits people put for letters', () => {
    const typed = { ok: true, value: { via: 'code', nameplate: 'k7rt', secret: 'vp2bxq' } }
    for (const text of ['K7RT-VP2-BXQ', 'k7rtvp2bxq', ' k7rt vp2 bxq ', 'K7RT-VP2-BXQ\n'])
      expect(decodeInvite(text)).toEqual(typed)
    expect(decodeInvite('L00K-AT1-1AB')).toEqual({
      ok: true,
      value: { via: 'code', nameplate: 'look', secret: 'atllab' },
    })
  })

  it('reject the wrong length and characters base32 lacks', () => {
    for (const typed of ['K7RT-VP2-BXQQ', 'K7RT-VP2-BX9', '', 'K7RT-VP', 'K7RT-VP2B'])
      expect(decodeInvite(typed)).toEqual({ ok: false, error: 'malformed' })
  })
})

describe('code links', () => {
  it('carry a 128-bit secret and the fingerprint, never the code', () => {
    const fragment = encodeInviteLink(code, print)
    expect(fragment).toMatch(/^i\/[a-z2-7]{39}$/)
    expect(fragment.slice(2)).not.toContain(code.password)
    const opened = { ok: true, value: { via: 'link', secret: code.secret, fingerprint: print } }
    for (const text of [fragment, `https://pigeon.tomszir.com/#${fragment}`, `  ${fragment}\n`])
      expect(decodeInvite(text)).toEqual(opened)
  })

  it('reject a link cut short, a secret spelled two ways, or a page address with no invite', () => {
    const link = `https://pigeon.tomszir.com/#${encodeInviteLink(code, print)}`
    // A secret's last character carries two unused bits, which must be zero.
    const fragment = encodeInviteLink(code, print)
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
    const last = alphabet.indexOf(fragment[2 + 25] ?? 'a')
    const respelled = `${fragment.slice(0, 2 + 25)}${alphabet[last ^ 1]}${fragment.slice(2 + 26)}`
    for (const text of [
      link.slice(0, -3),
      'https://pigeon.tomszir.com/',
      'https://x/#invite/abc',
      respelled,
    ])
      expect(decodeInvite(text).ok).toBe(false)
  })

  it('read device links apart from invites', () => {
    const link = `https://pigeon.test/#${encodeDeviceLink(code, print)}`
    expect(decodeDeviceLink(link)).toEqual({
      ok: true,
      value: { via: 'link', secret: code.secret, fingerprint: print },
    })
    expect(decodeInvite(link).ok).toBe(false)
  })
})
