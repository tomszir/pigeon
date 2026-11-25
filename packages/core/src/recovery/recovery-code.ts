// The recovery key on paper (decision 0027): the key's 32-byte seed, the identity it brings
// back and the epoch it starts, with a checksum, in groups of four letters to copy by hand.
//
//   bytes: version (1) · epoch (1) · seed (32) · identity's public key (32 or 65) · checksum (2)
//
// The checksum is the first two bytes of SHA-256 over everything before it, so a letter copied
// wrong is caught before anything is signed.
import { base32Decode, base32Encode, bytesEqual, concatBytes } from '../encoding/bytes.ts'
import type { Crypto } from '../identity/crypto.ts'
import { type PeerId, parsePeerId, peerIdFromPublicKey } from '../identity/identity.ts'
import { err, ok, type Result } from '../result/result.ts'

const VERSION = 1
export const RECOVERY_SEED_BYTES = 32
const CHECKSUM_BYTES = 2
/** Epochs fit one byte; a log holds far fewer (MAX_EPOCHS). */
const MAX_EPOCH = 255

export interface RecoveryCode {
  /** The identity it brings back. */
  readonly identity: PeerId
  /** The epoch a `recover` signed with it starts. */
  readonly epoch: number
  /** The Ed25519 seed of the recovery key. */
  readonly seed: Uint8Array
}

/** "ABCD-EFGH-...": upper case, so it reads well printed. */
export async function encodeRecoveryCode(crypto: Crypto, code: RecoveryCode): Promise<string> {
  const identity = parsePeerId(code.identity)
  if (!identity.ok) throw new Error('not an identity')
  if (code.seed.length !== RECOVERY_SEED_BYTES) throw new Error('not a recovery seed')
  if (!Number.isSafeInteger(code.epoch) || code.epoch < 1 || code.epoch > MAX_EPOCH)
    throw new Error('epoch out of range')
  const body = concatBytes(Uint8Array.of(VERSION, code.epoch), code.seed, identity.value.bytes)
  const checksum = (await crypto.sha256(body)).subarray(0, CHECKSUM_BYTES)
  const letters = base32Encode(concatBytes(body, checksum)).toUpperCase()
  return letters.match(/.{1,4}/g)?.join('-') ?? letters
}

export type RecoveryCodeError = 'malformed' | 'mistyped'

/** Reads a code as typed: spaces, dashes and case don't matter. `mistyped` when a letter's wrong. */
export async function decodeRecoveryCode(
  crypto: Crypto,
  text: string,
): Promise<Result<RecoveryCode, RecoveryCodeError>> {
  const letters = text.toLowerCase().replace(/[^a-z2-7]/g, '')
  const bytes = base32Decode(letters)
  if (!bytes.ok) return err('malformed')
  const all = bytes.value
  const keyLength = all.length - 2 - RECOVERY_SEED_BYTES - CHECKSUM_BYTES
  if (keyLength !== 32 && keyLength !== 65) return err('malformed')
  const body = all.subarray(0, all.length - CHECKSUM_BYTES)
  const checksum = all.subarray(all.length - CHECKSUM_BYTES)
  if (!bytesEqual((await crypto.sha256(body)).subarray(0, CHECKSUM_BYTES), checksum))
    return err('mistyped')
  if (body[0] !== VERSION) return err('malformed')
  const epoch = body[1] ?? 0
  if (epoch < 1) return err('malformed')
  return ok({
    identity: peerIdFromPublicKey(body.slice(2 + RECOVERY_SEED_BYTES)),
    epoch,
    seed: body.slice(2, 2 + RECOVERY_SEED_BYTES),
  })
}
