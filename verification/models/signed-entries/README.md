# Model: what log entries are signed over

An executable model of the bytes chat and device-log entries are signed over in each release, of Pigeons on different releases signing entries, handing them to each other and reloading, and of someone putting each signature they see on other entries, written from `verification/specs/signed-entries.md` and the docs, with the conformance check the code must pass.

It is TypeScript run directly by Node 24, using type stripping and no dependencies. Nothing in it is taken from the implementation's code. Each rule is a switch, and a planted defect turns one off.

## Running it

```sh
node --test model/                  # every test, one process (a few seconds)
pnpm exec tsc -p verification/models/signed-entries   # from the repository root
```

## What's in it

- `entries.ts`: the two forms of each kind, built as canonical JSON from an entry's fields; the releases, each by what it signs and what it takes; and a few shapes of what else Pigeon signs.
- `system.ts`: the entries signed and forged (chat entries in two chats; device-log entries of each kind in epoch 0 and epoch 1, as a chain could hold them, and each again with its kind swapped), the invariants, and the state machine: Pigeons on 0.8.1, 0.8.3 and the current release signing entries, handing them to each other and reloading into the current release. Invariants E1 to E5 don't depend on history, so they're checked over every entry signed by every release at once; the states check what each Pigeon took when handed an entry (E1, E2, L1).
- `conformance.ts`: the check the code must pass. For every entry of the domain, the bytes the code signs it over must be the current release's, and for every byte string a signature might be over (each entry's and each forgery's, in each form, and other signed objects) the code must take the signature exactly when the current release does. `packages/core/src/devices/entry-signing.test.ts` runs the code through it.

## Results

Every history up to two entries signed, by three Pigeons on 0.8.1, 0.8.3 and the current release, each reloading once, holds every invariant: 26,285 states, depth 10. The exploration reaches an old tab refusing a current entry, the same tab taking it after reloading, a 0.8.3 tab taking it, and entries signed on old and current releases together.

Every planted defect is caught by the invariant it names:

| Defect                                               | Caught by                   |
| ---------------------------------------------------- | --------------------------- |
| the current release signs a context no release takes | E1 taken from 0.8.2 on      |
| the current release stops taking the untyped form    | E2 old entries still verify |
| a typed device-log entry's bytes leave out its kind  | E4 no kind swapped          |
| a chat entry's bytes leave out its chat              | E3 one meaning              |
