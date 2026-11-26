// The one module that knows about Trystero, so it can be swapped out: Nostr relays for signaling,
// WebRTC data channels for everything after. Trystero's own identity is turned off; Pigeon's
// signed envelopes say who is who. TURN servers from the site's Worker let peers meet when they
// can't reach each other directly. A room's password encrypts its offers, and relay-only
// connections go through TURN alone, so the other peer never sees your address.
import {
  type ChannelBinding,
  isFingerprint,
  type JoinOptions,
  MAX_MESSAGE_BYTES,
  type Room,
  type RoomName,
  type Transport,
} from '@pigeon/core'
import { getRelaySockets, joinRoom } from 'trystero'
import { type TurnServer, turnServers } from './turn-servers.ts'

/** Rooms are namespaced by this, so Pigeon only ever meets Pigeon. */
const APP_ID = 'pigeon.tomszir.com/v1'

const toBytes = (data: unknown): Uint8Array | undefined => {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return undefined
}

/**
 * The SHA-256 certificate fingerprint an SDP names (`a=fingerprint:sha-256 AB:CD:...`), as
 * `ChannelBinding` spells it. Undefined when it names none, two different ones, or any
 * fingerprint in another form or with another hash: the browser checks the DTLS certificate
 * against the fingerprints the SDP gives it, so the one read here must be the only one there,
 * or a peer could name one certificate to Pigeon and have DTLS check another.
 */
export function sdpFingerprint(sdp: string | undefined): string | undefined {
  if (sdp === undefined) return undefined
  const found = new Set<string>()
  for (const line of sdp.split(/\r?\n/)) {
    if (!/^a=fingerprint:/i.test(line)) continue
    const match = /^a=fingerprint:sha-256 ((?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2})$/.exec(line)
    if (match === null) return undefined
    found.add((match[1] ?? '').replaceAll(':', '').toLowerCase())
  }
  const [only] = found
  return found.size === 1 && isFingerprint(only) ? only : undefined
}

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

/**
 * A direct peer connection's binding. The remote half is the SHA-256 of the certificate DTLS
 * checked, as the data channel's transport reports it, not the remote description: the peer can
 * send a new description after the handshake, through Trystero's renegotiation, and some browsers
 * show it as current while the old channel keeps running. That description must still name the
 * same certificate, and the channel must be connected; otherwise there's nothing to bind to. The
 * local half is from this browser's own description, which only it writes.
 */
export async function connectionBinding(
  connection: RTCPeerConnection | null | undefined,
  digest: (data: ArrayBuffer) => Promise<ArrayBuffer> = (data) =>
    crypto.subtle.digest('SHA-256', data),
): Promise<ChannelBinding | undefined> {
  // A peer reached through other peers has no channel of its own to bind to.
  if (connection === null || connection === undefined) return undefined
  const transport = connection.sctp?.transport
  const connected = () => transport?.state === 'connected'
  if (transport === undefined || !connected()) return undefined
  const [certificate] = transport.getRemoteCertificates?.() ?? []
  if (certificate === undefined) return undefined
  const remote = hex(await digest(certificate))
  const local = sdpFingerprint(connection.localDescription?.sdp)
  const named = sdpFingerprint(connection.remoteDescription?.sdp)
  if (!connected() || local === undefined || named !== remote) return undefined
  return { local, remote }
}

/** Some TURN server among `servers`: a `turn:` or `turns:` URL. */
const hasRelay = (servers: readonly TurnServer[]) =>
  servers.some((server) =>
    (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) => /^turns?:/i.test(url)),
  )

export function createBrowserTransport(
  getTurnServers: () => Promise<TurnServer[]> = turnServers(),
  /**
   * Told when a relay-only room is joined with no relay to go through. Pigeon still doesn't
   * connect directly (the visitor asked it not to), so nobody will answer until the relay is back.
   */
  onNoRelay: () => void = () => undefined,
): Transport {
  return {
    relays() {
      const sockets = Object.values(getRelaySockets())
      return {
        reachable: sockets.filter((socket) => socket.readyState === WebSocket.OPEN).length,
        total: sockets.length,
      }
    },
    async join(name: RoomName, options: JoinOptions = {}): Promise<Room> {
      const turnConfig = await getTurnServers()
      if (options.relayOnly === true && !hasRelay(turnConfig)) onNoRelay()
      const room = joinRoom(
        {
          appId: APP_ID,
          identity: 'none',
          maxReceiveBytes: MAX_MESSAGE_BYTES,
          turnConfig,
          ...(options.password === undefined ? {} : { password: options.password }),
          ...(options.relayOnly === true ? { rtcConfig: { iceTransportPolicy: 'relay' } } : {}),
        },
        name,
      )
      const channel = room.makeAction<Uint8Array>('envelope')
      const peers = () => Object.keys(room.getPeers())
      // Trystero sends a small message in one frame at once but a large one in chunks once the
      // other side is ready, so a small one could overtake a large one sent before it. Each
      // peer's sends wait for the one before, so they arrive in the order they were sent.
      const outgoing = new Map<string, Promise<unknown>>()
      const sendInOrder = (to: string, message: Uint8Array) => {
        const sent = (outgoing.get(to) ?? Promise.resolve())
          .then(() => channel.send(message, { target: to }))
          .catch(() => undefined)
        outgoing.set(to, sent)
        void sent.then(() => {
          if (outgoing.get(to) === sent) outgoing.delete(to)
        })
      }
      return {
        name,
        peers,
        binding: async (peer) => {
          const info = room.getPeers()[peer]
          return info?.direct === true ? await connectionBinding(info.connection) : undefined
        },
        send: sendInOrder,
        broadcast: (message) => {
          for (const peer of peers()) sendInOrder(peer, message)
        },
        onMessage: (handler) =>
          channel.onMessage((data, context) => {
            const bytes = toBytes(data)
            if (bytes !== undefined) handler(context.peerId, bytes)
          }),
        onPeerJoin: (handler) =>
          // Replays peers already here, so a late subscriber still greets them.
          room.onPeerJoin(({ peerId }) => handler(peerId), { replay: true }),
        onPeerLeave: (handler) => room.onPeerLeave(({ peerId }) => handler(peerId)),
        leave: () => room.leave(),
      }
    },
  }
}
