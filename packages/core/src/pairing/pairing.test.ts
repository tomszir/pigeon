import { expect, it } from 'vitest'
import { createMemoryNetwork, fakeCrypto, fakeSigner, flush } from '../testing/testing.ts'
import { INVITE_TOKEN_BYTES, inviteToken } from './invite.ts'
import { acceptInvite, hostInvite, type NewFriend } from './pairing.ts'

const rook = fakeSigner('rook')
const mika = fakeSigner('mika')
const token = inviteToken(new Uint8Array(INVITE_TOKEN_BYTES).fill(1))
const common = { crypto: fakeCrypto, now: () => 0, sleep: () => Promise.resolve() }
const never = new Promise<void>(() => undefined)

it('pairs the inviter and whoever opens the link, once', async () => {
  const network = createMemoryNetwork()
  const paired: NewFriend[] = []
  await hostInvite({
    ...common,
    signer: rook,
    transport: network.transport(),
    handle: 'Rook',
    token,
    onPaired: (friend) => paired.push(friend),
  })
  const result = await acceptInvite({
    ...common,
    signer: mika,
    transport: network.transport(),
    handle: 'Mika',
    invite: { id: rook.id, token, handle: 'Rook' },
    until: never,
  })
  expect(result).toEqual({ ok: true, friend: { id: rook.id, handle: 'Rook' } })
  expect(paired).toEqual([{ id: mika.id, handle: 'Mika' }])

  let stop: () => void = () => undefined
  const late = acceptInvite({
    ...common,
    signer: fakeSigner('eve'),
    transport: network.transport(),
    handle: 'Eve',
    invite: { id: rook.id, token, handle: 'Rook' },
    until: new Promise<void>((resolve) => {
      stop = resolve
    }),
  })
  await flush()
  stop()
  expect(await late).toEqual({ ok: false, error: 'stopped' })
  expect(paired).toHaveLength(1)
})

it('ignores an accept from anyone but the id in the link', async () => {
  const network = createMemoryNetwork()
  // Eve hosts the token but the link names Rook.
  await hostInvite({
    ...common,
    signer: fakeSigner('eve'),
    transport: network.transport(),
    handle: 'Rook',
    token,
    onPaired: () => undefined,
  })
  let stop: () => void = () => undefined
  const result = acceptInvite({
    ...common,
    signer: mika,
    transport: network.transport(),
    handle: 'Mika',
    invite: { id: rook.id, token, handle: 'Rook' },
    until: new Promise<void>((resolve) => {
      stop = resolve
    }),
  })
  await flush()
  stop()
  expect(await result).toEqual({ ok: false, error: 'stopped' })
})
