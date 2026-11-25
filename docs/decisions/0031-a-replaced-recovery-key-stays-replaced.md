# 0031: A replaced recovery key stays replaced

Once you know of a later epoch, a conflicting recover for an earlier one is refused, however its signature sorts. The lower signature only decides between two recovers for your latest epoch.

- Status: accepted
- Date: 2026-11-25

## Context

[0027](0027-a-recovery-key-that-outranks-devices.md) settled two recovers for the same epoch on the lower signature, "with everything after it", so every peer would pick the same one. A review found what that does to a key you've already used. Using a key replaces it: epoch 1 names the next key, and epoch 2 is signed by that. But whoever found the old paper could still sign a fresh epoch-1 recover and retry its time until the signature sorted lower, about two tries on average. That would undo epoch 2 and everything after it. Typing an old code into an empty Pigeon could do the same by accident. Rotation revoked nothing, and the next key 0027 promised would replace a leaked one never did.

## Decision

- **What you already know wins.** When two copies of a log disagree on an epoch's recover, and you already hold a later epoch on top of yours, yours stays. The other copy is refused with everything after it.
- **The lower signature still breaks a tie at your latest epoch.** There, both recovers are signed by the key that is still current, and either could be the owner's, so the lower signature wins, as before.
- Epochs that agree work as before: more epochs win, and each shared epoch keeps the longer copy of its chain.

## Consequences

A key is revoked as soon as its replacement is known: on every device and friend that has seen the epoch after it. Someone who saw a forgery from an old key before the real later epoch keeps the forgery only if its signature sorts lower than the real recover of that epoch. Otherwise they move to the real one when it reaches them. So a peer can disagree with the rest about an old key for as long as its signature happens to sort lower, which 0027's rule avoided at the cost of revoking nothing. Rotating your key after a leak is now worth doing, and the sooner the better. An old code typed into an empty Pigeon makes a device nobody accepts, rather than one that takes over.
