// Linking a new device to an identity, in person. The existing device waits in
// `link/v2:<nameplate>` and in a room named from the link's secret, and shows the code in letters
// and as a QR code; the new device opens it and runs handshake.ts, which proves both hold the
// same secret over this very connection. The existing device's link-offer says whose it is,
// checked against the link's fingerprint (from a typed code, the person compares it by eye);
// then the new device answers link-request with its sealing key. Both show the new device's fingerprint, part
// of what the handshake covered. Only when you confirm on the existing device does it put the new
// one on its device log and send link-accept: what the new device needs (the bundle, which the
// app defines), sealed to that key. A code links once.
import { speakerIdentity } from '../devices/device-log.ts'
import type { Json } from '../encoding/canonical.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import { fingerprint, type PeerId } from '../identity/identity.ts'
import { type SealingKey, verifySealingKey } from '../mail/mail.ts'
import type { SealCrypto, Sealer } from '../mail/seal-crypto.ts'
import {
  type Body,
  MAX_SEALED_PART_LENGTH,
  MAX_SEALED_PARTS,
  openEnvelope,
  type Speaker,
  sealEnvelope,
} from '../messages/envelope.ts'
import type { Pake } from '../pake/pake.ts'
import type { ConnectionId, Room, RoomName, Transport } from '../transport/transport.ts'
import {
  type HostRuns,
  hostRuns,
  MAX_WRONG_TRIES,
  openerRuns,
  type Proven,
  type Via,
  type WrongTries,
} from './handshake.ts'
import { type Invite, type LiveCode, roomFor, roomsFor } from './invite.ts'
import { canSealTo, openAnswer, sealAnswer } from './sealed-answer.ts'

interface Common {
  readonly crypto: Crypto
  readonly seal: SealCrypto
  readonly pake: Pake
  readonly signer: Signer
  readonly transport: Transport
  readonly now: () => number
}

const listen = (
  crypto: Crypto,
  room: Room,
  handle: (from: ConnectionId, sender: PeerId, body: Body) => void,
) =>
  room.onMessage((from, bytes) => {
    void openEnvelope(crypto, room.name, bytes).then((opened) => {
      if (opened.ok) handle(from, opened.value.from, opened.value.body)
    })
  })

/** Someone asking to be linked, as the existing device shows them. */
export interface LinkRequest {
  /** The new device's key. */
  readonly device: PeerId
  /** Its fingerprint, which the new device shows too. */
  readonly fingerprint: string
  /** The new device is still there and the code still open, so `accept` can reach it. */
  alive(): boolean
  /**
   * Not this device: it's refused, can't ask again on that connection, and the code is open
   * for the device you meant.
   */
  refuse(): void
  /**
   * Sends the bundle once the new device is on the log; resolves once it's sent, with
   * `too-big` (nothing sent) when it doesn't fit a sealed letter, or `gone` when the new device
   * left or the code stopped meanwhile.
   */
  accept(bundle: Json): Promise<'sent' | 'too-big' | 'gone'>
}

export interface HostLinkOptions extends Common {
  readonly code: LiveCode
  readonly handle: string
  /** Who this device speaks for, when it isn't its identity's first device. */
  readonly speaker?: (() => Speaker | undefined) | undefined
  readonly sleep: (ms: number) => Promise<void>
  readonly onRequest: (request: LinkRequest) => void
  /** The device that asked went before it was handed anything; the code is open again. */
  readonly onRequestGone?: () => void
  /** A wrong confirmation came in: a mistyped code, a guess, or someone in the middle. */
  readonly onWrongTry?: (count: number) => void
  /** The code took MAX_WRONG_TRIES wrong tries and stopped. */
  readonly onTooManyTries?: () => void
  /** Wrong tries the code had before, when it's hosted again. */
  readonly wrongTries?: number
}

/** Waits for one new device to ask, by the typed code or its link. The returned function stops it. */
export async function hostLink(options: HostLinkOptions): Promise<() => Promise<void>> {
  const { signer, crypto } = options
  const names = await roomsFor(crypto, 'link', options.code)
  const self = options.speaker?.()?.identity ?? signer.id
  /**
   * The request showing (room and connection), one at a time, and the ones that came meanwhile
   * from other proven runs, shown in turn if it's refused or goes. Each connection asks once.
   */
  let showing: string | undefined
  const queued: { readonly key: string; readonly show: () => Promise<boolean> }[] = []
  const seen = new Set<string>()
  let done = false
  /** One pass through the queue at a time, so two requests are never checked or shown at once. */
  let running = false
  /** Checks queued requests in turn until one shows, while none is showing. */
  const next = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      while (showing === undefined && !done) {
        const up = queued.shift()
        if (up === undefined) return
        // A request whose device leaves while it's checked fails its own check, and one whose
        // check throws is dropped, so neither holds up the ones behind it.
        await up.show().catch(() => false)
      }
    } finally {
      running = false
    }
  }
  const served: { room: Room; runs: HostRuns; off: () => void }[] = []
  const tries: WrongTries = {
    count: options.wrongTries ?? 0,
    onWrongTry: (count) => {
      options.onWrongTry?.(count)
      if (count < MAX_WRONG_TRIES || done) return
      done = true
      for (const { runs } of served) runs.clear()
      options.onTooManyTries?.()
      // Give the last pake-wrong a moment to leave before the rooms go.
      void options.sleep(2000).then(stop)
    },
  }

  const serve = async (name: RoomName, via: Via, secret: string) => {
    const room = await options.transport.join(name)
    const send = async (to: ConnectionId, body: Body) =>
      room.send(to, await sealEnvelope(signer, room.name, options.now(), body))
    const runs = hostRuns({
      crypto,
      seal: options.seal,
      pake: options.pake,
      kind: 'link',
      room,
      device: signer.id,
      sleep: options.sleep,
      via,
      secret,
      tries,
      open: () => !done,
      reply: (to, pake) => send(to, { type: 'pake-reply', pake }),
      wrong: (to) => send(to, { type: 'pake-wrong' }),
    })
    const keyOf = (connection: ConnectionId) => `${room.name}\n${connection}`
    /** Shows a request: false, showing nothing, when it doesn't hold or has gone. */
    const request = async (run: Proven, sealing: SealingKey): Promise<boolean> => {
      const alive = () => !done && runs.proven(run.connection, run.device) === run
      const holds =
        sealing.device === run.device &&
        (await verifySealingKey(crypto, sealing)) &&
        (await canSealTo(options.seal, sealing))
      const print = await fingerprint(crypto, run.device)
      if (!holds || !alive() || showing !== undefined) return false
      showing = keyOf(run.connection)
      options.onRequest({
        device: run.device,
        fingerprint: print,
        alive,
        refuse() {
          if (!alive() || showing !== keyOf(run.connection)) return
          runs.refuse(run.connection)
          showing = undefined
          void next()
        },
        async accept(bundle) {
          if (done || runs.proven(run.connection, run.device) !== run) return 'gone'
          const sealed = await sealAnswer(
            options.seal,
            signer,
            { kind: 'link', sender: self, to: self, at: options.now(), run },
            sealing,
            bundle,
          )
          if (!sealed.ok) return 'too-big'
          // Gone, or the code stopped, while it was sealed: nothing to hand it to.
          if (done || runs.proven(run.connection, run.device) !== run) return 'gone'
          const parts = Math.ceil(sealed.value.length / MAX_SEALED_PART_LENGTH)
          if (parts > MAX_SEALED_PARTS) return 'too-big'
          done = true
          for (let part = 0; part < parts; part++)
            await send(run.connection, {
              type: 'link-accept',
              part,
              parts,
              sealed: sealed.value.slice(
                part * MAX_SEALED_PART_LENGTH,
                (part + 1) * MAX_SEALED_PART_LENGTH,
              ),
            })
          // Give the accept a moment to leave before the rooms go.
          void options.sleep(2000).then(stop)
          return 'sent'
        },
      })
      return true
    }
    const offMessage = listen(crypto, room, (from, sender, body) => {
      if (done || sender === signer.id) return
      switch (body.type) {
        case 'pake-start':
          void runs.start(from, sender, body)
          return
        case 'pake-prove':
          void runs.prove(from, sender, body).then(async (run) => {
            if (run === undefined || done) return
            await send(from, {
              type: 'link-offer',
              mac: run.mac,
              handle: options.handle,
              ...(options.speaker?.() ?? {}),
            })
          })
          return
        case 'link-request': {
          const run = runs.proven(from, sender)
          if (run === undefined || seen.has(keyOf(from))) return
          seen.add(keyOf(from))
          queued.push({ key: keyOf(from), show: () => request(run, body.sealing) })
          void next()
          return
        }
        default:
      }
    })
    const offLeave = room.onPeerLeave((peer) => {
      runs.drop(peer)
      const key = keyOf(peer)
      const at = queued.findIndex((up) => up.key === key)
      if (at >= 0) queued.splice(at, 1)
      if (showing === key && !done) {
        showing = undefined
        options.onRequestGone?.()
        void next()
      }
    })
    served.push({
      room,
      runs,
      off: () => {
        offMessage()
        offLeave()
      },
    })
  }

  let stopped = false
  const stop = async () => {
    done = true
    if (stopped) return
    stopped = true
    for (const { room, runs, off } of served) {
      off()
      runs.clear()
      await room.leave()
    }
  }
  try {
    await serve(names.code, 'code', options.code.password)
    await serve(names.link, 'link', options.code.secret)
  } catch (error) {
    await stop()
    throw error
  }
  return stop
}

/** The existing device, as the new one shows it while you confirm over there. */
export interface LinkOffer {
  readonly identity: PeerId
  readonly handle: string
  /** The identity's fingerprint, which its devices show as their Pigeon's own. */
  readonly identityFingerprint: string
  /**
   * The identity's fingerprint matched the link's. A typed code can't be checked this way: the
   * person linking compares `identityFingerprint` with the other device's before going on.
   */
  readonly checked: boolean
  /** This device's own fingerprint, which the other device shows too. */
  readonly fingerprint: string
  /**
   * Asks to be linked (until now nothing was sent but the handshake), and resolves with the
   * bundle once you confirm on the other device, or false if `until` gives up.
   */
  accepted(until: Promise<void>): Promise<Json | false>
  cancel(): Promise<void>
}

export interface OpenLinkOptions extends Common {
  readonly invite: Invite
  /** This device's sealing key, which the bundle is sealed to, and its private half. */
  readonly sealing: SealingKey
  readonly sealer: Sealer
  readonly until: Promise<void>
  /** Resolves after `ms`; the platform clock provides it. */
  readonly sleep: (ms: number) => Promise<void>
}

export type OpenLinkResult =
  | { readonly ok: true; readonly offer: LinkOffer }
  | { readonly ok: false; readonly error: 'stopped' | 'impostor' | 'wrong-code' }

/** Asks the device that showed the code to link this one. Nothing changes until it's confirmed. */
export async function openLink(options: OpenLinkOptions): Promise<OpenLinkResult> {
  const { invite, signer, crypto } = options
  const room = await options.transport.join(await roomFor(crypto, 'link', invite))
  const send = async (to: ConnectionId, body: Body) =>
    room.send(to, await sealEnvelope(signer, room.name, options.now(), body))
  const runs = openerRuns({
    crypto,
    seal: options.seal,
    pake: options.pake,
    kind: 'link',
    room,
    device: signer.id,
    sleep: options.sleep,
    invite,
    startMessage: (to, via, pake) => send(to, { type: 'pake-start', via, pake }),
    proveMessage: (to, mac) => send(to, { type: 'pake-prove', mac }),
  })

  let impostor = false
  let resolveOffer: ((result: OpenLinkResult) => void) | undefined
  const offered = new Promise<OpenLinkResult>((resolve) => {
    resolveOffer = resolve
  })
  let onAccept: ((from: ConnectionId, sender: PeerId, body: Body) => void) | undefined
  const ownPrint = await fingerprint(crypto, signer.id)

  const offer = async (from: ConnectionId, sender: PeerId, body: Body) => {
    if (body.type !== 'link-offer') return
    const run = await runs.offer(from, sender, body)
    if (run === undefined) return
    const identity = await speakerIdentity(crypto, sender, body)
    if (identity === undefined) return
    const print = await fingerprint(crypto, identity)
    if (invite.fingerprint !== undefined && print !== invite.fingerprint) {
      impostor = true
      return
    }
    // The first offer that holds is the one; any other run is left to time out.
    if (onAccept !== undefined) return
    // Pieces of the sealed bundle, in order, from this run alone.
    const pieces: string[] = []
    let expected: number | undefined
    const bundle = new Promise<Json>((resolve) => {
      onAccept = (at, who, reply) => {
        if (reply.type !== 'link-accept' || at !== from || runs.proven(at, who) === undefined)
          return
        if (reply.part !== pieces.length || (expected !== undefined && reply.parts !== expected))
          return
        expected = reply.parts
        pieces.push(reply.sealed)
        if (pieces.length < reply.parts) return
        void openAnswer(crypto, options.seal, options.sealer, pieces.join(''), {
          kind: 'link',
          sender: identity,
          to: identity,
          at: options.now(),
          run,
        }).then((value) => {
          if (value !== undefined && typeof value === 'object' && value !== null) resolve(value)
        })
      }
    })
    resolveOffer?.({
      ok: true,
      offer: {
        identity,
        handle: body.handle,
        identityFingerprint: print,
        checked: invite.via === 'link',
        fingerprint: ownPrint,
        async accepted(until) {
          void send(from, { type: 'link-request', sealing: options.sealing })
          const sent = await Promise.race([bundle, until.then(() => false as const)])
          await leave()
          return sent
        },
        cancel: () => leave(),
      },
    })
  }

  const off = listen(crypto, room, (from, sender, body) => {
    if (sender === signer.id) return
    switch (body.type) {
      case 'pake-reply':
        void runs.reply(from, sender, body)
        return
      case 'pake-wrong':
        if (runs.wrong(from, sender) && runs.pending() === 0)
          resolveOffer?.({ ok: false, error: 'wrong-code' })
        return
      case 'link-offer':
        void offer(from, sender, body)
        return
      default:
        onAccept?.(from, sender, body)
    }
  })
  const offJoin = room.onPeerJoin((peer) => void runs.begin(peer))
  const offLeave = room.onPeerLeave((peer) => runs.drop(peer))
  for (const peer of room.peers()) void runs.begin(peer)

  let left = false
  const leave = async () => {
    if (left) return
    left = true
    off()
    offJoin()
    offLeave()
    runs.abandon()
    await room.leave()
  }
  void options.until.then(() =>
    resolveOffer?.({ ok: false, error: impostor ? 'impostor' : 'stopped' }),
  )
  const result = await offered
  if (!result.ok) await leave()
  else offJoin()
  return result
}
