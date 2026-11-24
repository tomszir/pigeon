import { encodeInvite, fakeSigner } from '@pigeon/core'
import { expect, it } from 'vitest'
import { readInvite } from './add-friend.tsx'

const invite = { id: fakeSigner('rook').id, token: 'a'.repeat(26), handle: 'Rook' }

it('reads an invite from a whole link, a bare fragment, or with stray spaces', () => {
  const fragment = encodeInvite(invite)
  for (const text of [`https://pigeon.tomszir.com/#${fragment}`, fragment, `  ${fragment}\n`])
    expect(readInvite(text)).toEqual({ ok: true, value: invite })
  expect(readInvite('https://pigeon.tomszir.com/').ok).toBe(false)
})
