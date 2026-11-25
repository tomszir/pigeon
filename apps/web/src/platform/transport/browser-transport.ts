// The one module that knows about Trystero, so it can be swapped out: Nostr relays for signaling,
// WebRTC data channels for everything after. Trystero's own identity is turned off; Pigeon's
// signed envelopes say who is who. TURN servers from the site's Worker let peers meet when they
// can't reach each other directly. A room's password encrypts its offers, and relay-only
// connections go through TURN alone, so the other peer never sees your address.
import {
  type JoinOptions,
  MAX_MESSAGE_BYTES,
  type Room,
  type RoomName,
  type Transport,
} from '@pigeon/core'
import { joinRoom } from 'trystero'
import { type TurnServer, turnServers } from './turn-servers.ts'

/** Rooms are namespaced by this, so Pigeon only ever meets Pigeon. */
const APP_ID = 'pigeon.tomszir.com/v1'

const toBytes = (data: unknown): Uint8Array | undefined => {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return undefined
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
      return {
        name,
        peers,
        send: (to, message) => void channel.send(message, { target: to }).catch(() => undefined),
        broadcast: (message) => void channel.send(message).catch(() => undefined),
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
