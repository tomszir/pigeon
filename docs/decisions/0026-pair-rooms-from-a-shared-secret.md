# 0026: Pair rooms from a shared secret

Friends meet in a room named, and locked, by a secret only the two of them hold, renamed every day, instead of one anyone can compute from their ids.

- Status: accepted
- Date: 2026-11-24

## Context

A pair room is `pair:<hash of both ids>`, and the transport joins it with no Trystero `password`. Without one, Trystero encrypts connection offers with a key hashed from the app id and the room name alone, so anyone who knows two `PeerId`s can compute their room, watch the public Nostr relays for it, read the offers (which carry IP addresses), see when the two are online together, and join the room and be sent `hello` with a handle. Chat content is safe: a pair session only sends it to a connection that has proved it is the friend. Ids are semi-public today (fingerprints, invite links) and M5 makes them fully public (`page:<owner id>`, `pigeon://`), so the leak grows with every milestone. Changing room names means moving every friendship, which only gets more expensive.

## Decision

- Pairing makes a 256-bit random pair secret. The inviter sends it in the signed `pair-accept`, over the invite room's WebRTC channel today and sealed in M7's mailbox once invites go async.
- The pair room is named from the secret, not the ids: `pair:<base32 HMAC-SHA256(secret, "pigeon/pair/v2/" + UTC date)>`, a new name each UTC day. Around midnight (the last and first hour of a day) both rooms are joined, so clocks a little apart still meet.
- The transport joins it with a Trystero `password` derived from the secret (HKDF, `pigeon/pair/password`), so offers can't be read and the room can't be entered without it.
- Existing friends move once: the next time both are online in the old room, the one with the lower id sends a `pair-secret`, the other confirms it, and both switch. A friend who never returns stays on the old room until they do.
- Pigeon asks the browser to keep its storage (`navigator.storage.persist()`) when the identity is made, and on an iPhone tells you in-world to add Pigeon to the Home Screen, where Safari's 7-day storage cap doesn't delete the identity.
- An "Always go through the relay" setting connects through TURN only (`iceTransportPolicy: "relay"`), so friends never learn your IP address.

## Consequences

Knowing two ids no longer says when they meet or from where; relay operators see a different topic each day and can't link a pair's sessions across days; strangers can't join a pair room or learn a handle there. The signaling relays still see the IP address of whoever connects to them, and friends still see yours unless you choose the relay, which is slower and spends TURN quota ([0022](0022-turn-from-a-worker-route.md)). Joining a room costs a PBKDF2 derivation in Trystero, a fraction of a second, once per room per day. Friendships made before this need one more meeting to move. Invite rooms are unchanged: their name is already the secret code.
