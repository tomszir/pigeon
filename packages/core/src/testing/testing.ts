// Fakes for tests across the repo: a deterministic, insecure Crypto and an in-memory network.
// Only tests import these; nothing here is safe for real use.
import { base32Encode, bytesEqual, concatBytes, utf8Encode } from '../encoding/bytes.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import type { PeerId } from '../identity/identity.ts'
import type { ConnectionId, Room, RoomName, Transport } from '../transport/transport.ts'

/** A 32-byte FNV-1a spread, standing in for SHA-256. Deterministic, not cryptographic. */
function fakeHash(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(32)
  for (let lane = 0; lane < 8; lane++) {
    let hash = (0x811c9dc5 ^ (lane * 0x9e3779b9)) >>> 0
    for (const byte of data) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0
    out.set([hash >>> 24, (hash >>> 16) & 255, (hash >>> 8) & 255, hash & 255], lane * 4)
  }
  return out
}

const fakeSignature = (id: PeerId, data: Uint8Array) => fakeHash(concatBytes(utf8Encode(id), data))

export const fakeCrypto: Crypto = {
  sha256: async (data) => fakeHash(data),
  verify: async (signer, signature, data) => bytesEqual(signature, fakeSignature(signer, data)),
}

/** A signer whose id is a well-formed Ed25519-length PeerId derived from `name`. */
export function fakeSigner(name: string): Signer {
  const id = base32Encode(fakeHash(utf8Encode(`fake-key:${name}`)))
  return { id, sign: async (data) => fakeSignature(id, data) }
}

/** Lets queued deliveries and the async handlers they start run to completion. */
export async function flush(turns = 200): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}

interface Member {
  readonly connection: ConnectionId
  readonly messages: Set<(from: ConnectionId, message: Uint8Array) => void>
  readonly joins: Set<(peer: ConnectionId) => void>
  readonly leaves: Set<(peer: ConnectionId) => void>
}

/**
 * Rooms shared by every transport made from one network. Delivery is asynchronous and in
 * order, like a data channel; `partition` cuts a transport off as if its network dropped.
 */
export function createMemoryNetwork() {
  const rooms = new Map<RoomName, Map<ConnectionId, Member>>()
  let nextConnection = 0
  const later = (run: () => void) => void Promise.resolve().then(run)

  function transport(): Transport & { disconnect(): void } {
    const joined = new Map<RoomName, Member>()

    function leaveRoom(name: RoomName, member: Member) {
      const members = rooms.get(name)
      if (members?.get(member.connection) !== member) return
      members.delete(member.connection)
      joined.delete(name)
      for (const other of members.values())
        later(() => {
          for (const handler of other.leaves) handler(member.connection)
        })
    }

    return {
      async join(name: RoomName): Promise<Room> {
        nextConnection += 1
        const member: Member = {
          connection: `c${nextConnection}`,
          messages: new Set(),
          joins: new Set(),
          leaves: new Set(),
        }
        const members = rooms.get(name) ?? new Map<ConnectionId, Member>()
        rooms.set(name, members)
        // Announce both ways a few turns on, once the awaiting caller has subscribed.
        const present = [...members.values()]
        void flush(5).then(() => {
          for (const other of present) {
            if (!members.has(other.connection) || !members.has(member.connection)) continue
            for (const handler of other.joins) handler(member.connection)
            for (const handler of member.joins) handler(other.connection)
          }
        })
        members.set(member.connection, member)
        joined.set(name, member)

        const deliver = (to: Member, message: Uint8Array) =>
          later(() => {
            if (!members.has(member.connection) || !members.has(to.connection)) return
            for (const handler of to.messages) handler(member.connection, message.slice())
          })
        const subscribe =
          <T>(set: Set<T>) =>
          (handler: T) => {
            set.add(handler)
            return () => void set.delete(handler)
          }

        return {
          name,
          peers: () => [...members.keys()].filter((id) => id !== member.connection),
          send(to, message) {
            const target = members.get(to)
            if (target !== undefined) deliver(target, message)
          },
          broadcast(message) {
            for (const other of members.values()) if (other !== member) deliver(other, message)
          },
          onMessage: subscribe(member.messages),
          onPeerJoin: subscribe(member.joins),
          onPeerLeave: subscribe(member.leaves),
          leave: async () => leaveRoom(name, member),
        }
      },
      disconnect() {
        for (const [name, member] of [...joined]) leaveRoom(name, member)
      },
    }
  }

  return { transport }
}
