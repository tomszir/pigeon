# 0016: Pairing through one-use invite rooms

Friends pair by meeting in an `invite:<token>` room named by a random token in the link, not in their pair room.

- Status: superseded by [0018](0018-invite-codes-and-short-links.md) (link format and handshake; the one-use invite rooms stand)
- Date: 2026-11-24

## Context

Two people become friends when one shares a link or QR code. The pair room is a hash of both ids, but the inviter doesn't know the invitee's id until they answer, so it can't wait there. A public room would expose who is pairing with whom, and accepting any `PeerId` that turns up would let a stranger who guessed an id pester its owner.

## Decision

The inviter makes a 128-bit random token, puts its own id, the token and its handle in the link, and waits in `invite:<token>`. The invitee sends a signed `pair-request` with the token; the inviter answers the first valid one with a signed `pair-accept` and stops hosting the token. The invitee checks that the accept is signed by the id in the link, so a relay or third party can't stand in for the inviter. Then both move to their `pair:` room.

## Consequences

Knowing someone's id isn't enough to befriend them; holding a live link is. A link pairs once, so sharing it widely gives one stranger a chance, not many, and the inviter is told who answered. The inviter's tab must be open while the link is used; a link opened later finds no one and says so. `RoomName` gains `invite:${string}`.
