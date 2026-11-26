# 0049: Log entries that say what they are

Device-log and chat entries are signed over bytes that name their kind, and an entry signed before over the bytes without it is still taken.

- Status: accepted
- Date: 2026-11-26

## Context

Every signature should say what it's for, so it can't be taken as something else. Most of what Pigeon signs does: envelopes, letters, invite cards, sealing keys, rekey proposals and Lighthouse replies carry a `v`, and a device log's recovery key and recovers a `type`. Device-log entries and chat entries carried neither. A chat entry was signed over `{ log, author, seq, lamport, at, text }` and a device-log entry over `{ identity, epoch?, seq, prev, kind, device, name?, at }`; only their field names told them apart from each other and from anything Pigeon might sign in future.

Entries already signed can't be signed again. A chat entry is its author's, and the author may be gone; every device-log entry but the last is named by the next one's signed `prev`. They sit in stored chats and logs, export files, link bundles and letters, and keep travelling to new devices and friends. A tab opened before an update keeps running the code it loaded until it's reloaded, so for a while some Pigeons sign the old bytes and check only those.

## Decision

- Entries are signed over `{ v: "pigeon/chat-entry/v1", log, author, seq, lamport, at, text }` and `{ v: "pigeon/device-entry/v1", identity, epoch, seq, prev, kind, device, name?, at }`, named as the other signed objects are. A device-log entry's bytes now carry `epoch` in epoch 0 too, since there's no older shape to match.
- A verifier checks an entry's signature over those bytes and, if that fails, over the bytes from before: the same fields with no `v`, and no `epoch` in epoch 0. Nothing on the entry says which to use: the verifier builds both byte strings itself from the entry's fields.
- That can't pass a new object off as an old one, or one kind as the other. The verifier builds both strings from a fixed set of fields, and canonical JSON gives two different values two different byte strings. Neither older shape has a `v` or a `type`, and everything Pigeon signs now has one, so no signature made now, of any kind, is over an older shape. A chat entry's `v` and a device-log entry's differ, and the two older shapes have different fields. So the fallback only takes what was signed as that kind of entry by a Pigeon from before.
- The older shapes stay accepted for good, since old entries must keep verifying. Anything Pigeon signs in future carries a `v` or `type`, so it can never take one of their shapes.

Ruled out:
- Refusing an older-shape entry after a new one in the same chain, or by the same author. It guards against nothing the bytes don't already rule out, and an old tab, or the site rolled back to a release from before, would sign an entry every updated Pigeon refuses. A device-log chain can't step past an entry it refuses, so that log would stop for good.
- A cutoff by date. `at` is the signer's own word, and old entries must verify after any date.
- Signing the old bytes for one more release and the new ones after, so tabs on the code from before never refuse anything. Until then no new entry would say what it is, which is the point of the change; tabs from before catch up on reload, as with low-S signatures ([0044](0044-low-s-signatures-and-no-new-p256-keys.md)).

## Consequences

Stored chats and device logs, export files, link bundles and letters from before keep verifying, and so do entries signed by a tab still on the code from before. A Pigeon that verifies an entry from before checks two byte strings, one more than before.

A tab still running code from before checks only the old bytes, so until it's reloaded it refuses entries signed now:
- A friend's chat doesn't show new messages. A live sync brings them once it's reloaded; a message that reached it by letter and was receipted comes again only through a live sync.
- Neither a friend's tab nor one of your own devices' tabs takes device-log entries signed now: a device added since isn't heard there, and a device removed since is still trusted there.
