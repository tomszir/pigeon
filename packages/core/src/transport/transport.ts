// The only seam between Pigeon and whatever moves bytes between peers.
// Trystero implements it today; hand-written signaling can replace it without touching callers.

/**
 * A connection inside one room, as the transport names it. It is not an identity: anyone can
 * claim any id, so a peer's `PeerId` is learned from its signed `hello`.
 */
export type ConnectionId = string

export type RoomName =
  | `pair:${string}`
  | `invite:${string}`
  | `link:${string}`
  | `self:${string}`
  | `page:${string}`
  | 'lobby'

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

export interface JoinOptions {
  /**
   * Locks the room: offers are encrypted with a key derived from it, so only peers that know
   * it can read them or connect.
   */
  readonly password?: string
  /** Connect through the TURN relay only, so the other peer never learns your IP address. */
  readonly relayOnly?: boolean
}

export interface Transport {
  join(name: RoomName, options?: JoinOptions): Promise<Room>
  /** How many of the signaling relays it uses are reachable now, where it can tell. */
  relays?(): { readonly reachable: number; readonly total: number }
}
