// The invite handshake (decision 0018). The inviter waits in `invite:<code>`. Whoever opens the
// invite joins and sends a signed pair-request with the code and their name; the inviter answers
// pair-offer with its own name. The invitee now sees who answered and their fingerprint, checked
// against the link's when there is one. Only when they agree does pair-confirm go back, and the
// inviter's pair-accept close it. A code pairs once.
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
  readonly onPaired: (friend: NewFriend) => void
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
      asked.set(from, { id: sender, handle: body.handle })
      void send(from, { type: 'pair-offer', code, handle: options.handle })
      return
    }
    const friend = asked.get(from)
    if (body.type !== 'pair-confirm' || friend?.id !== sender) return
    done = true
    void send(from, { type: 'pair-accept', code }).then(() => {
      options.onPaired(friend)
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

export interface OpenInviteOptions extends Common {
  readonly invite: Invite
  /** Gives up waiting for an answer: a Cancel button or a timeout. */
  readonly until: Promise<void>
}

export interface Offer {
  readonly friend: NewFriend
  readonly fingerprint: string
  /** The answer's fingerprint matched the link's. A typed code can't be checked this way. */
  readonly checked: boolean
  /** Agrees to be friends; resolves once the inviter has added you, or `until` gives up. */
  confirm(until: Promise<void>): Promise<boolean>
  cancel(): Promise<void>
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
  const send = async (to: ConnectionId, body: Body) =>
    room.send(to, await sealEnvelope(signer, room.name, options.now(), body))
  const request = (to: ConnectionId) =>
    void send(to, { type: 'pair-request', code, handle: options.handle })

  let impostor = false
  let onAccept: ((sender: PeerId) => void) | undefined
  let resolveOffer: ((result: OpenResult) => void) | undefined
  const offered = new Promise<OpenResult>((resolve) => {
    resolveOffer = resolve
  })

  const off = listen(options.crypto, room, (from, sender, body) => {
    if (sender === signer.id || !('code' in body) || body.code !== code) return
    if (body.type === 'pair-accept') {
      onAccept?.(sender)
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
            const accepted = await new Promise<boolean>((resolve) => {
              onAccept = (who) => {
                if (who === friend.id) resolve(true)
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
