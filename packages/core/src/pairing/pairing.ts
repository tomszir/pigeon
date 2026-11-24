// The invite handshake. The inviter waits in `invite:<token>`; the invitee joins, sends a signed
// pair-request carrying the token, and the inviter answers pair-accept. Each side then knows the
// other's id and handle. A token pairs once.
import type { Crypto, Signer } from '../identity/crypto.ts'
import type { PeerId } from '../identity/identity.ts'
import { openEnvelope, sealEnvelope } from '../messages/envelope.ts'
import type { Transport } from '../transport/transport.ts'
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
  /** Resolves after `ms`; the platform clock provides it. */
  readonly sleep: (ms: number) => Promise<void>
}

export interface HostInviteOptions extends Common {
  readonly token: string
  readonly onPaired: (friend: NewFriend) => void
}

/** Waits for one friend to answer the invite. The returned function stops waiting. */
export async function hostInvite(options: HostInviteOptions): Promise<() => Promise<void>> {
  const room = await options.transport.join(inviteRoom(options.token))
  let done = false
  const stop = async () => {
    done = true
    off()
    await room.leave()
  }
  const off = room.onMessage((from, bytes) => {
    void openEnvelope(options.crypto, room.name, bytes).then(async (opened) => {
      if (done || !opened.ok || opened.value.from === options.signer.id) return
      const body = opened.value.body
      if (body.type !== 'pair-request' || body.token !== options.token) return
      done = true
      const accept = await sealEnvelope(options.signer, room.name, options.now(), {
        type: 'pair-accept',
        token: options.token,
        handle: options.handle,
      })
      room.send(from, accept)
      options.onPaired({ id: opened.value.from, handle: body.handle })
      // Give the accept a moment to leave before the room goes.
      void options.sleep(2000).then(stop)
    })
  })
  return stop
}

export interface AcceptInviteOptions extends Common {
  readonly invite: Invite
  /** Aborts waiting, for a Cancel button or a timeout. */
  readonly until: Promise<void>
}

export type AcceptResult = { ok: true; friend: NewFriend } | { ok: false; error: 'stopped' }

/** Answers an invite and waits for the inviter to confirm. */
export async function acceptInvite(options: AcceptInviteOptions): Promise<AcceptResult> {
  const { invite } = options
  const room = await options.transport.join(inviteRoom(invite.token))
  const request = () =>
    sealEnvelope(options.signer, room.name, options.now(), {
      type: 'pair-request',
      token: invite.token,
      handle: options.handle,
    })
  const result = await new Promise<AcceptResult>((resolve) => {
    void options.until.then(() => resolve({ ok: false, error: 'stopped' }))
    room.onPeerJoin((peer) => void request().then((bytes) => room.send(peer, bytes)))
    for (const peer of room.peers()) void request().then((bytes) => room.send(peer, bytes))
    room.onMessage((_from, bytes) => {
      void openEnvelope(options.crypto, room.name, bytes).then((opened) => {
        if (!opened.ok || opened.value.from !== invite.id) return
        const body = opened.value.body
        if (body.type !== 'pair-accept' || body.token !== invite.token) return
        resolve({ ok: true, friend: { id: invite.id, handle: body.handle } })
      })
    })
  })
  await room.leave()
  return result
}
