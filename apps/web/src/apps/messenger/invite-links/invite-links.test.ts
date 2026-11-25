import { base32Encode, decodeInviteLink } from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import { inviteMessage } from './invite-links.tsx'

const bytes = (fill: number) => base32Encode(new Uint8Array(16).fill(fill))
const url = `https://pigeon.tomszir.com/#a/${bytes(1)}${bytes(2)}`

describe('inviteMessage', () => {
  it('says who the link is from, with the link on a line of its own', () => {
    expect(inviteMessage(' Toms ', url)).toBe(`Toms invites you to Pigeon!\n${url}`)
  })

  it('still invites without a name', () => {
    expect(inviteMessage('', url)).toBe(`You're invited to Pigeon!\n${url}`)
  })

  it('opens whole when pasted back, as the link alone does', () => {
    expect(decodeInviteLink(url).ok).toBe(true)
    expect(decodeInviteLink(inviteMessage('Toms', url))).toEqual(decodeInviteLink(url))
    expect(decodeInviteLink(inviteMessage('#1 Toms', url))).toEqual(decodeInviteLink(url))
  })
})
