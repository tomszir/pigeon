// The sealing core needs for mail, as interfaces the platform implements with
// WebCrypto: HPKE (RFC 9180) from a maintained library, and ECDH on P-256, HKDF-SHA256 and
// AES-256-GCM for the older form mail still opens in. Core never holds a private key: a
// device's sealing key is a Sealer, which only says its public half, works out a shared secret
// and opens what HPKE sealed to it. Kept apart from Crypto so the Lighthouses, which seal
// nothing, needn't implement it.

/**
 * HPKE's one suite here, RFC 9180 in base mode: DHKEM(P-256, HKDF-SHA256), HKDF-SHA256 and
 * AES-256-GCM. P-256 so a device's existing sealing key is its HPKE key.
 */
export interface HpkeSealed {
  /** The encapsulated key: a fresh P-256 public key, uncompressed, 65 bytes. */
  readonly enc: Uint8Array
  /** The ciphertext, with its 16-byte tag. */
  readonly sealed: Uint8Array
}

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
  /**
   * HPKE's single-shot seal (see HpkeSealed) of `data` to `peer`'s raw public key, under `info`
   * and with `aad` bound in. Throws when `peer` isn't a point it can use.
   */
  hpkeSeal(
    peer: Uint8Array,
    info: Uint8Array,
    aad: Uint8Array,
    data: Uint8Array,
  ): Promise<HpkeSealed>
}

/** This device's sealing key. The private half stays inside the implementation. */
export interface Sealer {
  /** The raw P-256 public key, 65 bytes. */
  readonly publicKey: Uint8Array
  /** The ECDH secret shared with `peer`'s raw public key, or undefined if it isn't one. */
  share(peer: Uint8Array): Promise<Uint8Array | undefined>
  /**
   * Opens what hpkeSeal sealed to this key under the same `info` and `aad`, or undefined when
   * it wasn't, or anything was changed.
   */
  hpkeOpen(
    enc: Uint8Array,
    info: Uint8Array,
    aad: Uint8Array,
    sealed: Uint8Array,
  ): Promise<Uint8Array | undefined>
}
