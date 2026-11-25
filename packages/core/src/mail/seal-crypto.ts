// The sealing core needs for mail (decision 0037), as interfaces the platform implements with
// WebCrypto: ECDH on P-256, HKDF-SHA256 and AES-256-GCM. Core never holds a private key: a
// device's sealing key is a Sealer, which only says its public half and works out a shared
// secret. Kept apart from Crypto so the Lighthouses, which seal nothing, needn't implement it.

export interface SealCrypto {
  /**
   * A fresh ECDH P-256 key pair used once: its raw public key (65 bytes), and the secret it
   * shares with `peer`'s raw public key. The private half is gone after this.
   */
  ephemeralShare(peer: Uint8Array): Promise<{ publicKey: Uint8Array; shared: Uint8Array }>
  /** HKDF-SHA256 with no salt: `length` bytes from `ikm` for `info`. */
  hkdf(ikm: Uint8Array, info: string, length: number): Promise<Uint8Array>
  /** AES-256-GCM under a 32-byte key with a fresh random nonce: the nonce, then the sealed bytes. */
  seal(key: Uint8Array, data: Uint8Array): Promise<Uint8Array>
  /** Opens what `seal` made, or undefined when the key is wrong or anything was changed. */
  open(key: Uint8Array, sealed: Uint8Array): Promise<Uint8Array | undefined>
  random(length: number): Uint8Array
}

/** This device's sealing key. The private half stays inside the implementation. */
export interface Sealer {
  /** The raw P-256 public key, 65 bytes. */
  readonly publicKey: Uint8Array
  /** The ECDH secret shared with `peer`'s raw public key, or undefined if it isn't one. */
  share(peer: Uint8Array): Promise<Uint8Array | undefined>
}
