// The invite handshake (decision 0018). The inviter waits in `invite:<code>`. Whoever opens the
// invite joins and sends a signed pair-request with the code and their name; the inviter answers
// pair-offer with its own name. The invitee now sees who answered and their fingerprint, checked
// against the link's when there is one. Only when they agree does pair-confirm go back, and the
// inviter's pair-accept close it, carrying the pair secret their room is named from (decision
// 0026). A code pairs once.
import { type DeviceLog, speakerIdentity } from '../devices/device-log.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import { fingerprint, type PeerId } from '../identity/identity.ts'
import { type Body, openEnvelope, type Speaker, sealEnvelope } from '../messages/envelope.ts'
import type { ConnectionId, Room, Transport } from '../transport/transport.ts'
import { type Invite, inviteRoom } from './invite.ts'

export interface NewFriend {
  /** Their identity: what they're known by, whichever device answered (decision 0024). */
  readonly id: PeerId
  readonly handle: string
  /** Their device log, when the device that answered isn't their first. */
  readonly devices?: DeviceLog | undefined
}

interface Common {
  readonly crypto: Crypto
  readonly signer: Signer
  readonly transport: Transport
  readonly handle: string
  readonly now: () => number
  /** The identity this device speaks for, and its device log, when it isn't the first device. */
  readonly speaker?: (() => Speaker | undefined) | undefined
  /**
   * The device log you already keep for someone, so a friend back from a recovery is checked
   * against it, and a device their recovery took off their list is refused (decision 0027).
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

export interface HostInviteOptions extends Common {
  readonly code: string
  /** Resolves after `ms`; the platform clock provides it. */
  readonly sleep: (ms: number) => Promise<void>
  /** A new pair secret (`encodePairSecret` of 32 random bytes), made when someone is added. */
  readonly newSecret: () => string
  readonly onPaired: (friend: NewFriend, secret: string) => void
  /** People this side has blocked: their requests go unanswered. */
  readonly refuse?: (id: PeerId) => boolean
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

/** Waits for one friend to answer the invite. The returned function stops waiting. */
export async function hostInvite(options: HostInviteOptions): Promise<() => Promise<void>> {
  const { code, signer } = options
  const room = await options.transport.join(inviteRoom(code))
  const send = async (to: ConnectionId, body: Body) =>
    room.send(to, await sealEnvelope(signer, room.name, options.now(), body))
  /** Who has asked on each connection, so a confirm is only taken from whoever was offered. */
  const asked = new Map<ConnectionId, { device: PeerId; friend: NewFriend }>()
  const self = options.speaker?.()?.identity ?? signer.id
  let done = false
  const off = listen(options.crypto, room, (from, sender, body) => {
    if (done || sender === signer.id || !('code' in body) || body.code !== code) return
    if (body.type === 'pair-request') {
      void friendFrom(options, sender, body).then((friend) => {
        if (friend === undefined || friend.id === self || options.refuse?.(friend.id) === true)
          return
        asked.set(from, { device: sender, friend })
        void send(from, {
          type: 'pair-offer',
          code,
          handle: options.handle,
          ...speakerFields(options),
        })
      })
      return
    }
    const asking = asked.get(from)
    if (body.type !== 'pair-confirm' || asking?.device !== sender) return
    const friend = asking.friend
    done = true
    const secret = options.newSecret()
    void send(from, { type: 'pair-accept', code, secret }).then(() => {
      options.onPaired(friend, secret)
      // Give the accept a moment to leave before the room goes.
      void options.sleep(2000).then(stop)
    })
  })
  const stop = async () => {
    done = true
    off()
    await room.leave()
  }
  return stop
}

/**
 * How far opening an invite has got: `listening` once the invite's room is joined on the relays,
 * `reached` once another Pigeon has connected there and been asked who it is.
 */
export type OpenStep = 'listening' | 'reached'

export interface OpenInviteOptions extends Common {
  readonly invite: Invite
  /** Gives up waiting for an answer: a Cancel button or a timeout. */
  readonly until: Promise<void>
  /** Told each step once, in order, so a screen can say what's happening. */
  readonly onStep?: (step: OpenStep) => void
}

export interface Offer {
  readonly friend: NewFriend
  readonly fingerprint: string
  /** The answer's fingerprint matched the link's. A typed code can't be checked this way. */
  readonly checked: boolean
  /**
   * Agrees to be friends; resolves once the inviter has added you, with the pair secret they
   * sent (none from a Pigeon before 0026), or `false` if `until` gives up first.
   */
  confirm(until: Promise<void>): Promise<Accepted | false>
  cancel(): Promise<void>
}

export interface Accepted {
  readonly secret?: string | undefined
}

export type OpenResult =
  | { readonly ok: true; readonly offer: Offer }
  /** `impostor`: someone answered, but not the person whose fingerprint is in the link. */
  | { readonly ok: false; readonly error: 'stopped' | 'impostor' }

/** Answers an invite and waits for the inviter to say who it is. Nothing is agreed yet. */
export async function openInvite(options: OpenInviteOptions): Promise<OpenResult> {
  const { invite, signer } = options
  const { code } = invite
  const room = await options.transport.join(inviteRoom(code))
  options.onStep?.('listening')
  const send = async (to: ConnectionId, body: Body) =>
    room.send(to, await sealEnvelope(signer, room.name, options.now(), body))
  let reached = false
  const request = (to: ConnectionId) => {
    if (!reached) {
      reached = true
      options.onStep?.('reached')
    }
    void send(to, { type: 'pair-request', code, handle: options.handle, ...speakerFields(options) })
  }

  let impostor = false
  let onAccept: ((sender: PeerId, secret: string | undefined) => void) | undefined
  let resolveOffer: ((result: OpenResult) => void) | undefined
  const offered = new Promise<OpenResult>((resolve) => {
    resolveOffer = resolve
  })

  const off = listen(options.crypto, room, (from, sender, body) => {
    if (sender === signer.id || !('code' in body) || body.code !== code) return
    if (body.type === 'pair-accept') {
      onAccept?.(sender, body.secret)
      return
    }
    if (body.type !== 'pair-offer') return
    void (async () => {
      const friend = await friendFrom(options, sender, body)
      if (friend === undefined) return
      // The link carries the identity's fingerprint, whichever of its devices answers.
      const print = await fingerprint(options.crypto, friend.id)
      if (invite.fingerprint !== undefined && print !== invite.fingerprint) {
        impostor = true
        return
      }
      resolveOffer?.({
        ok: true,
        offer: {
          friend,
          fingerprint: print,
          checked: invite.fingerprint !== undefined,
          async confirm(until) {
            const accepted = await new Promise<Accepted | false>((resolve) => {
              onAccept = (who, secret) => {
                if (who === sender) resolve({ secret })
              }
              void until.then(() => resolve(false))
              void send(from, { type: 'pair-confirm', code })
            })
            await leave()
            return accepted
          },
          cancel: () => leave(),
        },
      })
    })()
  })
  const offJoin = room.onPeerJoin(request)
  for (const peer of room.peers()) request(peer)

  let left = false
  const leave = async () => {
    if (left) return
    left = true
    off()
    offJoin()
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
