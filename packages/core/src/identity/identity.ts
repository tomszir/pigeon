// Who a peer is: the base32 of its public signing key, a fingerprint to compare out loud, and
// the pair room two friends meet in (docs/protocol.md, "Identity" and "Rooms").
import { base32Decode, base32Encode, hexEncode, utf8Encode } from '../encoding/bytes.ts'
import { err, ok, type Result } from '../result/result.ts'
import type { Crypto } from './crypto.ts'

/** The base32 public signing key. A string so it can key maps and travel in JSON. */
export type PeerId = string

export type KeyKind = 'ed25519' | 'p256'

/** Raw public key lengths: Ed25519 is 32 bytes, an uncompressed P-256 point is 65. */
const KEY_LENGTHS: Readonly<Record<number, KeyKind>> = { 32: 'ed25519', 65: 'p256' }

export const peerIdFromPublicKey = (publicKey: Uint8Array): PeerId => base32Encode(publicKey)

export interface PublicKey {
  readonly kind: KeyKind
  readonly bytes: Uint8Array
}

export function parsePeerId(id: string): Result<PublicKey, 'malformed'> {
  if (id !== id.toLowerCase()) return err('malformed')
  const bytes = base32Decode(id)
  if (!bytes.ok) return bytes
  const kind = KEY_LENGTHS[bytes.value.length]
  if (kind === undefined) return err('malformed')
  return ok({ kind, bytes: bytes.value })
}

export const isPeerId = (id: string): boolean => parsePeerId(id).ok

/** 16 hex characters of the key's SHA-256, shown in pairs for comparing by eye. */
export async function fingerprint(crypto: Crypto, id: PeerId): Promise<string> {
  return hexEncode(await crypto.sha256(utf8Encode(id))).slice(0, 16)
}

/** "7f3a 91c2 04be d817": how the UI spells a fingerprint. */
export const formatFingerprint = (print: string): string =>
  print.match(/.{1,4}/g)?.join(' ') ?? print

/** The one room two friends share. Either side computes the same name. */
export async function pairRoom(crypto: Crypto, a: PeerId, b: PeerId): Promise<`pair:${string}`> {
  const [first, second] = a < b ? [a, b] : [b, a]
  const digest = await crypto.sha256(utf8Encode(`pigeon/pair/v1\n${first}\n${second}`))
  return `pair:${base32Encode(digest)}`
}
