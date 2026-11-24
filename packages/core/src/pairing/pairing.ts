// The invite handshake (decision 0018). The inviter waits in `invite:<code>`. Whoever opens the
// invite joins and sends a signed pair-request with the code and their name; the inviter answers
// pair-offer with its own name. The invitee now sees who answered and their fingerprint, checked
// against the link's when there is one. Only when they agree does pair-confirm go back, and the
// inviter's pair-accept close it, carrying the pair secret their room is named from (decision
// 0026). A code pairs once.
import type { Crypto, Signer } from '../identity/crypto.ts'
import { fingerprint, type PeerId } from '../identity/identity.ts'
import { type Body, openEnvelope, sealEnvelope } from '../messages/envelope.ts'
import type { ConnectionId, Room, Transport } from '../transport/transport.ts'
import { type Invite, inviteRoom } from './invite.ts'

export interface NewFriend {
  readonly id: PeerId
  readonly handle: string
}

interface Common {
  readonly crypto: Crypto
  readonly signer: Signer
  readonly transport: Transport
  readonly handle: string
  readonly now: () => number
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
  const asked = new Map<ConnectionId, NewFriend>()
  let done = false
  const off = listen(options.crypto, room, (from, sender, body) => {
    if (done || sender === signer.id || !('code' in body) || body.code !== code) return
    if (body.type === 'pair-request') {
      if (options.refuse?.(sender) === true) return
      asked.set(from, { id: sender, handle: body.handle })
      void send(from, { type: 'pair-offer', code, handle: options.handle })
      return
    }
    const friend = asked.get(from)
    if (body.type !== 'pair-confirm' || friend?.id !== sender) return
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
    void send(to, { type: 'pair-request', code, handle: options.handle })
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
    void fingerprint(options.crypto, sender).then((print) => {
      if (invite.fingerprint !== undefined && print !== invite.fingerprint) {
        impostor = true
        return
      }
      const friend = { id: sender, handle: body.handle }
      resolveOffer?.({
        ok: true,
        offer: {
          friend,
          fingerprint: print,
          checked: invite.fingerprint !== undefined,
          async confirm(until) {
            const accepted = await new Promise<Accepted | false>((resolve) => {
              onAccept = (who, secret) => {
                if (who === friend.id) resolve({ secret })
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
    })
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
