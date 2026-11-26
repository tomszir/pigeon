// One spelling per signature. An ECDSA signature (r, s) verifies just as well as (r, n - s), so
// anyone holding one can make a second, different one for the same bytes. Pigeon takes only the
// low-S spelling (s at most n / 2), as Bitcoin and Ethereum do, and signs that way. Ed25519 has
// one spelling when S is below the group order, as RFC 8032 requires; that's checked here too,
// so it doesn't rest on each browser's WebCrypto.
import { type PeerId, parsePeerId } from './identity.ts'

/** The order of P-256's base point. */
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n
const HALF_N = N >> 1n
/** WebCrypto's raw ECDSA P-256 signature: r and s, 32 bytes each, big-endian. */
const P256_SIGNATURE_BYTES = 64
/** The order of Ed25519's base point. */
const L = (1n << 252n) + 27742317777372353535851937790883648493n
/** An Ed25519 signature: R, then S as 32 bytes little-endian. */
const ED25519_SIGNATURE_BYTES = 64

const toBig = (bytes: Uint8Array) => bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n)

function fromBig(value: bigint): Uint8Array {
  const out = new Uint8Array(32)
  for (let at = 31, rest = value; at >= 0; at -= 1, rest >>= 8n) out[at] = Number(rest & 255n)
  return out
}

const kindOf = (signer: PeerId) => {
  const parsed = parsePeerId(signer)
  return parsed.ok ? parsed.value.kind : undefined
}
const isP256 = (signer: PeerId) => kindOf(signer) === 'p256'

/** s of a raw P-256 signature, or undefined when it isn't one. */
const sOf = (signature: Uint8Array) =>
  signature.length === P256_SIGNATURE_BYTES ? toBig(signature.subarray(32)) : undefined

/**
 * Whether `signature` is spelled the one way Pigeon accepts for `signer`'s kind of key: for
 * P-256, raw r || s with r below n and s at most n / 2; for Ed25519, S below the group order.
 * False for a signer that isn't a PeerId. Every Crypto refuses anything else before verifying.
 */
export function isCanonicalSignature(signer: PeerId, signature: Uint8Array): boolean {
  const kind = kindOf(signer)
  if (kind === 'ed25519')
    return signature.length === ED25519_SIGNATURE_BYTES && toBig(signature.slice(32).reverse()) < L
  if (kind !== 'p256' || signature.length !== P256_SIGNATURE_BYTES) return false
  // r is a value mod n too, so r + n would be another spelling if a verifier let it through.
  const r = toBig(signature.subarray(0, 32))
  const s = toBig(signature.subarray(32))
  return r >= 1n && r < N && s >= 1n && s <= HALF_N
}

/**
 * The low-S spelling of a P-256 signature: the same signature, as Pigeon signs and accepts it.
 * Anything else comes back as it is. Used when signing, and to read a high-S signature that
 * a Pigeon from before low-S signed and that can't be swapped where it sits (see device logs).
 */
export function canonicalSignature(signer: PeerId, signature: Uint8Array): Uint8Array {
  if (!isP256(signer)) return signature
  const s = sOf(signature)
  if (s === undefined || s <= HALF_N || s >= N) return signature
  const out = new Uint8Array(signature)
  out.set(fromBig(N - s), 32)
  return out
}
