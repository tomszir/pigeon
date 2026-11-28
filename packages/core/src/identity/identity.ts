// Who a peer is: the base32 of its public signing key, a fingerprint to compare out loud, and
// the pair room two friends meet in (docs/protocol.md, "Identity" and "Rooms").
import { base32Decode, base32Encode, hexEncode, utf8Encode } from '../encoding/bytes.ts'
import { err, ok, type Result } from '../result/result.ts'
import type { Crypto } from './crypto.ts'
import type { PeerId } from './peer-id.ts'

export type { PeerId }

export type KeyKind = 'ed25519'

/** A raw Ed25519 public key is 32 bytes. */
const ED25519_KEY_BYTES = 32

export const peerIdFromPublicKey = (publicKey: Uint8Array): PeerId => base32Encode(publicKey)

export interface PublicKey {
  readonly kind: KeyKind
  readonly bytes: Uint8Array
}

export function parsePeerId(id: string): Result<PublicKey, 'malformed'> {
  if (id !== id.toLowerCase()) return err('malformed')
  const bytes = base32Decode(id)
  if (!bytes.ok) return bytes
  if (bytes.value.length !== ED25519_KEY_BYTES) return err('malformed')
  return ok({ kind: 'ed25519', bytes: bytes.value })
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
