import { describe, expect, it } from 'vitest'
import { base64Encode } from '../encoding/bytes.ts'
import type { Signer } from '../identity/crypto.ts'
import { fingerprint } from '../identity/identity.ts'
import { bindSealingKey } from '../mail/mail.ts'
import { openEnvelope, sealEnvelope } from '../messages/envelope.ts'
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
import { encodePairSecret, PAIR_SECRET_BYTES } from './pair-rooms.ts'
import {
  type CodeRequest,
  hostInvite,
  type NewFriend,
  type OpenStep,
  openInvite,
} from './pairing.ts'

const rook = fakeSigner('rook')
const mika = fakeSigner('mika')
const eve = fakeSigner('eve')
const code = newCode(Uint8Array.from({ length: CODE_RANDOM_BYTES }, (_, i) => (i * 41 + 3) % 256))
const seal = fakeSealCrypto()
const common = { crypto: fakeCrypto, seal, pake: fakePake(), now: () => 0 }
const never = new Promise<void>(() => undefined)
const SECRET = encodePairSecret(new Uint8Array(PAIR_SECRET_BYTES).fill(2))
const typed: Invite = { nameplate: code.nameplate, via: 'code', secret: code.password }
const rooms = await roomsFor(fakeCrypto, 'invite', code)
const linked = async (signer: Signer = rook): Promise<Invite> => ({
  via: 'link',
  secret: code.secret,
  fingerprint: await fingerprint(fakeCrypto, signer.id),
})

function stopper() {
  let stop: () => void = () => undefined
  const until = new Promise<void>((resolve) => {
    stop = resolve
  })
  return { until, stop }
}

async function host(
  transport: Transport,
  options: {
    signer?: Signer
    refuse?: (id: string) => boolean
    sleep?: (ms: number) => Promise<void>
    wrongTries?: number
  } = {},
) {
  const paired: { friend: NewFriend; secret: string }[] = []
  const requests: CodeRequest[] = []
  const wrong: number[] = []
  let stopped = false
  await hostInvite({
    ...common,
    signer: options.signer ?? rook,
    transport,
    handle: 'Rook',
    code,
    sleep: options.sleep ?? (() => never),
    newSecret: () => SECRET,
    onRequest: (request) => requests.push(request),
    onPaired: (friend, secret) => paired.push({ friend, secret }),
    onWrongTry: (count) => wrong.push(count),
    onTooManyTries: () => {
      stopped = true
    },
    ...(options.refuse === undefined ? {} : { refuse: options.refuse }),
    ...(options.wrongTries === undefined ? {} : { wrongTries: options.wrongTries }),
  })
  return { paired, requests, wrong, stopped: () => stopped }
}

async function open(
  transport: Transport,
  invite: Invite,
  until: Promise<void> = never,
  signer: Signer = mika,
  onStep?: (step: OpenStep) => void,
) {
  const sealer = seal.sealer(signer.id)
  return openInvite({
    ...common,
    signer,
    transport,
    handle: signer === mika ? 'Mika' : 'Eve',
    invite,
    sealer,
    sealing: await bindSealingKey(signer, sealer),
    until,
    sleep: () => never,
    ...(onStep === undefined ? {} : { onStep }),
  })
}

describe('the invite handshake', () => {
  it('shows who answered, waits for the inviter to add them, then pairs both ways', async () => {
    const network = createMemoryNetwork()
    const rookSide = await host(network.transport())
    const opened = await open(network.transport(), await linked())
    if (!opened.ok) throw new Error(opened.error)
    expect(opened.offer.friend).toEqual({ id: rook.id, handle: 'Rook' })
    expect(opened.offer.checked).toBe(true)
    expect(rookSide.requests).toEqual([])

    const confirmed = opened.offer.confirm(never)
    await flush()
    // Mika asked; Rook sees her, with her fingerprint, and nobody is added yet.
    const request = rookSide.requests[0]
    if (request === undefined) throw new Error('no request')
    expect(request.friend).toEqual({ id: mika.id, handle: 'Mika' })
    expect(request.fingerprint).toBe(await fingerprint(fakeCrypto, mika.id))
    expect(rookSide.paired).toEqual([])

    expect(await request.approve()).toBe(true)
    // The accept carries the secret their room is named from, sealed to Mika's device.
    expect(await confirmed).toEqual({ secret: SECRET })
    expect(rookSide.paired).toEqual([{ friend: { id: mika.id, handle: 'Mika' }, secret: SECRET }])
  })

  it('pairs from a typed code too, unchecked, and only once', async () => {
    const network = createMemoryNetwork()
    const rookSide = await host(network.transport())
    const opened = await open(network.transport(), typed)
    if (!opened.ok) throw new Error(opened.error)
    expect(opened.offer.checked).toBe(false)
    const confirmed = opened.offer.confirm(never)
    await flush()
    await rookSide.requests[0]?.approve()
    expect(await confirmed).toEqual({ secret: SECRET })

    const late = stopper()
    const second = open(network.transport(), typed, late.until, eve)
    await flush()
    late.stop()
    expect(await second).toEqual({ ok: false, error: 'stopped' })
    expect(rookSide.paired).toHaveLength(1)
  })

  it('adds nobody the inviter declines, and keeps the code for the right person', async () => {
    const network = createMemoryNetwork()
    const rookSide = await host(network.transport())
    // Eve saw the code over Mika's shoulder and got there first.
    const eveOpened = await open(network.transport(), typed, never, eve)
    if (!eveOpened.ok) throw new Error(eveOpened.error)
    const eveConfirmed = eveOpened.offer.confirm(never)
    await flush()
    expect(rookSide.requests.map((request) => request.friend.handle)).toEqual(['Eve'])
    await rookSide.requests[0]?.decline()
    expect(await eveConfirmed).toBe('declined')
    expect(rookSide.paired).toEqual([])

    const opened = await open(network.transport(), typed)
    if (!opened.ok) throw new Error(opened.error)
    const confirmed = opened.offer.confirm(never)
    await flush()
    await rookSide.requests[1]?.approve()
    expect(await confirmed).toEqual({ secret: SECRET })
    expect(rookSide.paired.map(({ friend }) => friend.handle)).toEqual(['Mika'])
  })

  it('refuses someone who knows the nameplate but not the code, and stops after five tries', async () => {
    const network = createMemoryNetwork()
    const rookSide = await host(network.transport())
    // Eve read the room's name off the relays and guesses the rest.
    for (let guess = 0; guess < MAX_WRONG_TRIES; guess++) {
      const wrong = await open(
        network.transport(),
        { ...typed, secret: `aaaaa${'abcde'[guess]}` },
        never,
        eve,
      )
      expect(wrong).toEqual({ ok: false, error: 'wrong-code' })
    }
    expect(rookSide.wrong).toEqual([1, 2, 3, 4, 5])
    expect(rookSide.stopped()).toBe(true)
    expect(rookSide.requests).toEqual([])

    // Even the right code finds nobody now.
    const late = stopper()
    const right = open(network.transport(), typed, late.until)
    await flush()
    late.stop()
    expect(await right).toEqual({ ok: false, error: 'stopped' })
  })

  it('counts a run left unproven as a wrong try, so idle connections can’t lock a code out unseen', async () => {
    const network = createMemoryNetwork()
    // Timers that fire when the test says so.
    const timers: (() => void)[] = []
    const sleep = () => new Promise<void>((resolve) => void timers.push(resolve))
    const rookSide = await host(network.transport(), { sleep })
    const room = rooms.code
    // Eve knows only the public nameplate: each of her connections starts, and never proves.
    for (let i = 0; i < MAX_WRONG_TRIES; i++) {
      const sybil = await network.transport().join(room)
      await flush()
      const pake = base64Encode(new Uint8Array([0x41, ...new Uint8Array(32).fill(i)]))
      for (const peer of sybil.peers())
        sybil.send(
          peer,
          await sealEnvelope(eve, room, 0, { type: 'pake-start', via: 'code', pake }),
        )
    }
    await flush()
    expect(rookSide.wrong).toEqual([])
    for (const fire of timers.splice(0)) fire()
    await flush()
    // Each shows as a wrong try, and the fifth stops the code.
    expect(rookSide.wrong).toEqual([1, 2, 3, 4, 5])
    expect(rookSide.stopped()).toBe(true)
  })

  it('counts no more than five wrong tries when guesses come all at once', async () => {
    const network = createMemoryNetwork()
    // As WebCrypto's, signing takes real time, so the answers to a burst go out one by one.
    const slowRook: Signer = {
      id: rook.id,
      sign: async (data) => {
        await flush(20)
        return rook.sign(data)
      },
    }
    const rookSide = await host(network.transport(), { signer: slowRook })
    const results = []
    for (let i = 0; i < 16; i++) {
      // Fifteen wrong guesses, and the right one last.
      const secret = i === 15 ? code.password : `aaaaa${'abcdefghijklmnop'[i]}`
      const guesser = fakeSigner(`eve-${i}`)
      results.push(open(network.transport(), { ...typed, secret }, never, guesser))
    }
    let last: unknown = 'no answer'
    void results[15]?.then((result) => {
      last = result
    })
    await flush(5000)
    expect(rookSide.wrong).toEqual([1, 2, 3, 4, 5])
    expect(rookSide.stopped()).toBe(true)
    // The right code, once the code is used up, gets nothing to go on.
    expect(last).toBe('no answer')
  })

  it('counts nothing once it has stopped', async () => {
    const network = createMemoryNetwork()
    const timers: (() => void)[] = []
    const sleep = () => new Promise<void>((resolve) => void timers.push(resolve))
    const wrong: number[] = []
    const stop = await hostInvite({
      ...common,
      signer: rook,
      transport: network.transport(),
      handle: 'Rook',
      code,
      sleep,
      newSecret: () => SECRET,
      onRequest: () => undefined,
      onPaired: () => undefined,
      onWrongTry: (count) => wrong.push(count),
      wrongTries: MAX_WRONG_TRIES - 1,
    })
    const sybil = await network.transport().join(rooms.code)
    await flush()
    const pake = base64Encode(new Uint8Array([0x41, ...new Uint8Array(32)]))
    for (const peer of sybil.peers())
      sybil.send(
        peer,
        await sealEnvelope(eve, rooms.code, 0, { type: 'pake-start', via: 'code', pake }),
      )
    await flush()
    await stop()
    for (const fire of timers.splice(0)) fire()
    await flush()
    expect(wrong).toEqual([])
  })

  it('counts a connection that leaves before proving, so coming back can’t dodge the timeout', async () => {
    const network = createMemoryNetwork()
    const rookSide = await host(network.transport())
    const transport = network.transport()
    const sybil = await transport.join(rooms.code)
    await flush()
    const started = await fakePake().start(
      'a',
      new Uint8Array(1),
      new Uint8Array(1),
      new Uint8Array(1),
    )
    const pake = base64Encode(started.message)
    for (const peer of sybil.peers())
      sybil.send(
        peer,
        await sealEnvelope(eve, rooms.code, 0, { type: 'pake-start', via: 'code', pake }),
      )
    await flush()
    await sybil.leave()
    await flush()
    expect(rookSide.wrong).toEqual([1])
  })

  it('carries the wrong tries over when a code is hosted again', async () => {
    const network = createMemoryNetwork()
    const rookSide = await host(network.transport(), { wrongTries: MAX_WRONG_TRIES - 1 })
    expect(await open(network.transport(), { ...typed, secret: 'qqqqqq' }, never, eve)).toEqual({
      ok: false,
      error: 'wrong-code',
    })
    expect(rookSide.wrong).toEqual([MAX_WRONG_TRIES])
    expect(rookSide.stopped()).toBe(true)
  })

  it('refuses a link secret typed as a code, and a code sent as a link', async () => {
    const network = createMemoryNetwork()
    const rookSide = await host(network.transport())
    expect(await open(network.transport(), { ...typed, secret: code.secret }, never, eve)).toEqual({
      ok: false,
      error: 'wrong-code',
    })
    // A link with the wrong secret names another room, where nobody waits.
    const wait = stopper()
    const elsewhere = open(
      network.transport(),
      { ...(await linked()), secret: code.password.padEnd(26, 'a') },
      wait.until,
      eve,
    )
    await flush()
    wait.stop()
    expect(await elsewhere).toEqual({ ok: false, error: 'stopped' })
    expect(rookSide.wrong).toEqual([1])
  })

  it('refuses a relay in the middle, which shows each side its own DTLS fingerprint', async () => {
    // Mika and Rook can't reach each other except through Eve, who swapped the fingerprints in
    // both offers and passes every message across unchanged.
    const mikaSide = createMemoryNetwork()
    const rookSideNet = createMemoryNetwork()
    const rookSide = await host(rookSideNet.transport())
    await relayRoom(mikaSide.transport(), rookSideNet.transport(), rooms.link)
    const opened = await open(mikaSide.transport(), await linked())
    expect(opened).toEqual({ ok: false, error: 'wrong-code' })
    expect(rookSide.wrong).toEqual([1])
    expect(rookSide.requests).toEqual([])
  })

  it('refuses a relay that keeps the fingerprints but signs as itself', async () => {
    // As if Eve could present each side the other's certificate: the device keys in the
    // transcript still don't match.
    const mikaSide = createMemoryNetwork()
    const rookSideNet = createMemoryNetwork()
    const rookTransport = rookSideNet.transport('a'.repeat(64))
    const mikaTransport = mikaSide.transport('b'.repeat(64))
    const rookSide = await host(rookTransport)
    const room = rooms.link
    await relayRoom(
      mikaSide.transport('a'.repeat(64)),
      rookSideNet.transport('b'.repeat(64)),
      room,
      async (bytes) => {
        const opened = await openEnvelope(fakeCrypto, room, bytes)
        if (!opened.ok || opened.value.from !== mika.id) return bytes
        return sealEnvelope(eve, room, opened.value.at, opened.value.body)
      },
    )
    const wait = stopper()
    const opened = open(mikaTransport, await linked(), wait.until)
    await flush()
    wait.stop()
    expect((await opened).ok).toBe(false)
    expect(rookSide.wrong).toEqual([1])
    expect(rookSide.requests).toEqual([])
  })

  it('leaves someone the inviter has blocked unanswered', async () => {
    const network = createMemoryNetwork()
    const rookSide = await host(network.transport(), { refuse: (id) => id === mika.id })
    const opened = await open(network.transport(), typed)
    if (!opened.ok) throw new Error(opened.error)
    const wait = stopper()
    const confirmed = opened.offer.confirm(wait.until)
    await flush()
    wait.stop()
    expect(await confirmed).toBe(false)
    expect(rookSide.requests).toEqual([])
  })

  it('says how far it has got: on the relays, then in touch with the inviter', async () => {
    const network = createMemoryNetwork()
    const steps: OpenStep[] = []
    const alone = stopper()
    const lonely = open(network.transport(), typed, alone.until, mika, (step) => steps.push(step))
    await flush()
    expect(steps).toEqual(['listening'])
    alone.stop()
    expect(await lonely).toEqual({ ok: false, error: 'stopped' })

    await host(network.transport())
    steps.length = 0
    const opened = await open(network.transport(), typed, never, mika, (step) => steps.push(step))
    expect(opened.ok).toBe(true)
    expect(steps).toEqual(['listening', 'reached'])
  })

  it('adds nobody when the invitee cancels after seeing the offer', async () => {
    const network = createMemoryNetwork()
    const rookSide = await host(network.transport())
    const opened = await open(network.transport(), typed)
    if (!opened.ok) throw new Error(opened.error)
    await opened.offer.cancel()
    await flush()
    expect(rookSide.requests).toEqual([])
  })

  it('names an impostor answering a link that carries someone else’s fingerprint', async () => {
    const network = createMemoryNetwork()
    // Eve holds the same link and hosts it as herself.
    await host(network.transport(), { signer: eve })
    const wait = stopper()
    const opened = open(network.transport(), await linked(rook), wait.until)
    await flush()
    wait.stop()
    expect(await opened).toEqual({ ok: false, error: 'impostor' })
  })
})
