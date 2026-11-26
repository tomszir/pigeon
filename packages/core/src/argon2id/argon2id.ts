// A memory-hard key derivation for passphrases: Argon2id (RFC 9106) makes each guess at a stolen
// file's passphrase cost memory as well as time, which a GPU has little of per guess.
//
// The browser's implementation is RustCrypto's argon2 crate built to WebAssembly
// (packages/crypto-wasm). The key it gives is short-lived: callers import it into a
// non-extractable key and wipe it.

/** Argon2id's cost parameters, in the units RFC 9106 uses. */
export interface Argon2idParams {
  /** Memory, in KiB. At least 8 per lane. */
  readonly memoryKiB: number
  /** Passes over the memory. At least 1. */
  readonly passes: number
  /** Lanes (degree of parallelism). At least 1. Run one after another, not in parallel. */
  readonly lanes: number
}

export interface Argon2id {
  /**
   * Stretches `passphrase` with `salt` into 32 bytes (Argon2id version 0x13, with no secret or
   * associated data). Inputs are copied, so the caller may wipe its own as soon as this
   * returns. Runs exactly the parameters it is given, so the caller bounds them first. Throws
   * a TypeError if an input isn't a Uint8Array, and a RangeError for a salt under 8 bytes,
   * parameters out of range, or memory the device can't give.
   */
  derive(passphrase: Uint8Array, salt: Uint8Array, params: Argon2idParams): Promise<Uint8Array>
}

/** Bytes in the key `derive` gives. */
export const ARGON2ID_KEY_BYTES = 32
