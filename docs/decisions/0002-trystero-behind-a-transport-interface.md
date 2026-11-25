# 0002: Trystero behind a Transport interface

Peers connect with Trystero (Nostr signaling + WebRTC data channels), and only one platform module knows that.

- Status: accepted
- Date: 2026-11-24

## Context

Pigeon needs browser-to-browser connections with no server of its own. Trystero does signaling over public relays and hands back data channels, which gets two tabs talking fastest. The maintainer may later want to write the signaling layer themselves to explore it.

## Decision

Define a `Transport` interface in `@pigeon/core` (join a room, list peers, send to a peer, receive, peer joined/left). `apps/web/src/platform/transport/` has the one implementation that imports Trystero; the Lighthouse has a Node one. Nothing else imports Trystero. Tests use an in-memory transport.

## Consequences

Swapping in hand-written signaling (raw WebRTC with our own Nostr, BitTorrent-tracker or other rendezvous) is a new implementation of one interface, not a rewrite. Features can only use what the interface offers, so Trystero-specific extras stay out unless the interface grows. Trystero is added at M2, not before.
