// The cryptography core needs, as interfaces. The web app implements them with WebCrypto in
// platform/crypto; tests use fakeCrypto from testing.ts. Core never touches keys itself.
import type { PeerId } from './identity.ts'

export interface Crypto {
  sha256(data: Uint8Array): Promise<Uint8Array>
  /** True when `signature` is `signer`'s signature over `data`. Never throws. */
  verify(signer: PeerId, signature: Uint8Array, data: Uint8Array): Promise<boolean>
}

/** This peer's signing key. The private half stays inside the implementation. */
export interface Signer {
  readonly id: PeerId
  sign(data: Uint8Array): Promise<Uint8Array>
}
