// The only seam between Pigeon and whatever moves bytes between peers (decision 0002).
// Trystero implements it today; hand-written signaling can replace it without touching callers.

/**
 * A connection inside one room, as the transport names it. It is not an identity: anyone can
 * claim any id, so a peer's `PeerId` is learned from its signed `hello`.
 */
export type ConnectionId = string

export type RoomName = `pair:${string}` | `invite:${string}` | `page:${string}` | 'lobby'

export interface Room {
  readonly name: RoomName
  peers(): readonly ConnectionId[]
  send(to: ConnectionId, message: Uint8Array): void
  broadcast(message: Uint8Array): void
  onMessage(handler: (from: ConnectionId, message: Uint8Array) => void): () => void
  onPeerJoin(handler: (peer: ConnectionId) => void): () => void
  onPeerLeave(handler: (peer: ConnectionId) => void): () => void
  leave(): Promise<void>
}

export interface Transport {
  join(name: RoomName): Promise<Room>
}
