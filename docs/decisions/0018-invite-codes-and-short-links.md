# 0018: Invite codes and short links

An invite is an 8-character code that lives 30 minutes, shared as typed text or as a short link that also carries the inviter's fingerprint, and the invitee agrees only after seeing who answered.

- Status: accepted; superseded in part by [0046](0046-codes-through-spake2.md): its code and link formats and handshake, and its claim that a code can only be guessed one room at a time
- Date: 2026-11-24

## Context

[0016](0016-pairing-through-one-use-invite-rooms.md)'s links carried the inviter's whole public key, a 128-bit token and the name: about 120 characters, awkward to send from a desktop and hard to scan from a CRT-filtered QR code. People also want to read a code out loud or type it. A short code can't carry a public key, so it can't prove who is at the other end on its own.

## Decision

- The invite is a 40-bit code, 8 base32 characters shown as `K7RT-VP2B`, naming the `invite:<code>` room. It pairs once and stops being hosted 30 minutes after it was made, also across reloads.
- The link is `https://pigeon.tomszir.com/#i/<code><fingerprint>`: the code plus the inviter's 64-bit fingerprint in base32, 23 characters after `#`. The QR code encodes the link.
- The handshake has four steps: the invitee's `pair-request` (code, name), the inviter's `pair-offer` (code, name), the invitee's `pair-confirm` once they have agreed, and the inviter's `pair-accept`. Nobody is added before `pair-confirm`.
- From a link, an offer whose sender's fingerprint doesn't match the link's is refused and the invitee is told someone else answered. From a typed code there is nothing to check against, so the confirm screen warns the invitee to compare the fingerprint with the one on their friend's screen before adding them.

This supersedes 0016's link format and two-step handshake; its one-use invite rooms stand.

## Consequences

Codes can be said, typed and texted, and links fit in a chat message. 40 bits is guessable only by trying codes on the public relays one room at a time, inside a 30-minute window, and a guess still has to be confirmed by the invitee, who sees the name and fingerprint. A link checks the inviter by a 64-bit fingerprint prefix rather than the whole key, which a forger would have to match by brute force. A typed code is only as safe as the fingerprint comparison people actually make. Old `#invite/` links stop working, which was harmless with no one depending on them.
