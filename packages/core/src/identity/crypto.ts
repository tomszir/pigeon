// The cryptography core needs, as interfaces. The web app implements them with WebCrypto in
// platform/crypto; tests use fakeCrypto from testing.ts. Core never touches keys itself.
import type { PeerId } from './peer-id.ts'

export interface Crypto {
  sha256(data: Uint8Array): Promise<Uint8Array>
  /** HMAC-SHA256 of `data` under `key` (32 bytes). Pair rooms are named with it. */
  hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array>
  /**
   * True when `signature` is `signer`'s signature over `data`, spelled the one way Pigeon takes
   * (`isCanonicalSignature`: a high-S P-256 signature is false). Never throws.
   */
  verify(signer: PeerId, signature: Uint8Array, data: Uint8Array): Promise<boolean>
}

/** This peer's signing key. The private half stays inside the implementation. */
export interface Signer {
  // `sign` hands out the canonical spelling (`canonicalSignature`): low-S for P-256.
  readonly id: PeerId
  sign(data: Uint8Array): Promise<Uint8Array>
}
