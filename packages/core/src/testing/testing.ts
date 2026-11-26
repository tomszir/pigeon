// Fakes for tests across the repo: a deterministic, insecure Crypto and an in-memory network.
// Only tests import these; nothing here is safe for real use.
import {
  base32Encode,
  bytesEqual,
  concatBytes,
  hexEncode,
  utf8Decode,
  utf8Encode,
} from '../encoding/bytes.ts'
import { canonicalBytes, type Json } from '../encoding/canonical.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import type { PeerId } from '../identity/identity.ts'
import type { SealCrypto, Sealer } from '../mail/seal-crypto.ts'
import type {
  ConnectionId,
  JoinOptions,
  Room,
  RoomName,
  Transport,
} from '../transport/transport.ts'

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
  hmacSha256: async (key, data) => fakeHash(concatBytes(key, new Uint8Array([0xff]), data)),
  verify: async (signer, signature, data) => bytesEqual(signature, fakeSignature(signer, data)),
}

/** A signer whose id is a well-formed Ed25519-length PeerId derived from `name`. */
export function fakeSigner(name: string): Signer {
  const id = base32Encode(fakeHash(utf8Encode(`fake-key:${name}`)))
  return { id, sign: async (data) => fakeSignature(id, data) }
}

/**
 * `signer` as a Pigeon that signs entries over the bytes that say what they are: a device-log or
 * chat entry it's asked to sign, it signs with a `v` naming its kind and, in a device log, its
 * `epoch` even in epoch 0. Anything else it signs as it's given.
 */
export function typedSigner(signer: Signer): Signer {
  const typed = (data: Uint8Array): Uint8Array => {
    const text = utf8Decode(data)
    if (!text.ok || !text.value.startsWith('{')) return data
    const value = JSON.parse(text.value) as Record<string, Json>
    if ('v' in value || 'type' in value) return data
    if ('log' in value && 'lamport' in value)
      return canonicalBytes({ v: 'pigeon/chat-entry/v1', ...value })
    if (!('prev' in value && 'kind' in value)) return data
    return canonicalBytes({ v: 'pigeon/device-entry/v1', epoch: 0, ...value })
  }
  return { id: signer.id, sign: (data) => signer.sign(typed(data)) }
}

/**
 * Sealing that behaves like the real thing and is worth nothing: a "public key" is the hash of
 * its private half, a shared secret the hash of both public keys in order, and sealing XORs a
 * hash stream with a hash tag. Deterministic given `seed`, so tests repeat.
 */
export function fakeSealCrypto(seed = 1): SealCrypto & { sealer(name: string): Sealer } {
  let counter = seed
  const random = (length: number) => {
    const out = new Uint8Array(length)
    for (let at = 0; at < length; at += 32) {
      counter += 1
      out.set(fakeHash(utf8Encode(`random:${counter}`)).subarray(0, length - at), at)
    }
    return out
  }
  const publicOf = (secret: Uint8Array) =>
    concatBytes(new Uint8Array([4]), fakeHash(secret), fakeHash(fakeHash(secret)))
  const shared = (a: Uint8Array, b: Uint8Array) => {
    const [low, high] = [a, b].sort((x, y) => (base32Encode(x) < base32Encode(y) ? -1 : 1))
    return fakeHash(concatBytes(low ?? a, high ?? b))
  }
  const stream = (key: Uint8Array, nonce: Uint8Array, length: number) => {
    const out = new Uint8Array(length)
    for (let at = 0, block = 0; at < length; at += 32, block++)
      out.set(
        fakeHash(concatBytes(key, nonce, new Uint8Array([block & 255, block >> 8]))).subarray(
          0,
          length - at,
        ),
        at,
      )
    return out
  }
  const tag = (key: Uint8Array, nonce: Uint8Array, data: Uint8Array) =>
    fakeHash(concatBytes(key, nonce, data)).subarray(0, 16)
  // As WebCrypto does with a key that isn't a point it can use; a key whose 64 bytes are all the
  // same stands for one of the right shape that isn't on the curve.
  const usable = (peer: Uint8Array) =>
    peer.length === 65 && peer[0] === 4 && !peer.subarray(1).every((b) => b === peer[1])
  // HPKE's stand-in: a key from the shared secret, `info` and both public keys, and the
  // sealing below with `aad` in the tag's place of the nonce.
  const hpkeKey = (enc: Uint8Array, recipient: Uint8Array, info: Uint8Array) =>
    fakeHash(concatBytes(shared(enc, recipient), info, enc, recipient))
  const zero = new Uint8Array(12)
  return {
    async ephemeralShare(peer) {
      if (!usable(peer)) throw new Error('DataError: Invalid keyData')
      const secret = random(32)
      const publicKey = publicOf(secret)
      return { publicKey, shared: shared(publicKey, peer) }
    },
    hkdf: async (ikm, info, length) => {
      const out = new Uint8Array(length)
      for (let at = 0, block = 0; at < length; at += 32, block++)
        out.set(
          fakeHash(concatBytes(ikm, utf8Encode(`${info}/${block}`))).subarray(0, length - at),
          at,
        )
      return out
    },
    async seal(key, data) {
      const nonce = random(12)
      const body = stream(key, nonce, data.length).map((byte, i) => byte ^ (data[i] ?? 0))
      return concatBytes(nonce, body, tag(key, nonce, body))
    },
    async open(key, sealed) {
      if (sealed.length < 28) return undefined
      const nonce = sealed.subarray(0, 12)
      const body = sealed.subarray(12, sealed.length - 16)
      if (!bytesEqual(sealed.subarray(sealed.length - 16), tag(key, nonce, body))) return undefined
      return stream(key, nonce, body.length).map((byte, i) => byte ^ (body[i] ?? 0))
    },
    random,
    async hpkeSeal(peer, info, aad, data) {
      if (!usable(peer)) throw new Error('DataError: Invalid keyData')
      const enc = publicOf(random(32))
      const key = hpkeKey(enc, peer, info)
      const body = stream(key, zero, data.length).map((byte, i) => byte ^ (data[i] ?? 0))
      return { enc, sealed: concatBytes(body, tag(key, aad, body)) }
    },
    sealer(name) {
      const publicKey = publicOf(utf8Encode(`sealer:${name}`))
      return {
        publicKey,
        share: async (peer) =>
          peer.length === 65 && peer[0] === 4 ? shared(publicKey, peer) : undefined,
        async hpkeOpen(enc, info, aad, sealed) {
          if (enc.length !== 65 || enc[0] !== 4 || sealed.length < 16) return undefined
          const key = hpkeKey(enc, publicKey, info)
          const body = sealed.subarray(0, sealed.length - 16)
          if (!bytesEqual(sealed.subarray(sealed.length - 16), tag(key, aad, body)))
            return undefined
          return stream(key, zero, body.length).map((byte, i) => byte ^ (body[i] ?? 0))
        },
      }
    },
  }
}

/** Lets queued deliveries and the async handlers they start run to completion. */
export async function flush(turns = 200): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}

interface Member {
  readonly connection: ConnectionId
  /** The fingerprint of the certificate this member's channels present, as `ChannelBinding` has it. */
  readonly certificate: string
  readonly messages: Set<(from: ConnectionId, message: Uint8Array) => void>
  readonly joins: Set<(peer: ConnectionId) => void>
  readonly leaves: Set<(peer: ConnectionId) => void>
}

let networks = 0

/**
 * Rooms shared by every transport made from one network. Delivery is asynchronous and in
 * order, like a data channel; `disconnect` cuts a transport off as if its network dropped. A
 * room's password works like Trystero's: peers with different passwords in a room of the same
 * name never meet, though a relay still sees them all under that name. Each connection presents
 * a certificate of its own, as a browser's does, unless the transport was made with one
 * `certificate` for all of them, as an attacker relaying between connections would.
 */
export function createMemoryNetwork() {
  /** Keyed by name and password. */
  const rooms = new Map<string, Map<ConnectionId, Member>>()
  /** Every join, as the relays would see it. */
  const joins: { readonly name: RoomName; readonly options: JoinOptions }[] = []
  const key = (name: RoomName, password: string | undefined) => `${name}\u0000${password ?? ''}`
  let nextConnection = 0
  networks += 1
  const networkId = networks
  const later = (run: () => void) => void Promise.resolve().then(run)

  function transport(certificate?: string): Transport & { disconnect(): void } {
    const joined = new Map<string, Member>()

    function leaveRoom(at: string, member: Member) {
      const members = rooms.get(at)
      if (members?.get(member.connection) !== member) return
      members.delete(member.connection)
      joined.delete(at)
      for (const other of members.values())
        later(() => {
          for (const handler of other.leaves) handler(member.connection)
        })
    }

    return {
      async join(name: RoomName, options: JoinOptions = {}): Promise<Room> {
        joins.push({ name, options })
        const at = key(name, options.password)
        nextConnection += 1
        const connection = `c${nextConnection}`
        const member: Member = {
          connection,
          // Named by the network too: two networks' first connections are different browsers.
          certificate:
            certificate ??
            hexEncode(fakeHash(utf8Encode(`certificate:${networkId}:${connection}`))),
          messages: new Set(),
          joins: new Set(),
          leaves: new Set(),
        }
        const members = rooms.get(at) ?? new Map<ConnectionId, Member>()
        rooms.set(at, members)
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
        joined.set(at, member)

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
          async binding(peer) {
            const other = members.get(peer)
            if (other === undefined || other === member || !members.has(member.connection))
              return undefined
            return { local: member.certificate, remote: other.certificate }
          },
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
          leave: async () => leaveRoom(at, member),
        }
      },
      disconnect() {
        for (const [at, member] of [...joined]) leaveRoom(at, member)
      },
    }
  }

  /** How many peers are in rooms called `name`, whatever their password: what a relay sees. */
  const occupants = (name: RoomName): number =>
    [...rooms.entries()]
      .filter(([at]) => at.startsWith(`${name}\u0000`))
      .reduce((sum, [, members]) => sum + members.size, 0)

  return { transport, joins, occupants }
}

/**
 * Someone in the middle of a room: joins `name` on two transports and passes every message
 * across to everyone on the other side, through `change` if given (undefined drops it).
 * Returns a function that stops it.
 */
export async function relayRoom(
  left: Transport,
  right: Transport,
  name: RoomName,
  change: (message: Uint8Array) => Promise<Uint8Array | undefined> = async (message) => message,
): Promise<() => Promise<void>> {
  const a = await left.join(name)
  const b = await right.join(name)
  const pass = (to: Room) => (_from: ConnectionId, message: Uint8Array) =>
    void change(message).then((changed) => {
      if (changed !== undefined) to.broadcast(changed)
    })
  const offA = a.onMessage(pass(b))
  const offB = b.onMessage(pass(a))
  return async () => {
    offA()
    offB()
    await a.leave()
    await b.leave()
  }
}
