// A password-authenticated key exchange: two parties who share a password, perhaps a short one,
// agree on a strong key without anyone watching or answering the exchange learning the password
// or being able to test guesses of it offline. Each guess costs an attacker one live exchange.
//
// The browser's implementation is SPAKE2 on the Ed25519 group from RustCrypto's spake2 crate,
// built to WebAssembly (packages/crypto-wasm); tests use fakePake from testing/.

/**
 * Which side of the exchange this party is. The two parties must take different sides, agreed
 * beforehand (an inviter and the person joining, say), or neither gets a key.
 */
export type PakeRole = 'a' | 'b'

export interface Pake {
  /**
   * Starts one exchange. Both parties must pass the same `password`, `idA` and `idB` (who is A
   * and who is B, in the protocol's own encoding) or their keys differ. They are copied, so the
   * caller may wipe its own password as soon as this returns. The returned start is good for one
   * `finish`; one that won't be finished is `abandon`ed. Throws a TypeError if any input isn't a
   * Uint8Array.
   */
  start(role: PakeRole, password: Uint8Array, idA: Uint8Array, idB: Uint8Array): Promise<PakeStart>
}

export interface PakeStart {
  /** The message to send to the other party. */
  readonly message: Uint8Array
  /**
   * Finishes with the other party's message: the 32-byte key, or undefined when that message is
   * malformed. A wrong password is not an error here; it gives a key the other party doesn't
   * have, which only confirming the key with them shows. Throws if called twice, or after
   * `abandon`, and a TypeError if `peer` isn't a Uint8Array.
   */
  finish(peer: Uint8Array): Promise<Uint8Array | undefined>
  /**
   * Ends an exchange that won't finish (the other party left, or it timed out), wiping what it
   * held now rather than whenever it is garbage collected. Does nothing after `finish`.
   */
  abandon(): void
}

/** Bytes in the key a finished exchange gives. */
export const PAKE_KEY_BYTES = 32
