# Spec: the bytes chat and device-log entries are signed over

What each release of Pigeon signs a chat or device-log entry over and what it takes, written from docs/protocol.md and the decision on log entries that say what they are, as the model in `verification/models/signed-entries/` checks it.

## 1. The two forms

An entry's signed bytes are canonical JSON (keys sorted, no spaces) of one of two values, built by the signer and again by every verifier from the entry's own fields. Nothing on the entry says which form it was signed in.

| Kind             | Untyped                                                                          | Typed                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Chat entry       | `{ log, author, seq, lamport, at, text }`                                        | `{ v: "pigeon/chat-entry/v1", log, author, seq, lamport, at, text }`                                   |
| Device-log entry | `{ identity, epoch, seq, prev, kind, device, name?, at }`, no `epoch` in epoch 0 | `{ v: "pigeon/device-entry/v1", identity, epoch, seq, prev, kind, device, name?, at }`, `epoch` always |

Everything else Pigeon signs carries a `v` other than these two, or a `type`.

## 2. Releases

| Release          | Signs   | Takes          |
| ---------------- | ------- | -------------- |
| 0.8.1 and before | untyped | untyped        |
| 0.8.2, 0.8.3     | untyped | untyped, typed |
| 0.8.4 on         | typed   | untyped, typed |

A tab keeps the release it loaded until it reloads. From 0.8.3 a tab reloads into a newer release by itself when nothing would be lost; a tab on 0.8.2 or before stays on its release until someone reloads it.

## 3. State machine

```
  sign(p, e) ──▶ the entry e with p's signature over bytes(e, signs(p))
  deliver(m, p) ──▶ p takes m if some form in takes(p) gives bytes equal to what m's signature is over, and m's signer is the entry's
  reload(p) ──▶ p's release becomes the current one
  forge(m) ──▶ m's signature, put on another entry: of the other kind, or the same kind with any field changed (its kind included)
```

## 4. Invariants

- **E1. Taken from 0.8.2 on.** Every entry the current release signs is taken by every release from 0.8.2 on.
- **E2. Old entries still verify.** Every entry signed untyped, by any release, is taken by the current one.
- **E3. One meaning.** A signature is taken for one entry at most: no release takes it for two different entries, of one kind or of two.
- **E4. No kind swapped.** A typed signature is never taken for an entry of the other kind, or for a device-log entry of another kind (`add`, `remove`, `name`).
- **E5. One encoding per form.** Each entry has exactly one byte string in each form, and reading that string back and writing it again gives the same string.
- **L1. The limit, as it is.** A tab on 0.8.1 or before refuses what the current release signs until it reloads, and takes it after.

## 5. How "one accepted encoding" holds with two forms

An entry has two byte strings a verifier will check, never more, and both are fixed by its fields: the verifier builds them, so a sender can't choose a third. A signature over one is not a signature over the other, since the strings differ (one has a `v`). So each signature is taken for exactly one (entry, form), and two forms only ever mean the same entry, never another (E3, E4). The untyped form can't be retired by date (`at` is the signer's own word) or by position in a chain (an old tab, or a site rolled back to 0.8.2 or 0.8.3, signs untyped, and a chain can't step past an entry it refuses); it is kept for good, and nothing new may take its shape, since everything new carries a `v` or a `type`.
