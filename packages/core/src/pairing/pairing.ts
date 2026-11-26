// The live invite handshake. The inviter waits in two rooms, `invite/v2:<nameplate>` for the
// typed code and one named from the link's secret; whoever opens the code or link runs
// handshake.ts with it, which proves both hold the same secret over this very
// connection. Then the inviter's pair-offer says who it is, checked against the link's
// fingerprint when there is one. Only when the invitee agrees does its pair-request go back,
// with its name and its device's sealing key, and the inviter sees it, with fingerprint and
// bird, and chooses. Add sends pair-accept, the pair secret sealed to that key; Decline sends
// pair-decline. A code pairs once.
import { type DeviceLog, speakerIdentity } from '../devices/device-log.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import { fingerprint, type PeerId } from '../identity/identity.ts'
import { type SealingKey, verifySealingKey } from '../mail/mail.ts'
import type { SealCrypto, Sealer } from '../mail/seal-crypto.ts'
import { type Body, openEnvelope, type Speaker, sealEnvelope } from '../messages/envelope.ts'
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
import { isPairSecret } from './pair-rooms.ts'
import { canSealTo, openAnswer, sealAnswer } from './sealed-answer.ts'

export interface NewFriend {
  /** Their identity: what they're known by, whichever device answered. */
  readonly id: PeerId
  readonly handle: string
  /** Their device log, when the device that answered isn't their first. */
  readonly devices?: DeviceLog | undefined
}

interface Common {
  readonly crypto: Crypto
  readonly seal: SealCrypto
  readonly pake: Pake
  readonly signer: Signer
  readonly transport: Transport
  readonly handle: string
  readonly now: () => number
  /** The identity this device speaks for, and its device log, when it isn't the first device. */
  readonly speaker?: (() => Speaker | undefined) | undefined
  /**
   * The device log you already keep for someone, so a friend back from a recovery is checked
   * against it, and a device their recovery took off their list is refused.
   */
  readonly knownLog?: ((id: PeerId) => Promise<DeviceLog | undefined>) | undefined
}

const speakerFields = (common: Common): Speaker => common.speaker?.() ?? {}

/** Who a pair-request or pair-offer is from, or undefined when its claim doesn't hold. */
async function friendFrom(
  common: Common,
  device: PeerId,
  body: { readonly handle: string } & Speaker,
): Promise<NewFriend | undefined> {
  const known = await common.knownLog?.(body.identity ?? device)
  const id = await speakerIdentity(common.crypto, device, body, known)
  if (id === undefined) return undefined
  return {
    id,
    handle: body.handle,
    ...(body.devices === undefined ? {} : { devices: body.devices }),
  }
}

function listen(
  crypto: Crypto,
  room: Room,
  handle: (from: ConnectionId, sender: PeerId, body: Body) => void,
) {
  return room.onMessage((from, bytes) => {
    void openEnvelope(crypto, room.name, bytes).then((opened) => {
      if (opened.ok) handle(from, opened.value.from, opened.value.body)
    })
  })
}

/** Someone who proved they hold the code and asks to be friends, waiting for the inviter. */
export interface CodeRequest {
  /** Names the request until it's answered or its connection goes. */
  readonly key: string
  readonly friend: NewFriend
  readonly fingerprint: string
  /** Adds them: true once the sealed pair secret is on its way, false if the code is used up. */
  approve(): Promise<boolean>
  decline(): Promise<void>
}

export interface HostInviteOptions extends Common {
  readonly code: LiveCode
  /** Resolves after `ms`; the platform clock provides it. */
  readonly sleep: (ms: number) => Promise<void>
  /** A new pair secret (`encodePairSecret` of 32 random bytes), made when someone is added. */
  readonly newSecret: () => string
  /** Someone asks: nobody is added until `approve`. */
  readonly onRequest: (request: CodeRequest) => void
  /** A request's connection went before it was answered. */
  readonly onRequestGone?: (key: string) => void
  readonly onPaired: (friend: NewFriend, secret: string) => void
  /** A wrong confirmation came in: a mistyped code, a guess, or someone in the middle. */
  readonly onWrongTry?: (count: number) => void
  /** The code took MAX_WRONG_TRIES wrong tries and stopped. */
  readonly onTooManyTries?: () => void
  /** Wrong tries the code had before, when it's hosted again after a reload. */
  readonly wrongTries?: number
  /** People this side has blocked: their requests go unanswered. */
  readonly refuse?: (id: PeerId) => boolean
}

/** Waits for friends to answer the invite, typed or as its link. The returned function stops it. */
export async function hostInvite(options: HostInviteOptions): Promise<() => Promise<void>> {
  const { signer, crypto } = options
  const names = await roomsFor(crypto, 'invite', options.code)
  const self = options.speaker?.()?.identity ?? signer.id
  let done = false
  const served: { room: Room; runs: HostRuns; off: () => void }[] = []
  /** Proven runs that have asked and not gone, so each asks once and a gone one isn't shown. */
  const asked = new Set<string>()
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
    const keyOf = (connection: ConnectionId) => `${room.name}\n${connection}`
    const runs = hostRuns({
      crypto,
      seal: options.seal,
      pake: options.pake,
      kind: 'invite',
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

    const request = async (run: Proven, body: Extract<Body, { type: 'pair-request' }>) => {
      const key = keyOf(run.connection)
      const friend = await friendFrom(options, run.device, body)
      const sealing: SealingKey = body.sealing
      const holds =
        friend !== undefined &&
        friend.id !== self &&
        options.refuse?.(friend.id) !== true &&
        sealing.device === run.device &&
        (await verifySealingKey(crypto, sealing)) &&
        (await canSealTo(options.seal, sealing))
      // Gone while it was checked, or the code was used: nothing to show.
      if (!holds || friend === undefined || done || !asked.has(key)) return
      options.onRequest({
        key,
        friend,
        fingerprint: await fingerprint(crypto, friend.id),
        async approve() {
          if (done || !asked.has(key) || runs.proven(run.connection, run.device) !== run)
            return false
          done = true
          const secret = options.newSecret()
          const sealed = await sealAnswer(
            options.seal,
            signer,
            { kind: 'pair', sender: self, to: friend.id, at: options.now(), run },
            sealing,
            secret,
          )
          // Stopped, or they left, while it was sealed: nobody to hand it to.
          if (!sealed.ok || stopped || runs.proven(run.connection, run.device) !== run) {
            done = stopped
            return false
          }
          await send(run.connection, { type: 'pair-accept', sealed: sealed.value })
          options.onPaired(friend, secret)
          // Give the accept a moment to leave before the rooms go.
          void options.sleep(2000).then(stop)
          return true
        },
        async decline() {
          asked.delete(key)
          runs.refuse(run.connection)
          await send(run.connection, { type: 'pair-decline' })
        },
      })
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
              type: 'pair-offer',
              mac: run.mac,
              handle: options.handle,
              ...speakerFields(options),
            })
          })
          return
        case 'pair-request': {
          const run = runs.proven(from, sender)
          if (run === undefined || asked.has(keyOf(from))) return
          asked.add(keyOf(from))
          void request(run, body)
          return
        }
        default:
      }
    })
    const offLeave = room.onPeerLeave((peer) => {
      runs.drop(peer)
      if (asked.delete(keyOf(peer))) options.onRequestGone?.(keyOf(peer))
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

/**
 * How far opening an invite has got: `listening` once the invite's room is joined on the relays,
 * `reached` once another Pigeon has connected there and the handshake has begun.
 */
export type OpenStep = 'listening' | 'reached'

export interface OpenInviteOptions extends Common {
  readonly invite: Invite
  /** This device's sealing key, which the pair secret is sealed to, and its private half. */
  readonly sealing: SealingKey
  readonly sealer: Sealer
  /** Gives up waiting for an answer: a Cancel button or a timeout. */
  readonly until: Promise<void>
  /** Resolves after `ms`; the platform clock provides it. */
  readonly sleep: (ms: number) => Promise<void>
  /** Told each step once, in order, so a screen can say what's happening. */
  readonly onStep?: (step: OpenStep) => void
}

export interface Offer {
  readonly friend: NewFriend
  readonly fingerprint: string
  /** The answer's fingerprint matched the link's. A typed code can't be checked this way. */
  readonly checked: boolean
  /**
   * Asks to be friends; resolves once the inviter has added you, with the pair secret they
   * sent, `declined` if they said no, or `false` if `until` gives up first.
   */
  confirm(until: Promise<void>): Promise<Accepted | 'declined' | false>
  cancel(): Promise<void>
}

export interface Accepted {
  readonly secret: string
}

export type OpenResult =
  | { readonly ok: true; readonly offer: Offer }
  /**
   * `impostor`: someone answered, but not the person whose fingerprint is in the link.
   * `wrong-code`: the inviter's Pigeon says the code is wrong.
   */
  | { readonly ok: false; readonly error: 'stopped' | 'impostor' | 'wrong-code' }

/** Answers an invite and waits for the inviter to say who it is. Nothing is agreed yet. */
export async function openInvite(options: OpenInviteOptions): Promise<OpenResult> {
  const { invite, signer, crypto } = options
  const room = await options.transport.join(await roomFor(crypto, 'invite', invite))
  options.onStep?.('listening')
  const send = async (to: ConnectionId, body: Body) =>
    room.send(to, await sealEnvelope(signer, room.name, options.now(), body))
  let reached = false
  const runs = openerRuns({
    crypto,
    seal: options.seal,
    pake: options.pake,
    kind: 'invite',
    room,
    device: signer.id,
    sleep: options.sleep,
    invite,
    startMessage: (to, via, pake) => {
      if (!reached) {
        reached = true
        options.onStep?.('reached')
      }
      return send(to, { type: 'pake-start', via, pake })
    },
    proveMessage: (to, mac) => send(to, { type: 'pake-prove', mac }),
  })

  let impostor = false
  let onAnswer: ((from: ConnectionId, sender: PeerId, body: Body) => void) | undefined
  let resolveOffer: ((result: OpenResult) => void) | undefined
  const offered = new Promise<OpenResult>((resolve) => {
    resolveOffer = resolve
  })

  const offer = async (from: ConnectionId, sender: PeerId, body: Body) => {
    if (body.type !== 'pair-offer') return
    const run = await runs.offer(from, sender, body)
    if (run === undefined) return
    const friend = await friendFrom(options, sender, body)
    if (friend === undefined) return
    // The link carries the identity's fingerprint, whichever of its devices answers.
    const print = await fingerprint(crypto, friend.id)
    if (invite.fingerprint !== undefined && print !== invite.fingerprint) {
      impostor = true
      return
    }
    const answer = {
      kind: 'pair',
      sender: friend.id,
      to: options.speaker?.()?.identity ?? signer.id,
      run,
    } as const
    resolveOffer?.({
      ok: true,
      offer: {
        friend,
        fingerprint: print,
        checked: invite.via === 'link',
        async confirm(until) {
          const accepted = await new Promise<Accepted | 'declined' | false>((resolve) => {
            onAnswer = (at, who, reply) => {
              if (at !== from || runs.proven(from, who) === undefined) return
              if (reply.type === 'pair-decline') resolve('declined')
              if (reply.type !== 'pair-accept') return
              void openAnswer(crypto, options.seal, options.sealer, reply.sealed, {
                ...answer,
                at: options.now(),
              }).then((secret) => {
                if (typeof secret === 'string' && isPairSecret(secret)) resolve({ secret })
              })
            }
            void until.then(() => resolve(false))
            void send(from, {
              type: 'pair-request',
              handle: options.handle,
              sealing: options.sealing,
              ...speakerFields(options),
            })
          })
          await leave()
          return accepted
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
      case 'pair-offer':
        void offer(from, sender, body)
        return
      default:
        onAnswer?.(from, sender, body)
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

  void options.until.then(async () => {
    resolveOffer?.({ ok: false, error: impostor ? 'impostor' : 'stopped' })
  })
  const result = await offered
  if (!result.ok) await leave()
  else offJoin()
  return result
}
