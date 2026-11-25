import { describe, expect, it } from 'vitest'
import { fingerprint } from '../identity/identity.ts'
import { createMemoryNetwork, fakeCrypto, fakeSigner, flush } from '../testing/testing.ts'
import { INVITE_CODE_BYTES, inviteCode } from './invite.ts'
import { encodePairSecret, PAIR_SECRET_BYTES } from './pair-rooms.ts'
import { hostInvite, type NewFriend, type OpenStep, openInvite } from './pairing.ts'

const rook = fakeSigner('rook')
const mika = fakeSigner('mika')
const eve = fakeSigner('eve')
const code = inviteCode(new Uint8Array(INVITE_CODE_BYTES).fill(1))
const common = { crypto: fakeCrypto, now: () => 0 }
const never = new Promise<void>(() => undefined)
const SECRET = encodePairSecret(new Uint8Array(PAIR_SECRET_BYTES).fill(2))

function stopper() {
  let stop: () => void = () => undefined
  const until = new Promise<void>((resolve) => {
    stop = resolve
  })
  return { until, stop }
}

async function host(network: ReturnType<typeof createMemoryNetwork>, signer = rook) {
  const paired: NewFriend[] = []
  await hostInvite({
    ...common,
    signer,
    transport: network.transport(),
    handle: 'Rook',
    code,
    sleep: () => never,
    newSecret: () => SECRET,
    onPaired: (friend, secret) => {
      expect(secret).toBe(SECRET)
      paired.push(friend)
    },
  })
  return paired
}

describe('the invite handshake', () => {
  it('leaves someone the inviter has blocked unanswered', async () => {
    const network = createMemoryNetwork()
    await hostInvite({
      ...common,
      signer: rook,
      transport: network.transport(),
      handle: 'Rook',
      code,
      sleep: () => never,
      newSecret: () => SECRET,
      onPaired: () => undefined,
      refuse: (id) => id === mika.id,
    })
    const gaveUp = stopper()
    const opened = openInvite({
      ...common,
      signer: mika,
      transport: network.transport(),
      handle: 'Mika',
      invite: { code },
      until: gaveUp.until,
    })
    await flush()
    gaveUp.stop()
    expect(await opened).toEqual({ ok: false, error: 'stopped' })
  })

  it('says how far it has got: on the relays, then in touch with the inviter', async () => {
    const network = createMemoryNetwork()
    const steps: OpenStep[] = []
    const alone = stopper()
    const lonely = openInvite({
      ...common,
      signer: mika,
      transport: network.transport(),
      handle: 'Mika',
      invite: { code },
      until: alone.until,
      onStep: (step) => steps.push(step),
    })
    await flush()
    expect(steps).toEqual(['listening'])
    alone.stop()
    expect(await lonely).toEqual({ ok: false, error: 'stopped' })

    await host(network)
    steps.length = 0
    const opened = await openInvite({
      ...common,
      signer: mika,
      transport: network.transport(),
      handle: 'Mika',
      invite: { code },
      until: never,
      onStep: (step) => steps.push(step),
    })
    expect(opened.ok).toBe(true)
    expect(steps).toEqual(['listening', 'reached'])
  })

  it('shows who answered before anything is agreed, then pairs both ways', async () => {
    const network = createMemoryNetwork()
    const paired = await host(network)
    const opened = await openInvite({
      ...common,
      signer: mika,
      transport: network.transport(),
      handle: 'Mika',
      invite: { code, fingerprint: await fingerprint(fakeCrypto, rook.id) },
      until: never,
    })
    if (!opened.ok) throw new Error(opened.error)
    expect(opened.offer.friend).toEqual({ id: rook.id, handle: 'Rook' })
    expect(opened.offer.checked).toBe(true)
    expect(paired).toEqual([])

    // The accept carries the secret their room is named from.
    expect(await opened.offer.confirm(never)).toEqual({ secret: SECRET })
    await flush()
    expect(paired).toEqual([{ id: mika.id, handle: 'Mika' }])
  })

  it('pairs from a typed code too, unchecked, and only once', async () => {
    const network = createMemoryNetwork()
    const paired = await host(network)
    const opened = await openInvite({
      ...common,
      signer: mika,
      transport: network.transport(),
      handle: 'Mika',
      invite: { code },
      until: never,
    })
    if (!opened.ok) throw new Error(opened.error)
    expect(opened.offer.checked).toBe(false)
    await opened.offer.confirm(never)

    const late = stopper()
    const second = openInvite({
      ...common,
      signer: eve,
      transport: network.transport(),
      handle: 'Eve',
      invite: { code },
      until: late.until,
    })
    await flush()
    late.stop()
    expect(await second).toEqual({ ok: false, error: 'stopped' })
    expect(paired).toHaveLength(1)
  })

  it('adds nobody when the invitee cancels after seeing the offer', async () => {
    const network = createMemoryNetwork()
    const paired = await host(network)
    const opened = await openInvite({
      ...common,
      signer: mika,
      transport: network.transport(),
      handle: 'Mika',
      invite: { code },
      until: never,
    })
    if (!opened.ok) throw new Error(opened.error)
    await opened.offer.cancel()
    await flush()
    expect(paired).toEqual([])
  })

  it('names an impostor answering a link that carries someone else’s fingerprint', async () => {
    const network = createMemoryNetwork()
    await host(network, eve)
    const wait = stopper()
    const opened = openInvite({
      ...common,
      signer: mika,
      transport: network.transport(),
      handle: 'Mika',
      invite: { code, fingerprint: await fingerprint(fakeCrypto, rook.id) },
      until: wait.until,
    })
    await flush()
    wait.stop()
    expect(await opened).toEqual({ ok: false, error: 'impostor' })
  })
})
