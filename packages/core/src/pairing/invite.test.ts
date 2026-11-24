import { expect, it } from 'vitest'
import { fakeSigner } from '../testing/testing.ts'
import { decodeInvite, encodeInvite, INVITE_TOKEN_BYTES, inviteToken } from './invite.ts'

const invite = {
  id: fakeSigner('rook').id,
  token: inviteToken(new Uint8Array(INVITE_TOKEN_BYTES).fill(7)),
  handle: 'Rook / the 2nd 🐦',
}

it('round-trips an invite, handle and all', () => {
  const text = encodeInvite(invite)
  expect(text).toMatch(/^invite\/[a-z2-7]+\/[a-z2-7]+\/[a-z2-7]+$/)
  expect(decodeInvite(text)).toEqual({ ok: true, value: invite })
})

it('rejects anything that is not exactly an invite', () => {
  const good = encodeInvite(invite)
  for (const text of [
    '',
    good.replace('invite/', 'invitation/'),
    `${good}/extra`,
    encodeInvite({ ...invite, id: 'abc' }),
    encodeInvite({ ...invite, token: 'aaaa' }),
    encodeInvite({ ...invite, handle: ' ' }),
  ])
    expect(decodeInvite(text).ok).toBe(false)
})
