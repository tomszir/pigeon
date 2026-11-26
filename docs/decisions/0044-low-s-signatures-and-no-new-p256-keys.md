# 0044: Low-S signatures and no new P-256 keys

A P-256 signature is accepted only in its low-S spelling, Pigeon signs that way, and new identities and devices get Ed25519 keys only.

- Status: accepted
- Date: 2026-11-26

## Context

Pigeon used to make an ECDSA P-256 signing key where the browser's WebCrypto had no Ed25519. An ECDSA signature `(r, s)` has a twin, `(r, n - s)`, that verifies just as well, and anyone holding the signature can make it. WebCrypto accepts both and signs either. Device-log entries chain on the previous entry's signature, and copies were compared by signature, so a friend or a removed device could hand someone the twin of an owner's newest entry first. The owner's next entry then didn't fit that copy, and the copy that disagreed was kept: a removal never arrived, and a removed device stayed on the list.

The standard answer is the low-S rule (s at most n / 2), as Bitcoin (BIP 146) and Ethereum (EIP-2) apply it. Every current browser has Ed25519 in WebCrypto (Chrome and Edge from 137, Firefox from 129, Safari from 17), and Ed25519 has one spelling already: verification refuses an S at or above the group order. But Pigeons before this signed P-256 either way, about half of those signatures are high-S, and they sit in stored device logs and chats and travel to new friends and new devices. Re-signing a device-log entry isn't possible either, because the next entry signs its `prev` as text.

## Decision

- Every `Crypto` refuses a high-S P-256 signature before verifying; the rule lives in core (`isCanonicalSignature`), so the browser and both Lighthouses share it. The browser's signer turns WebCrypto's signature into its low-S spelling.
- New identities and devices are Ed25519. A browser without it is told it's too old to make an identity. P-256 identities made before keep working.
- Device-log copies are compared by signed content and the low-S spelling of the signature, never by the signature's text. A high-S entry is read as its low-S twin only where the next entry's signed `prev` names that spelling, since nobody can change it there. The last entry of each chain, each recover and the recovery commitment must be low-S.
- What a device already keeps is trusted, so the high-S signatures nothing fixes in it are respelled low-S when it's read: device logs on load and in a merge, a link bundle, an export file, an invite request waiting for Add, and the body of a letter the outbox puts again. That's the same signature in its one accepted spelling. Chat entries are sent in their low-S spelling, by sync and by letter. Every device puts its invite links' cards again once, open and closed, until each open link holds a card, since a card carries the device log too and a refused closed card would leave an older open one standing.

## Consequences

The twin can't split a chain, even for an entry signed high-S before the change, and it's refused where it would arrive new. Old logs stay readable and keep travelling, and old messages still reach a device that lacks them.

Some things signed by old code still go wrong, until the tabs involved are reloaded:
- A letter put before the update, with a high-S signature, is refused until the outbox puts it again (after a few days, re-signed and with its body respelled).
- A tab still running old code signs high-S about half the time, and that is refused. A chat entry it mails is refused yet receipted, so it reaches the friend only through a live sync.
- A friend still on old code compares signatures as text. Once an updated owner respells a high-S last entry, that friend doesn't take the owner's later entries until it reloads.

A browser older than Ed25519 support can no longer join, where it could before.
