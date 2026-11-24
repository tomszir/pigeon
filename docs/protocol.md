# Protocol

How peers identify themselves, find each other, and exchange messages, letters and pages. Identity, envelopes, chat logs, pair sessions and pairing are implemented in `@pigeon/core` and run in the browser over Trystero (M2); files, letters and pages are the design the code will follow.

## Identity

- A peer is a WebCrypto signing keypair (Ed25519, ECDSA P-256 where Ed25519 is missing) plus an ECDH P-256 keypair for sealing. `PeerId` is the base32 public signing key.
- The keypair is made on the first visit and kept in IndexedDB; the private key is non-extractable, so not even the page can read it. Clearing site data is a new identity.
- A `PeerId` is 52 base32 characters for an Ed25519 key (32 bytes) or 104 for a raw P-256 point (65 bytes); the length says which. Core never holds keys: it signs through a `Signer` and verifies and hashes through `Crypto`, which the platform implements.
- Handles are self-chosen, not unique, at most 32 characters; petnames are what you call a contact. Pairing shows a 16-hex-character fingerprint (the first 8 bytes of the id's SHA-256, spelled in fours) to compare.
- The sealing (ECDH) keypair is made and announced in `hello` from M4, when letters need it.

## Rooms

All traffic goes through the `Transport` interface ([0002](decisions/0002-trystero-behind-a-transport-interface.md)).

Inside a room the transport names connections (`ConnectionId`); those are not identities. A connection becomes a friend only by sending an envelope signed by that friend's key, starting with `hello`.

- `pair:<hash of both ids>`: one per pair of friends. Chat, buzz, typing, files, letters. The hash is base32 SHA-256 of `pigeon/pair/v1`, then the two ids sorted, newline-separated.
- `invite:<token>`: one per invite link, used once for pairing ([0016](decisions/0016-pairing-through-one-use-invite-rooms.md)).
- `page:<owner id>`: one per homepage. Snapshot requests and guestbook entries.
- `lobby`: opt-in public presence.

## Messages

Every message is an envelope `{ v: 1, from, room, at, body, sig }` in canonical JSON (keys sorted), at most 64 KB (files are chunked). `sig` is `from`'s base32 signature over the envelope without `sig`, so naming the room stops an envelope being replayed into another one. Unsigned, oversized, malformed, wrong-room or blocked-sender messages are dropped, as is anything in a pair room from a key other than the friend's.

| Type                                               | Room        | Purpose                                                                              |
| -------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| `hello`                                            | any         | handle (sealing key and capabilities from M4)                                        |
| `pair-request`, `pair-accept`                      | invite      | the invite handshake: token and handle each way                                      |
| `presence`                                         | pair, lobby | status and personal message                                                          |
| `log-sync`, `log-entries`                          | pair, page  | catch up on a signed log ([0003](decisions/0003-signed-append-only-logs-not-yjs.md)) |
| `typing`, `buzz`                                   | pair        | ephemeral, never stored; typing is resent every 3 s and lapses after 6 s             |
| `bye`                                              | pair        | sent as a tab closes (`pagehide`), signed in advance; otherwise the timeout decides  |
| `file-offer`, `file-chunk`, `file-ack`             | pair        | chunked transfer with back-pressure                                                  |
| `letter-offer`, `letter-deliver`, `letter-receipt` | pair        | store and forward                                                                    |
| `page-request`, `page-snapshot`                    | page        | fetch the newest signed snapshot                                                     |

## Pairing

The inviter makes a 128-bit random token and shares `https://pigeon.tomszir.com/#invite/<id>/<token>/<base32 handle>` as a link or QR code, and waits in `invite:<token>`. The link is kept across reloads until it's used; renaming yourself makes a new one. Opening it takes it out of the address bar. Whoever opens it sees the inviter's handle and fingerprint, joins that room and sends a signed `pair-request` with the token and their handle. The inviter answers the first valid request with `pair-accept` and stops hosting the token. The invitee only accepts a `pair-accept` signed by the id in the link. Both then save each other as friends and meet in their pair room.

## Logs

Chats and guestbooks are signed append-only logs: each author appends entries with a sequence number (1, 2, 3...) and a Lamport timestamp; each entry is signed together with the log's room name. On `hello` peers exchange `log-sync` summaries (per author, the highest sequence held with no gaps) and answer with `log-entries` batches of what the other lacks. Merging is a sorted union by (Lamport, author, sequence); an entry that doesn't verify, or isn't by one of the pair, is dropped, and the first entry seen for a sequence wins. A message is at most 4000 characters. A message written while the friend is offline waits in your log and reaches them the next time you're both online; carrying it while you're apart is what letters (M4) add. Receipts and deletions are entries too.

## Letters

Sealed to the recipient (ephemeral ECDH + AES-GCM), signed by the sender, expiring after 30 days. Carriers (online mutual friends and the Lighthouse) store them opaque, deliver on reconnect, and drop them on a signed receipt. Limits: 50 letters or 20 MB per friend.

## pigeon:// addresses

`pigeon://<name>/<path>`. The name resolves petname → handle seen signed by the Lighthouse directory → raw `PeerId`; ambiguity shows a picker. Explorer joins `page:<owner>`, accepts the highest-versioned snapshot with a valid owner signature, sanitizes it with [PigeonHTML](pigeonhtml.md), and renders it. No answer: the "page not hosted" screen.
