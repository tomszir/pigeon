# Protocol

How peers identify themselves, find each other, and exchange messages, letters and pages. Nothing here is implemented yet; this is the design the code will follow.

## Identity

- A peer is a WebCrypto signing keypair (Ed25519, ECDSA P-256 where Ed25519 is missing) plus an ECDH P-256 keypair for sealing. `PeerId` is the base32 public signing key.
- Handles are self-chosen and not unique; petnames are what you call a contact. Pairing shows a 16-hex-character fingerprint to compare.

## Rooms

All traffic goes through the `Transport` interface ([0002](decisions/0002-trystero-behind-a-transport-interface.md)).

- `pair:<hash of both ids>`: one per pair of friends. Chat, buzz, typing, files, letters.
- `page:<owner id>`: one per homepage. Snapshot requests and guestbook entries.
- `lobby`: opt-in public presence.

## Messages

Every message is signed by its sender, carries `v: 1`, and is at most 64 KB (files are chunked). Unsigned, oversized or blocked-sender messages are dropped.

| Type                                               | Room        | Purpose                                                                              |
| -------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| `hello`                                            | any         | id, handle, sealing key, capabilities                                                |
| `presence`                                         | pair, lobby | status and personal message                                                          |
| `log-sync`, `log-entries`                          | pair, page  | catch up on a signed log ([0003](decisions/0003-signed-append-only-logs-not-yjs.md)) |
| `typing`, `buzz`                                   | pair        | ephemeral, never stored                                                              |
| `file-offer`, `file-chunk`, `file-ack`             | pair        | chunked transfer with back-pressure                                                  |
| `letter-offer`, `letter-deliver`, `letter-receipt` | pair        | store and forward                                                                    |
| `page-request`, `page-snapshot`                    | page        | fetch the newest signed snapshot                                                     |

## Logs

Chats and guestbooks are signed append-only logs: each author appends entries with a sequence number and a Lamport timestamp; peers exchange "what I have" summaries and send the missing entries. Merging is a sorted union. Receipts and deletions are entries too.

## Letters

Sealed to the recipient (ephemeral ECDH + AES-GCM), signed by the sender, expiring after 30 days. Carriers (online mutual friends and the Lighthouse) store them opaque, deliver on reconnect, and drop them on a signed receipt. Limits: 50 letters or 20 MB per friend.

## pigeon:// addresses

`pigeon://<name>/<path>`. The name resolves petname → handle seen signed by the Lighthouse directory → raw `PeerId`; ambiguity shows a picker. Explorer joins `page:<owner>`, accepts the highest-versioned snapshot with a valid owner signature, sanitizes it with [PigeonHTML](pigeonhtml.md), and renders it. No answer: the "page not hosted" screen.
