# 0049: Log entries that say what they are

Device-log and chat entries get signed bytes that name their kind, rolled out over two releases: first every Pigeon learns to take them, then entries are signed that way.

- Status: accepted
- Date: 2026-11-26

## Context

Every signature should say what it's for, so it can't be taken as something else. Most of what Pigeon signs does: envelopes, letters, invite cards, sealing keys, rekey proposals and Lighthouse replies carry a `v`, and a device log's recovery key and recovers a `type`. Device-log entries and chat entries carried neither. A chat entry was signed over `{ log, author, seq, lamport, at, text }` and a device-log entry over `{ identity, epoch?, seq, prev, kind, device, name?, at }`; only their field names told them apart from each other and from anything Pigeon might sign in future.

Entries already signed can't be signed again. A chat entry is its author's, and the author may be gone; every device-log entry but the last is named by the next one's signed `prev`. They sit in stored chats and logs, export files, link bundles and letters, and keep travelling to new devices and friends.

A tab opened before an update keeps running the code it loaded until it's reloaded, and checks only the bytes it knows. If updated Pigeons signed the new bytes straight away, such a tab would refuse every entry signed since: a friend's tab wouldn't show new messages, and neither a friend's tab nor one of your own would take a device-log entry, so a device removed since would still be trusted there.

## Decision

- The typed bytes are `{ v: "pigeon/chat-entry/v1", log, author, seq, lamport, at, text }` and `{ v: "pigeon/device-entry/v1", identity, epoch, seq, prev, kind, device, name?, at }`, named as the other signed objects are. A device-log entry's typed bytes carry `epoch` in epoch 0 too.
- A verifier takes an entry signed over its typed bytes or over the untyped ones (the same fields with no `v`, and no `epoch` in epoch 0). Nothing on the entry says which: the verifier builds both byte strings itself from the entry's fields.
- Two releases. In the first, Pigeon takes both forms and still signs the untyped one, so tabs from before take every entry, removals included. In the next, 0.8.3, Pigeon signs the typed form, and tabs from the first release already take it. That second step changes only which bytes `appendMessage` and `appendDeviceEntry` sign.
- Neither form lets a signature made for something else pass as an entry, or one kind of entry as the other. The verifier builds both strings from a fixed set of fields, and canonical JSON gives two different values two different byte strings. Neither untyped shape has a `v` or a `type`, and everything else Pigeon signs has one. A chat entry's `v` and a device-log entry's differ, and the two untyped shapes have different fields.
- The untyped shapes stay accepted for good, since old entries must keep verifying. Anything Pigeon signs in future carries a `v` or `type`, so it can never take one of their shapes.

Ruled out:
- Signing the typed form at once. It would leave tabs from before refusing new entries, removals included, until they're reloaded, for the sake of a collision nobody has found.
- Refusing an untyped entry after a typed one in the same chain, or by the same author. It guards against nothing the bytes don't already rule out, and an old tab, or the site rolled back to an earlier release, would sign an entry every updated Pigeon refuses. A device-log chain can't step past an entry it refuses, so that log would stop for good.
- A cutoff by date. `at` is the signer's own word, and old entries must verify after any date.

## Consequences

Stored chats and device logs, export files, link bundles and letters keep verifying, and every Pigeon, whatever code its tab runs, takes every entry signed in the first release. The untyped bytes are checked first, so an entry signed in the first release costs one verification; a typed one costs two.

Until the second step, new entries still don't say what they are; that rests, as before, on no other signed object having their shape. Once it ships, a tab on code from before the first release refuses entries signed by the second until it's reloaded.
