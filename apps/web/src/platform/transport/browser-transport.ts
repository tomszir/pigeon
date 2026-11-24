// The one module that knows about Trystero (decision 0002): Nostr relays for signaling, WebRTC
// data channels for everything after. Trystero's own identity is turned off; Pigeon's signed
// envelopes say who is who.
import { MAX_MESSAGE_BYTES, type Room, type RoomName, type Transport } from '@pigeon/core'
import { joinRoom } from 'trystero'

/** Rooms are namespaced by this, so Pigeon only ever meets Pigeon. */
const APP_ID = 'pigeon.tomszir.com/v1'

const toBytes = (data: unknown): Uint8Array | undefined => {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return undefined
}

export function createBrowserTransport(): Transport {
  return {
    async join(name: RoomName): Promise<Room> {
      const room = joinRoom(
        { appId: APP_ID, identity: 'none', maxReceiveBytes: MAX_MESSAGE_BYTES },
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
