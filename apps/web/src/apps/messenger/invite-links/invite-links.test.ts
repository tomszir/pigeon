import { base32Encode, decodeInviteLink } from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import { inviteMessage, MAKE_ERRORS, shortLink } from './invite-links.tsx'

const bytes = (fill: number) => base32Encode(new Uint8Array(16).fill(fill))
const url = `https://pigeon.tomszir.com/#b/${bytes(1)}${bytes(2)}${bytes(3)}aaaaaaab`

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

describe('making a link', () => {
  it('says plainly why it was not made when a Lighthouse openers read is out of reach', () => {
    expect(MAKE_ERRORS['not-stored']).toMatch(/official Lighthouse can't be reached right now/)
    expect(MAKE_ERRORS['not-stored']).toMatch(/Try again in a moment/)
    expect(MAKE_ERRORS['named-not-stored']).toMatch(/can't be reached right now/)
  })
})

describe('your links', () => {
  it('shortens a link to its start and end', () => {
    expect(shortLink(url)).toBe(`pigeon.tomszir.com/#b/${bytes(1).slice(0, 4)}…aaaaab`)
  })
})
