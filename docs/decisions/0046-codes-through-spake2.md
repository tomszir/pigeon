# 0046: Codes through SPAKE2

A typed invite or link code is a public nameplate that picks the room and a password that only feeds SPAKE2, whose key confirms both devices and both ends of the connection; links and QR codes carry a 128-bit secret run the same way, and the inviter approves each invitee.

- Status: accepted
- Date: 2026-11-26

## Context

[0018](0018-invite-codes-and-short-links.md) named the invite room after the whole 40-bit code and assumed a code could only be guessed by trying rooms on the relays one at a time. That doesn't hold. The transport publishes a SHA-256 of each room name on public Nostr relays, so anyone watching can test every live code they collected offline; 2^40 hashes is minutes on one GPU. With no room password, the room name alone also opens the room's offers. The inviter added whoever confirmed first, and nothing tied the signed messages to the WebRTC connection they came over, so someone who swapped the DTLS fingerprints in both offers could sit in the middle with every signature still checking.

Device links ([0024](0024-a-signed-list-of-devices.md)) had the same rooms and a 6-digit check, 20 bits of a hash over the code and both device keys with nothing committed first. Whoever sits in the middle can make new device keys until their check matches the real new device's, about a million tries, and then gets everything a new device is handed.

Codes still have to be typed and read out. A standard password-authenticated key exchange is made for exactly this: a short password, an attacker who can only try one guess per live run, and a key both sides can confirm. Magic Wormhole pairs it with a short public nameplate that says where to meet. The SPAKE2 implementation is RustCrypto's `spake2` crate, the one magic-wormhole.rs uses, built to WebAssembly behind core's `Pake` interface; only the code, a short-lived secret, goes into it.

## Decision

### Codes and links

- **A typed code is 10 base32 characters, shown `K7RT-VP2-BXQ`.** The first 4 (20 bits) are the nameplate, the last 6 (30 bits) the password. Lookalike digits are read as before. A code lives 30 minutes at most and pairs or links once.
- **The nameplate names the room**, `invite/v2:<nameplate>` or `link/v2:<nameplate>`, and is public by design: anyone watching the relays can learn it. The password never leaves the device except through SPAKE2, so the relays hold nothing to test a guess against.
- **A link or QR code carries a 128-bit secret instead of the password**: `#i/<secret><fingerprint>` and `#l/...`, 26 + 13 = 39 characters after the `i/`. The secret goes into SPAKE2 in place of the password, so links and codes run one handshake. The fingerprint still says whose link it is, since anyone the link was sent to knows the secret too.
- **A link meets in a room of its own**, named from a hash of its secret, so nobody without the link can find it, squat in it or see who waits there. The side that made a code waits in both rooms, and each takes only its own kind of secret.
- **The old `invite:` and `link:` rooms are dropped.** Nothing stored refers to them; an invite or link code made before this lasts 30 minutes at most and simply finds nobody.

### The handshake

The side that opens the code is `a` (the invitee, or the new device); the side that made it is `b`. Each connection in the room gets its own run.

1. `a` sends `pake-start`: which secret it uses, `code` or `link`, and its SPAKE2 message.
2. `b` answers `pake-reply` with its own SPAKE2 message. Both now hold a key, the same one only if both used the same password.
3. `a` sends `pake-prove`, its confirmation MAC. `b` checks it before saying anything about itself. A wrong MAC is one wrong try, answered `pake-wrong`.
4. `b` sends `pair-offer` (or `link-offer`): its confirmation MAC, its name, and its device log if it isn't its identity's first device. `a` checks the MAC, and the fingerprint when it came from a link.
5. Once `a` agrees, it sends `pair-request` with its name, its device log, and its device's sealing key. The inviter sees the name, fingerprint and bird and chooses Add or Decline; for a link, the existing device shows the new device's fingerprint, which the new device shows too, and you choose Link.
6. `b` answers `pair-accept` with the pair secret sealed to that sealing key (`pair-decline` if declined), or `link-accept` with the bundle sealed the same way.

The confirmation MACs are HMAC-SHA256 under keys made with HKDF from the SPAKE2 key, one per side (`pigeon/invite/v2/confirm/a`, `/b`, and the same under `pigeon/link/v2/`). Both cover one transcript, canonical JSON: the kind, the room, `code` or `link`, both SPAKE2 messages, both device keys (each the signer of that side's envelopes), and both ends' SHA-256 DTLS fingerprints from the connection itself (`Room.binding`). Every later message must come over that connection from that device, so a relay that swaps fingerprints, or someone who knows the room but not the password, never gets past step 3 or 4. A transport that can't say its fingerprints can't pair.

SPAKE2's identities are `pigeon/invite/v2/a/<room>` and `.../b/<room>` (and `link`), so a run is for one room and one role. The password is `code:<password>` or `link:<secret>` as UTF-8, so a code and a link secret can never stand for each other.

### Wrong tries and approval

- **Five wrong tries close a code.** Each is shown to the inviter as it happens ("someone typed a wrong code"); after the fifth, Pigeon stops the code and makes a new one on request. The count is kept with the code, so a reload doesn't reset it. A guess has a 1 in 2^30 chance, so one code falls to guessing at the inviter with odds of 5 in 2^30, about 1 in 200 million. Two invites that happen to share a nameplate cost each other at most a wrong try, since a Pigeon opening a code runs it with everyone in the room.
- **A run that isn't proven in 30 seconds, or whose connection leaves first, is a wrong try too**, and the side that made a code keeps at most 16 runs going. Without that, someone holding connections open without ever proving would lock the code out without the inviter seeing anything.
- **Wrong tries are counted the moment they're seen**, across both rooms, and once five are used no confirmation still being checked counts, so guesses sent all at once get five, not one per connection.
- **The side opening a code runs it with at most 4 connections at once and 8 in all**, a stalled one giving way after 15 seconds. Whoever answers in place of the inviter is sent a confirmation and can test one guess against it, which the inviter doesn't see; that's the price of making `a` prove first, so the inviter, whose code waits for 30 minutes, never hands out something to test. Someone sitting in a nameplate's room gets at most 8 guesses each time someone types that code, 1 in 2^27.
- **The inviter approves each invitee**, with the name, fingerprint and bird shown, as for Lighthouse invite links ([0038](0038-invite-links-through-lighthouses.md)). Approving one closes the code; declining leaves it open for the right person. Nobody is added on either side before that.
- **Linking shows the new device's fingerprint on both screens** in place of the 6-digit check. It is part of the transcript, so nobody in the middle can choose one to match, and it lets you see that the device asking is the one in your hand rather than someone who saw the code.
- **From a typed link code, the new device shows whose Pigeon answered** and asks only after you check that fingerprint against the one Link a Device shows and choose Continue. Someone who saw the code could otherwise host it as themselves and make your new device one of theirs.
- **The existing device can refuse a request** with Not This Device, which keeps the code open for the right one: requests that came while one was showing wait their turn and show next. Someone who saw a typed code can see the new device's key go by and make keys until one's fingerprint matches at the start and end; only the whole fingerprint tells them apart, so Link a Device shows it whole and in large letters.

### Sealing

`pair-accept`'s pair secret and `link-accept`'s bundle are sealed with `sealMail` to the sealing key in `a`'s `pair-request` or `link-request`, which must be signed by the device that ran the handshake. The letter's kinds are `mail:pair` and `mail:link`, and its body carries a hash of the transcript, so a sealed answer counts only for the run it was made in. The sealed bundle goes in at most 4 parts; a bundle that wouldn't fit is refused before anything changes.

This supersedes [0018](0018-invite-codes-and-short-links.md)'s code format, link format and four-step handshake, and its claim that 40 bits can only be guessed one room at a time; its 30-minute, single-use codes stand. It supersedes [0024](0024-a-signed-list-of-devices.md)'s 6-digit check and its claim that the check stops someone who sees a link code. Lighthouse invite links ([0038](0038-invite-links-through-lighthouses.md)) are unchanged.

## Consequences

Watching the relays gives nothing to crack: the nameplate is public, and each guess at the rest is one live try the inviter sees and that five of close. Someone in the middle of the connection is refused even when they know the code, and someone who only saw a code still needs the inviter to approve them, with their own fingerprint and bird on show. There's no short check left to grind.

Codes are 10 characters instead of 8, and links 39 instead of 21 after `i/`, still one line and one QR code. Pairing takes two more messages over the open connection, a fraction of a second. Anyone who learns a nameplate can join its room and spend the inviter's wrong tries; the cost to the inviter is making a new code. They also see what anyone in a room sees: both sides' IP addresses, unless they connect through the relay only, and both device keys, since each side's first message is signed and goes to everyone in the room. A first device's key is its identity, so they learn who is pairing, as they could before. A link's room can't be found, so none of this applies to links and QR codes. They can spend a typed code's tries while you're still choosing whom to add or link, since other runs go on meanwhile so the right person can still ask; and someone who has the code can hold its 16 run slots with connections that proved it and stay. Both stop that code working, which a new code, or a link, gets round. Someone who stays in nameplate rooms can also stop typed codes from working at all, answering in the inviter's place and saying the code is wrong, and a new code doesn't help, since its nameplate is as public; a link or QR code, whose room can't be found, and invite links through Lighthouses still work. A bundle now has to fit a sealed letter, about 44 KB of friends and blocks, a little less than before.

Pigeons from before this can't pair or link with ones after it: an old Pigeon finds nobody in the new rooms, and the other way round. Keeping the old rooms alongside would keep the hole open, so there is no way through. Pigeon is a web page, so only a tab left open across the update is old, and its codes last 30 minutes at most; a new Pigeon given an old code or link says it came from an older Pigeon and to reload it, rather than that it was mistyped. Friends paired with a typed code or `#i/` link before this keep a pair secret someone in the middle could have read; replacing it over sealed mail is left for a later change.

Ruled out:
- **A longer code alone**, or a slow hash for the room name: the relays still see something to test guesses against offline, and the middle is still open.
- **A short check typed or compared by eye**, made longer: still one more thing people skip, and it doesn't stop the relay in the middle unless it's bound to the connection, which the transcript already is.
- **Pigeon's own key exchange**: SPAKE2 is standard, and the crate is maintained and used for the same job elsewhere.
