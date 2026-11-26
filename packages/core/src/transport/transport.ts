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

/**
 * The DTLS certificate fingerprints of one connection's data channel, as this side sees them:
 * SHA-256, lowercase hex with no colons. `local` is this side's own certificate; `remote` is the
 * one the DTLS handshake checked, which only its key holder can present, so it must come from
 * the channel itself and not from a description the peer can send again later. A message signed
 * over both therefore names the very channel it was meant for, and the other end sees the same
 * pair swapped.
 */
export interface ChannelBinding {
  readonly local: string
  readonly remote: string
}

/** A certificate fingerprint as `ChannelBinding` spells it: 64 lowercase hex characters. */
export const isFingerprint = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

export interface Room {
  readonly name: RoomName
  peers(): readonly ConnectionId[]
  /**
   * The channel binding of the connection to `peer`, or undefined when there's no direct
   * channel to bind to (not connected yet, gone, or carried through another peer).
   */
  binding(peer: ConnectionId): Promise<ChannelBinding | undefined>
  /** Messages to one peer arrive in the order they were sent, whatever their size. */
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
