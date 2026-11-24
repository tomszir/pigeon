// The only seam between Pigeon and whatever moves bytes between peers (decision 0002).
// Trystero implements it today; hand-written signaling can replace it without touching callers.

export type PeerId = string

export type RoomName = `pair:${string}` | `page:${string}` | 'lobby'

export interface Room {
  readonly name: RoomName
  peers(): readonly PeerId[]
  send(to: PeerId, message: Uint8Array): void
  broadcast(message: Uint8Array): void
  onMessage(handler: (from: PeerId, message: Uint8Array) => void): () => void
  onPeerJoin(handler: (peer: PeerId) => void): () => void
  onPeerLeave(handler: (peer: PeerId) => void): () => void
  leave(): Promise<void>
}

export interface Transport {
  join(name: RoomName): Promise<Room>
}
