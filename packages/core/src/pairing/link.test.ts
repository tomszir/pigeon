import { describe, expect, it } from 'vitest'
import { appendDeviceEntry, deviceState, emptyDeviceLog } from '../devices/device-log.ts'
import type { Signer } from '../identity/crypto.ts'
import { fingerprint } from '../identity/identity.ts'
import { bindSealingKey } from '../mail/mail.ts'
import { openEnvelope, type Speaker, sealEnvelope } from '../messages/envelope.ts'
import { fakePake } from '../testing/fake-pake.ts'
import {
  createMemoryNetwork,
  fakeCrypto,
  fakeSealCrypto,
  fakeSigner,
  flush,
  relayRoom,
} from '../testing/testing.ts'
import type { Transport } from '../transport/transport.ts'
import { MAX_WRONG_TRIES } from './handshake.ts'
import { CODE_RANDOM_BYTES, type Invite, newCode, roomsFor } from './invite.ts'
import { hostLink, type LinkRequest, openLink } from './link.ts'

const laptop = fakeSigner('toms-laptop')
const phone = fakeSigner('toms-phone')
const thief = fakeSigner('thief')
const code = newCode(Uint8Array.from({ length: CODE_RANDOM_BYTES }, (_, i) => (i * 29 + 5) % 256))
const never = new Promise<void>(() => undefined)
const seal = fakeSealCrypto()
const common = { crypto: fakeCrypto, seal, pake: fakePake(), now: () => 0 }
const typed: Invite = { nameplate: code.nameplate, via: 'code', secret: code.password }
const rooms = await roomsFor(fakeCrypto, 'link', code)
const linked = async (identity: Signer = laptop): Promise<Invite> => ({
  via: 'link',
  secret: code.secret,
  fingerprint: await fingerprint(fakeCrypto, identity.id),
})

function stopper() {
  let stop: () => void = () => undefined
  const until = new Promise<void>((resolve) => {
    stop = resolve
  })
  return { until, stop }
}

async function host(transport: Transport, signer = laptop, speaker?: () => Speaker) {
  const requests: LinkRequest[] = []
  const wrong: number[] = []
  await hostLink({
    ...common,
    signer,
    transport,
    code,
    handle: 'Toms',
    sleep: () => never,
    onRequest: (request) => requests.push(request),
    onWrongTry: (count) => wrong.push(count),
    ...(speaker === undefined ? {} : { speaker }),
  })
  return { requests, wrong }
}

async function open(transport: Transport, invite: Invite, until = never, signer = phone) {
  const sealer = seal.sealer(signer.id)
  return openLink({
    ...common,
    signer,
    transport,
    invite,
    sealer,
    sealing: await bindSealingKey(signer, sealer),
    until,
    sleep: () => never,
  })
}

describe('linking a device', () => {
  it('shows the new device’s fingerprint on both, and hands over the bundle once confirmed', async () => {
    const network = createMemoryNetwork()
    const laptopSide = await host(network.transport())
    const opened = await open(network.transport(), await linked())
    if (!opened.ok) throw new Error(opened.error)
    expect(opened.offer).toMatchObject({
      identity: laptop.id,
      handle: 'Toms',
      checked: true,
      identityFingerprint: await fingerprint(fakeCrypto, laptop.id),
    })
    // Nothing is asked until the phone goes on.
    await flush()
    expect(laptopSide.requests).toEqual([])
    const waiting = opened.offer.accepted(never)
    await flush()
    const request = laptopSide.requests[0]
    if (request === undefined) throw new Error('no request')
    expect(request.device).toBe(phone.id)
    expect(request.fingerprint).toBe(await fingerprint(fakeCrypto, phone.id))
    expect(opened.offer.fingerprint).toBe(request.fingerprint)

    expect(await request.accept({ hello: 'phone' })).toBe('sent')
    expect(await waiting).toEqual({ hello: 'phone' })
  })

  it('hands over a bundle too big for one envelope in pieces, and refuses one too big for any', async () => {
    const network = createMemoryNetwork()
    const laptopSide = await host(network.transport())
    const opened = await open(network.transport(), typed)
    if (!opened.ok) throw new Error(opened.error)
    // From a typed code, the phone shows whose it is for you to compare.
    expect(opened.offer.checked).toBe(false)
    const waiting = opened.offer.accepted(never)
    await flush()
    const request = laptopSide.requests[0]
    if (request === undefined) throw new Error('no request')
    expect(await request.accept({ friends: 'x'.repeat(200_000) })).toBe('too-big')
    const big = { friends: 'x'.repeat(40_000) }
    expect(await request.accept(big)).toBe('sent')
    expect(await waiting).toEqual(big)
  })

  it('refuses an answer from someone other than the link’s identity', async () => {
    const network = createMemoryNetwork()
    // The thief has the link too, and hosts it as themselves.
    await host(network.transport(), thief)
    const { until, stop } = stopper()
    const opened = open(network.transport(), await linked(), until)
    await flush()
    stop()
    expect(await opened).toEqual({ ok: false, error: 'impostor' })
  })

  it('refuses a wrong code, and stops the code after five', async () => {
    const network = createMemoryNetwork()
    const laptopSide = await host(network.transport())
    for (let guess = 0; guess < MAX_WRONG_TRIES; guess++)
      expect(
        await open(
          network.transport(),
          { ...typed, secret: `zzzzz${'abcde'[guess]}` },
          never,
          thief,
        ),
      ).toEqual({ ok: false, error: 'wrong-code' })
    expect(laptopSide.wrong).toEqual([1, 2, 3, 4, 5])
    const { until, stop } = stopper()
    const right = open(network.transport(), typed, until)
    await flush()
    stop()
    expect(await right).toEqual({ ok: false, error: 'stopped' })
    expect(laptopSide.requests).toEqual([])
  })

  it('refuses a thief who relays the link with a device key ground to match', async () => {
    // The thief saw the code, sits between the phone and the laptop, passes the laptop's messages
    // through unchanged and signs the phone's as their own key. Even with each side shown the
    // other's DTLS fingerprint, the transcript names the phone on one side and the thief on the
    // other, so neither confirmation checks and the laptop is never asked.
    const phoneNet = createMemoryNetwork()
    const laptopNet = createMemoryNetwork()
    const laptopSide = await host(laptopNet.transport('a'.repeat(64)))
    const room = rooms.code
    await relayRoom(
      phoneNet.transport('a'.repeat(64)),
      laptopNet.transport('b'.repeat(64)),
      room,
      async (bytes) => {
        const opened = await openEnvelope(fakeCrypto, room, bytes)
        if (!opened.ok || opened.value.from !== phone.id) return bytes
        return sealEnvelope(thief, room, opened.value.at, opened.value.body)
      },
    )
    const { until, stop } = stopper()
    const opened = open(phoneNet.transport('b'.repeat(64)), typed, until)
    await flush()
    stop()
    expect((await opened).ok).toBe(false)
    expect(laptopSide.wrong).toEqual([1])
    expect(laptopSide.requests).toEqual([])
  })

  it('refuses a relay in the middle that passes everything on unchanged', async () => {
    const phoneNet = createMemoryNetwork()
    const laptopNet = createMemoryNetwork()
    const laptopSide = await host(laptopNet.transport())
    await relayRoom(phoneNet.transport(), laptopNet.transport(), rooms.link)
    expect(await open(phoneNet.transport(), await linked())).toEqual({
      ok: false,
      error: 'wrong-code',
    })
    expect(laptopSide.requests).toEqual([])
  })

  it('shows nothing for a new device whose sealing key can’t be sealed to', async () => {
    const network = createMemoryNetwork()
    const laptopSide = await host(network.transport())
    const sealer = seal.sealer(phone.id)
    const opened = await openLink({
      ...common,
      signer: phone,
      transport: network.transport(),
      invite: typed,
      sealer,
      // Signed and the right shape, but no point on the curve.
      sealing: await bindSealingKey(phone, { ...sealer, publicKey: new Uint8Array(65).fill(4) }),
      until: never,
      sleep: () => never,
    })
    if (!opened.ok) throw new Error(opened.error)
    void opened.offer.accepted(never)
    await flush()
    expect(laptopSide.requests).toEqual([])
  })

  it('hands nothing to a device that left while its bundle was sealed', async () => {
    let gate: Promise<void> | undefined
    let release: () => void = () => undefined
    const gated = {
      ...seal,
      seal: async (key: Uint8Array, data: Uint8Array) => {
        if (gate !== undefined) await gate
        return seal.seal(key, data)
      },
    }
    const network = createMemoryNetwork()
    const requests: LinkRequest[] = []
    let gone = 0
    await hostLink({
      ...common,
      seal: gated,
      signer: laptop,
      transport: network.transport(),
      code,
      handle: 'Toms',
      sleep: () => never,
      onRequest: (request) => requests.push(request),
      onRequestGone: () => {
        gone += 1
      },
    })
    const phoneTransport = network.transport()
    const opened = await open(phoneTransport, await linked())
    if (!opened.ok) throw new Error(opened.error)
    void opened.offer.accepted(never)
    await flush()
    const request = requests[0]
    if (request === undefined) throw new Error('no request')
    expect(request.alive()).toBe(true)
    gate = new Promise((resolve) => {
      release = resolve
    })
    const accepting = request.accept({ hello: 'phone' })
    await flush()
    phoneTransport.disconnect()
    await flush()
    expect(gone).toBe(1)
    release()
    expect(await accepting).toBe('gone')
  })

  it('refuses a device that isn’t yours, and waits for the one that is', async () => {
    const network = createMemoryNetwork()
    const laptopSide = await host(network.transport())
    // The thief saw the code and asks first.
    const stolen = await open(network.transport(), typed, never, thief)
    if (!stolen.ok) throw new Error(stolen.error)
    void stolen.offer.accepted(never)
    await flush()
    const first = laptopSide.requests[0]
    expect(first?.device).toBe(thief.id)
    // The phone, the right one, asks while the thief's request still shows: it waits its turn.
    const opened = await open(network.transport(), typed)
    if (!opened.ok) throw new Error(opened.error)
    const waiting = opened.offer.accepted(never)
    await flush()
    expect(laptopSide.requests).toHaveLength(1)
    first?.refuse()
    expect(first?.alive()).toBe(false)
    await flush()
    const mine = laptopSide.requests[1]
    expect(mine?.device).toBe(phone.id)
    expect(await mine?.accept({ hello: 'phone' })).toBe('sent')
    expect(await waiting).toEqual({ hello: 'phone' })
  })

  it('shows one request at a time, even when the one being checked leaves', async () => {
    // Each check of a sealing key waits until the test lets it go, to set the order.
    let gating = false
    const gates: (() => void)[] = []
    const gated = {
      ...seal,
      ephemeralShare: async (peer: Uint8Array) => {
        if (gating) await new Promise<void>((resolve) => void gates.push(resolve))
        return seal.ephemeralShare(peer)
      },
    }
    const network = createMemoryNetwork()
    const requests: LinkRequest[] = []
    let gone = 0
    await hostLink({
      ...common,
      seal: gated,
      signer: laptop,
      transport: network.transport(),
      code,
      handle: 'Toms',
      sleep: () => never,
      onRequest: (request) => requests.push(request),
      onRequestGone: () => {
        gone += 1
      },
    })
    gating = true
    // The thief asks first, and leaves while its request is still being checked.
    const thiefTransport = network.transport()
    const stolen = await open(thiefTransport, typed, never, thief)
    if (!stolen.ok) throw new Error(stolen.error)
    void stolen.offer.accepted(never)
    await flush()
    const opened = await open(network.transport(), typed)
    if (!opened.ok) throw new Error(opened.error)
    void opened.offer.accepted(never)
    await flush()
    thiefTransport.disconnect()
    await flush()
    // Nothing was shown, so nothing is gone; the phone waits for the thief's check to end.
    expect(gone).toBe(0)
    expect(gates).toHaveLength(1)
    gates[0]?.()
    await flush()
    gates[1]?.()
    await flush()
    expect(requests.map((request) => request.device)).toEqual([phone.id])
    // Another asks while the phone's request shows: it waits, and the phone's stays the one.
    gating = false
    const other = await open(network.transport(), typed, never, fakeSigner('thief-2'))
    if (!other.ok) throw new Error(other.error)
    void other.offer.accepted(never)
    await flush()
    expect(requests.filter((request) => request.alive()).map((r) => r.device)).toEqual([phone.id])
    requests[0]?.refuse()
    expect(requests[0]?.alive()).toBe(false)
    await flush()
    expect(requests.map((request) => request.device)).toEqual([phone.id, fakeSigner('thief-2').id])
  })

  it('answers for the identity from a second device', async () => {
    const network = createMemoryNetwork()
    const added = await appendDeviceEntry(
      fakeCrypto,
      emptyDeviceLog(laptop.id),
      laptop,
      { kind: 'add', device: phone.id, name: 'Phone' },
      1,
    )
    if (!added.ok) throw new Error(added.error)
    expect(deviceState(added.log).active.has(phone.id)).toBe(true)
    const tablet = fakeSigner('toms-tablet')
    await host(network.transport(), phone, () => ({ identity: laptop.id, devices: added.log }))
    const opened = await open(network.transport(), await linked(), never, tablet)
    if (!opened.ok) throw new Error(opened.error)
    expect(opened.offer.identity).toBe(laptop.id)
  })
})
