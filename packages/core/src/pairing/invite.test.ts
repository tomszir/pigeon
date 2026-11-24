import { describe, expect, it } from 'vitest'
import {
  decodeInvite,
  encodeInviteLink,
  formatInviteCode,
  INVITE_CODE_BYTES,
  inviteCode,
} from './invite.ts'

const code = inviteCode(new Uint8Array(INVITE_CODE_BYTES).fill(7))
const print = '7f3a91c204bed817'

describe('invite codes', () => {
  it('are 8 base32 characters, shown in two fours', () => {
    expect(code).toMatch(/^[a-z2-7]{8}$/)
    expect(formatInviteCode('k7rtvp2b')).toBe('K7RT-VP2B')
  })

  it('read back typed any way, forgiving the digits people put for letters', () => {
    for (const typed of ['K7RT-VP2B', 'k7rtvp2b', ' k7rt vp2b ', 'K7RT-VP2B\n'])
      expect(decodeInvite(typed)).toEqual({ ok: true, value: { code: 'k7rtvp2b' } })
    expect(decodeInvite('L00K-AT11')).toEqual({ ok: true, value: { code: 'lookatll' } })
  })

  it('reject the wrong length and characters base32 lacks', () => {
    for (const typed of ['K7RT-VP2', 'K7RT-VP2BB', 'K7RT-VP29', ''])
      expect(decodeInvite(typed).ok).toBe(false)
  })
})

describe('invite links', () => {
  it('carry the code and the fingerprint in 23 characters after #', () => {
    const fragment = encodeInviteLink(code, print)
    expect(fragment).toMatch(/^i\/[a-z2-7]{21}$/)
    for (const text of [fragment, `https://pigeon.tomszir.com/#${fragment}`, `  ${fragment}\n`])
      expect(decodeInvite(text)).toEqual({ ok: true, value: { code, fingerprint: print } })
  })

  it('reject a link cut short or a page address with no invite', () => {
    const link = `https://pigeon.tomszir.com/#${encodeInviteLink(code, print)}`
    for (const text of [link.slice(0, -3), 'https://pigeon.tomszir.com/', 'https://x/#invite/abc'])
      expect(decodeInvite(text).ok).toBe(false)
  })
})
