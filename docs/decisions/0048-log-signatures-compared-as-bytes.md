# 0048: Log signatures compared as bytes

Device logs and chat entries compare, chain and order signatures by the bytes they decode to, and a tie between two recovers keeps the order Pigeons have always settled it by.

- Status: accepted
- Date: 2026-11-26

## Context

Device-log entries name the entry before by its signature (`prev`), copies of a log are matched by their signatures, and two recovers for one epoch settle on the lower signature. All of that compared base32 text. Only one spelling of each signature is accepted now (lowercase, no stray bits after the end, low-S), so text gave the same answers as bytes. But a second spelling of a signature once let someone roll a device log back ([0044](0044-low-s-signatures-and-no-new-p256-keys.md)), and the rule is that anything compared is compared as decoded bytes, so a spelling let through later can't change an answer.

The tie between two recovers is the one place where the answer is an order, not equality. Base32 text order isn't byte order: the digits 2 to 7 stand for the highest values but sort before the letters. A Pigeon ordering by raw bytes would settle some ties the other way from a Pigeon still ordering by text, and the two would keep different lists for the same person.

## Decision

- `prev` is decoded and must equal the previous entry's signature bytes exactly, as signed. A `prev` or signature that doesn't decode breaks the chain.
- Copies of an entry or a recover are the same when their signatures decode to the same low-S bytes.
- Two recovers for one epoch are ordered from their decoded low-S bytes, by those bytes' base32 spelling: the order every Pigeon has used, computed from the value rather than from the text it arrived in. How that tie should be settled at all is a separate question, left to its own change.
- The Messenger knows a chat entry by its author and sequence number, which a chat holds one entry for, rather than by its signature's text.

## Consequences

No text of a signature decides anything in a device log or chat, so a spelling let through by some later change can't split a chain or win a tie. Updated Pigeons and Pigeons from before settle every tie the same way. Where the Messenger remembered which Lighthouse brought a message, records kept before are still found by signature.
