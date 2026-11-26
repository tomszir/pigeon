// The type of a peer's id, in a file of its own so `crypto.ts` (which names a signer by it) and
// `identity.ts` (which takes a `Crypto`) don't import each other.

/** The base32 public signing key. A string so it can key maps and travel in JSON. */
export type PeerId = string
