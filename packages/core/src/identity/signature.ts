// One spelling per signature. Ed25519 has one spelling when S is below the group order, as
// RFC 8032 requires; that's checked here, so it doesn't rest on each browser's WebCrypto.
import { type PeerId, parsePeerId } from './identity.ts'

/** The order of Ed25519's base point. */
const L = (1n << 252n) + 27742317777372353535851937790883648493n
/** An Ed25519 signature: R, then S as 32 bytes little-endian. */
const ED25519_SIGNATURE_BYTES = 64

const toBig = (bytes: Uint8Array) => bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n)

/**
 * Whether `signature` is spelled the one way Pigeon accepts for `signer`: 64 bytes with S below
 * the group order. False for a signer that isn't a PeerId. Every Crypto refuses anything else
 * before verifying.
 */
export function isCanonicalSignature(signer: PeerId, signature: Uint8Array): boolean {
  if (!parsePeerId(signer).ok) return false
  return signature.length === ED25519_SIGNATURE_BYTES && toBig(signature.slice(32).reverse()) < L
}
