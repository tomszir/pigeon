# Protocol

How peers identify themselves, find each other, and exchange messages, letters and pages.

- Identity, envelopes, chat logs, pair sessions and pairing live in `@pigeon/core` and run in the browser over Trystero.
- Mail sealing, the Lighthouse that holds it ([lighthouse.md](lighthouse.md)) and letters are built.
- Files and pages are specified here but not built yet.

## Identity

- A peer is a WebCrypto signing keypair plus an ECDH P-256 keypair for sealing. `PeerId` is the base32 public Ed25519 signing key.
- A browser without Ed25519 (older than Chrome and Edge 137, Firefox 129, Safari 17) is told it's too old to make an identity. Nothing is stored.
- The keypair is made on the first visit and kept in IndexedDB. The private key is non-extractable, so not even the page can read it. Clearing site data is a new identity.
- A `PeerId` is 52 base32 characters: a raw Ed25519 key (32 bytes).
- Core never holds keys. It signs through a `Signer` and verifies and hashes through `Crypto`, which the platform implements.

### Signatures

- Signatures (envelopes, chat and device logs, mail, Lighthouse replies) are lowercase base32 with one spelling:
  - Capitals are refused even when the bytes verify.
  - A last character carrying bits past the end is refused.
  - An Ed25519 signature's S must be below the group order (RFC 8032). Every `Crypto` checks this before verifying.
- Device logs and chat entries compare, chain and order signatures by their decoded bytes, never by text. A tie between two recovers is settled in the order of those bytes' base32 spelling.
- Every signature says what it's for. Its signed bytes carry a `v` naming its kind and version (`pigeon/letter/v1`, `pigeon/sealing-key/v1`, ...), or a `type` for a device log's recovery key and recovers. Nothing signed for one purpose verifies as another.
- Device-log entries are signed with `v: "pigeon/device-entry/v1"` (with `epoch`, even in epoch 0). Chat entries use `v: "pigeon/chat-entry/v1"` (see Logs). Only the typed form is taken: the verifier builds the bytes itself from the entry's fields.
- Signed fields are frozen per `v`:
  - Device-log entry: exactly `identity`, `epoch`, `seq`, `prev`, `kind`, `device`, `name`, `at` (and `v`).
  - Chat entry: `log`, `author`, `seq`, `lamport`, `at`, `text` (and `v`).
  - A new signed field fails on every released Pigeon. A field left unsigned can be stripped by any relay.
  - So a new form needs a new `v`, taken by a released Pigeon before any Pigeon signs it (the typed form was taken from 0.8.2 and signed from 0.8.4).

### Names and pictures

- Handles are self-chosen, not unique, at most 32 characters.
- A name may not hold control characters (line breaks included), line or paragraph separators, or text-reordering marks (U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069).
- A name arriving with them (`hello`, profile, pairing, device link, your devices' mail, invite) has them stripped once its signature is checked:
  - Nothing left: shown as "Friend", for a live or a saved friend's name.
  - An invite or profile change naming nobody is refused.
  - Your own saved name with nothing left is asked for again.
  - Stripping instead of refusing keeps people reachable whose older Pigeon let such a name through. Stored names, friends' names and petnames are shown stripped too.
- Petnames are what you call a contact.
- Pairing shows a 16-hex-character fingerprint to compare: the first 8 bytes of the id's SHA-256, spelled in fours.
- Everyone's picture is a pixel pigeon drawn from their id ([design.md](design.md#avatars)). `hello` names the drawing version, so a newer version never changes an existing bird.

### Sealing keys

- Each device has a sealing (ECDH P-256) keypair, so mail, invites and letters can be sealed to devices. HPKE (RFC 9180) is used for a device that says it opens it.
- `hello` carries the key as `sealing`, signed by the device. A friend takes it only from that same device.
- `@pigeon/core` seals and opens mail.

## Devices

One person can use Pigeon on several devices.

- Each device has its own non-extractable key. An identity is a device log (`devices/device-log.ts`).
- The first device's key starts the log and stays the identity's `PeerId`, so friends, fingerprints and avatars never change. It's on the list without an entry.

### The device log

- One device writes the log at a time: the first device, until a recovery key names another.
- Entries are `{ seq, prev, kind, device, name?, at, sig }`, signed by the writer over `{ v: "pigeon/device-entry/v1", identity, epoch, seq, prev, kind, device, name?, at }`. `prev` names the signature of the entry before.

| Kind     | Effect                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------- |
| `add`    | puts a device on, named                                                                            |
| `remove` | takes one off for good within its epoch: its key can't be added again; the writer can't be removed |
| `name`   | renames one                                                                                        |

- With one writer each epoch is a single chain:
  - A copy further along replaces a shorter one.
  - A copy that disagrees on an entry both have is ignored.
  - Two copies of an entry agree when their signed content and signature bytes match.
- At most 100 entries across all epochs. When a merge would hold more, the oldest epochs lose their last entries first. The current epoch is never cut.
- No other device can change the list, so a stolen second device can do nothing to it.

### Recovery

- A recovery key outranks every device. It's an Ed25519 key whose public half the first device commits to once as `recovery: { key, at, sig }`, signed over `{ identity, type: "recovery-key", key, at }`.
- Where two copies name different keys, the one you had first stays.
- Committing a key also signs a `name` entry for the first device, so an older Pigeon (which takes a log only when it has more entries, then keeps it whole) keeps the commitment too.
- A recovery is an item of `epochs`: `{ recover, entries }`.
  - `recover` is `{ epoch, writer, keep: [{ device, name }], next, at, sig }`, signed over `{ identity, type: "recover", ... }` by the key current before it (`recovery.key` for epoch 1, the previous `next` after).
  - `keep` (up to 8 devices, the writer among them) is the list from then on. Every other device is removed as of its `at`.
  - The writer signs that epoch's entries.
- Each epoch stands on its own:
  - Its recover's signature and its own chain decide whether it holds.
  - The list comes from the latest epoch alone.
  - An older epoch's entries only say who was once yours and until when. A stolen device writing more of them after a recovery changes nothing and can't make a log fail.
- Settling copies:
  - Disagreeing on an epoch's recover: the one you hold stays if you hold a later epoch on top of it, so a used and replaced key can't restart its epoch.
  - At your latest epoch the lower signature wins, with everything after it.
  - Copies that agree take the one with more epochs. Within an epoch the longer copy of the same chain wins.
- Epoch 0's entries and bytes are unchanged, so older Pigeons read them and ignore `recovery` and `epochs`.
- A log holds up to 8 epochs.

### Recovered devices

- A recovered device's log is a tail: `from` is its first epoch, `by` the key that signed its recover, with nothing before.
- Only a Pigeon that already has your earlier epochs takes a tail, by checking it follows on from them.
- The tail's own device takes a whole log only if that log's key for its first epoch is `by`.
- Pairing checks whoever answers against the log you keep for them (loaded from storage if needed). That refuses:
  - a tail from anyone you don't know
  - an old copy that would undo a recovery you've seen
  - a device (a stolen first device, say) speaking for itself when your copy says a recovery took it off
- A friend who keeps a log with epochs sends it back to its owner in their pair room. A recovered device gets its whole log from the first friend it pairs with again.
- That friend already knows them, so re-pairing keeps the chat and petname, takes the new pair secret and moves to its rooms.

### Devices in pair rooms

- Envelopes and chat entries are signed by a device.
- A friend takes envelopes from any device active on your log. Chat log authors are devices, so sequence numbers never collide. Presence shows the newest sent.
- A removed device's entries from before its removal (by its own `at`) still count, so a later-linked device catches up with no gaps. Nothing later is taken from it.
- A device that finds itself removed stops talking.
- Your own devices in the same pair room catch the chat up with each other (`log-sync`, `log-entries`) but aren't the friend.
- An identity with a log sends `device-log` before `hello`, in every pair room and whenever it changes. Friends keep it under `devices:<id>`.
- `hello` carries `devices: true`. A friend without it is on a Pigeon from before device logs: it hears only your first device, and a second device's chat says so until they update.

### Copied profiles

- A copied browser profile holds the same device key as the original.
- Every `hello` carries `instance`: 10 random bytes in base32, made each time the Messenger starts.
- A device that hears a hello signed by its own key, bound to its connection, with another `instance` knows it's open in another browser too.
- Only one tab per browser runs the Messenger, so a second tab is never mistaken for a copy.

### Linking

Linking is in person, from the device that writes your list (the first device, unless a recovery named another).

- The writer hosts a live code (see Live codes) in `link/v2:<nameplate>` and the link's own room for 10 minutes. It shows it in letters and as `#l/<secret><fingerprint>` in a QR code, with this Pigeon's fingerprint.
- The new device must have no friends or devices of its own. A Pigeon that has them can leave first, telling its friends and forgetting everything.
- From a link, the new device first asks you to choose Link, since anyone can send one. It then runs the live-code handshake.
- `link-offer` carries the key confirmation and whose it is (plus its device log, if not the first device).
  - From a link: an offer whose fingerprint isn't the link's is refused.
  - From a typed code: the new device shows the identity's fingerprint to compare with Link a Device's, and asks only after Continue.
- `link-request` carries the new device's sealing key, which must be a key mail can be sealed to.
- Both sides then show the new device's fingerprint (covered by the handshake), so the device asking is the one in your hand. Not This Device refuses it and leaves the code open.
- A code with a request showing at its 10 minutes ends when that request is answered or goes.
- Confirming signs `add` and sends `link-accept` with a bundle sealed to that key:
  - Refused beforehand, with nothing signed, when it wouldn't fit one sealed letter (44 KB).
  - Nothing is signed for a device that has already left. One that leaves after the `add` stays on the list, to be handed everything if linked again or removed in My Devices (a removal is final).
  - The bundle holds the identity, device log, self secret, profile, friends (with pair secrets), blocked list and friends' device logs. Chats catch up through pair rooms.
- The new device keeps it all and restarts as that identity.
  - It reads friends one by one, held to the import rules. A record it can't read (from a newer Pigeon, say) or with a name or petname over 32 characters is kept aside and counted.
  - Every other friend comes through with only the fields described here.
- After linking:
  - Device log, name and personal message stay in sync through the self room and the self mailbox.
  - The Lighthouse list stays in sync through the self mailbox.
  - The rest of your own data syncs through the shared log (see Your shared log).

### The self room

- Your devices meet in `self:<base32 HMAC-SHA256(self secret, "pigeon/self/v1/" + UTC date)>`, locked with HKDF of the self secret (info `pigeon/self/password`) and renamed daily like pair rooms.
- Device logs travel there, so a removal reaches your other devices with no friend online.
- `profile` travels there too: your name and personal message with when they last changed. A device takes one newer than its own.
- A device that finds itself removed stops talking and says so.

### The self mailbox

- A `mail:self` letter carries the same to an offline device:
  - sealed to each of your other devices still on the list
  - under the self secret's tags
  - at every Lighthouse on this device's list and on the list your other devices last said in the self room
- Body: a snapshot `{ log, keys, profile?, lighthouses?, invites?, reads? }`.

| Field         | Holds                                                                                 |
| ------------- | ------------------------------------------------------------------------------------- |
| `log`         | your device log                                                                       |
| `keys`        | the sealing keys this device knows for your devices, its own included                 |
| `profile`     | your name, with when it last changed                                                  |
| `lighthouses` | your Lighthouse list, `{ list, changedAt }`                                           |
| `invites`     | the invite links this device made (see Invite links)                                  |
| `reads`       | the kinds of mail this device reads beyond the baseline (`sync`, see Your shared log) |

- Sent when a change is made on this device (list, a device's name, recovery key, a link, your name, your Lighthouses) and when a device's sealing key is first heard, so a device linked while another was away can be written to.
- A new snapshot replaces an older one still waiting on the same devices. An away device has one snapshot waiting, not one per change.
- Fetching:
  - A device opens everything at all its Lighthouses before acting on any of it.
  - It merges every `mail:self` letter's device log first, whoever sent it, since a log is signed by its writer.
  - The rest of a letter counts only from a device on the resulting list, so a removal counts whichever letter was listed first.
  - Each key counts only when signed by its own device and that device is on the list.
  - Name and Lighthouse list are taken when newer than this device's own and no more than a day ahead of its clock.
- A Lighthouse list kept from before devices shared theirs counts as changed on first start, and is sent then.
- A device a removal or recovery takes off the list gets a letter holding only the device log, so it stops talking even if it never meets another of your devices.

## Your data in a file

Export My Data writes a `.txt` whose sealed line is `pigeon-sealed:v2:<memory>:<passes>:<lanes>:<salt>:<iv>:<sealed>`.

- `memory`, `passes`, `lanes`: plain decimal (no sign, spaces or leading zero).
- `salt`, `iv`, `sealed`: base64, standard alphabet, padded, spelled exactly as Pigeon writes it. Any other spelling of the same bytes is refused.
- Key: Argon2id (RFC 9106, version 0x13, 32-byte output, no secret or associated data) of the passphrase (UTF-8 after NFC) and the 16-byte salt, with `memory` KiB, `passes` passes and `lanes` lanes.
- Pigeon writes 65,536 KiB (64 MiB), 3 passes, 4 lanes: RFC 9106's second recommended option, about a second on a phone.
- `sealed` is AES-256-GCM under that key with a 12-byte `iv` and 16-byte tag, nothing else authenticated. Any change to the parameters or salt gives another key.
- A reader refuses a line before deriving anything when:
  - `memory` is over 131,072 KiB (128 MiB) or under 8 KiB per lane
  - `passes` is over 6, `lanes` is over 4, or any count is 0
  - the salt isn't 16 bytes or the `iv` isn't 12
  - the line has any other number of fields
- The recovery key's file holds the same line, with the recovery code as its data.

### Contents

- Canonical JSON `{ kind: "pigeon-export", v: 1, at, self, profile, friends, blocked, friendDevices, logs, settings }`. `logs` maps each friend to their chat log as stored.
- It holds each friend's pair secret. Whoever has the file and passphrase can enter your pair rooms and fetch sealed mail under your tags. They learn when a friend is online, their name, profile, devices and IP address (unless relay-only), but without a device key can't read or send messages.
- It holds no private keys, and not your own device log or self secret.

### Import

- Held to what live input holds:
  - A handle, petname or blocked name over 32 characters makes the whole file unreadable.
  - A profile whose name isn't one you could choose (1 to 32 characters, none a name may not hold), or whose message is over 120 characters, is not taken.
  - Characters a name may not hold in a friend's name are stripped when shown.
  - Only the fields described here are kept. Any other key in a friend, block, profile or settings is dropped.
- Refuses a file whose `self` isn't this device's identity.
- Merges each chat's entries with the same checks a catch-up uses.
- Adds friends and blocks this device lacks, keeping its own where both have one.
- Takes the profile and settings only on a device with no name yet, then restarts the Messenger.

## Your shared log

Your devices keep the changes you make on any of them in a shared log (`shared-log/`). Each device appends signed entries of its own and passes every device what it lacks, so all hold the same entries and derive the same view, whatever the arrival order.

### Entries

- An entry is `{ v: "pigeon/your-data/v1", identity, device, n, stamp, kind, ...fields, sig }`:
  - `identity`: whose log. `device`: the writer. `n`: its number among that device's entries, from 1.
  - `sig`: the device's signature over the canonical JSON of everything but `sig`. Kind, log, device and number are all signed, so it can't pass as anything else Pigeon signs.
- At most 1 KB. Each device's entries are numbered up to 10,000. Past either, an entry is refused and not passed on.
- An entry counts only from a device that is or was on your device log. Any other key is refused.

| Kind      | Fields                    | Meaning                                                                                                                                                          |
| --------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add`     | `{ friend, inc, name? }`  | begins a friendship. `inc` is 16 random bytes in base32 naming it from pairing to its end. `name` is the friend's name then, for a device that doesn't hold them |
| `tomb`    | `{ friend, inc }`         | ends that friendship for good                                                                                                                                    |
| `pet`     | `{ friend, name }`        | petname. An empty name goes back to theirs                                                                                                                       |
| `mute`    | `{ friend, until }`       | a time, `-1` for until you unmute, or `null`                                                                                                                     |
| `block`   | `{ friend, on, name? }`   | block or unblock                                                                                                                                                 |
| `setting` | `{ key: "relay", value }` | relay-only                                                                                                                                                       |

- A known kind with any other field, or a field that doesn't hold, is unreadable.
- A kind is known only when it is one of these names exactly. Names like `constructor` or `__proto__` read as unknown.
- Every name another device controls (device ids in a summary, friend and incarnation ids, setting keys) is read by own keys only, never through inherited object properties.
- An entry of a kind a device can't read (from a newer Pigeon) is still checked, kept and passed on, and skipped when building the view.

### Stamps

- A new entry's stamp is later than the device's clock and every counting entry about the same friend or setting, so a change made after seeing another beats it.
- An entry that doesn't count (a removed device's from its removal on, or one above the cap) never raises a stamp.
- A stamp only orders. It's never refused for being ahead of the receiving clock, and no clock follows it.
- Cap: 2^53 − 2^32. An entry stamped above it is kept, passed on and counted in summaries (so never sent again) but counts for nothing. A device's own stamps stop at it.

### The view

- A friendship is live from its `add` until a `tomb` names it. Nothing brings it back. Only pairing again makes a new one.
- Petname, mute, block and the setting each take the entry with the highest stamp, then device, then number.
- A block hides every friendship added at or before it.
- Of two live friendships with one friend, the newer `add` shows.
- Two entries under one number (only their signer can make that): every device keeps the one with the lower decoded signature bytes.

### Removed devices

- Entries stamped at or after a device's removal count for nothing on a device that knows of the removal.
- They're measured against the removal's `at` in the device log:
  - The remover (the epoch's writer, or the writer a recovery named) signs the `remove`, or the `recover` leaving it off, with an `at` later than its clock and every counting entry it holds from that device. What the device had already delivered keeps counting however fast its clock ran.
  - An entry above the cap doesn't count. The `at` never goes past the cap, so a device stamping at the top of the safe integers can still be removed.
  - No device-log entry is signed at a time that isn't a safe integer.
- The threshold is in the device log, so it reaches your devices and friends with the removal. A removal's `at` can be later than when it was made.
- A device on the latest epoch's list is never discounted.
- What a removed device stamped before is its own word, as a chat entry's time is.

### Sync

- A summary carries, per device, the highest number held and a digest of every entry held from it, gaps included (a device can sign numbers out of order or skip some). The digest is SHA-256 of the canonical JSON array of their base32 signatures, in number order.
- Comparing a summary per device:
  - Entries up to the other's highest match its digest: send only those above it.
  - They differ (two under one number, or a gap one side filled): send all of that device's entries.
  - This side is ahead: the other side checks that range itself.
  - Two devices holding the same entries send each other nothing.

#### In the self room

- On a connection proven by another of your devices, each side sends `sync-summary` `{ summary }` after its hello and whenever its log changes.
- It answers a summary with `sync-entries` `{ entries }` (what the other lacks, at most 48 a message), and with its own `sync-summary` when the other holds something it lacks.

#### In the self mailbox

- A `mail:sync` letter is `{ log, summary, entries, pad }`:
  - `log`: the sender's device log. `summary`: its summary.
  - `entries`: up to 200 entries its recipients aren't known to hold, each device's in turn (your devices on the list first), so one device's entries never crowd out the rest.
  - `pad`: spaces bringing its JSON to 4, 16 or 40 KB.
- Sent 5 seconds after the last change (a stored `sync-owed` mark keeps it owed across a reload until queued), and after a mail check that took something.
- Sealed to your other active devices on the list, when one lacks an entry no earlier letter carried to it, or this device's summary has news for one not known to hold the same.
- A page too big for one letter goes on in the next.
- No letter replaces another. Each carries only what earlier ones didn't, and the outbox puts each again until taken.
- What earlier letters carried is recomputed only when a device's summary holds less than its last.
- A device whose summary is behind a letter's summary answers with its own summary.
- The opener merges the letter's device log first (with every other log the fetch brought) and takes the rest only if `from` is on the resulting list.
- Each entry is read on its own. One that doesn't hold never stops the rest.

## Rooms

- All traffic goes through the `Transport` interface. Messages to one peer arrive in send order, whatever their size.
- Inside a room the transport names connections (`ConnectionId`), which are not identities. A connection becomes a friend only by sending an envelope signed by that friend's key, starting with `hello`.

### Channel binding

- `binding(peer)` gives `{ local, remote }`: SHA-256 certificate fingerprints, lowercase hex, no colons.
  - `local`: from this side's own description's `a=fingerprint`.
  - `remote`: SHA-256 of the certificate the data channel's DTLS transport checked (`getRemoteCertificates()`), not the remote description. A peer can send a new description after the handshake that some browsers show as current while the old channel runs on.
- `binding` is nothing (the connection can't be bound) when:
  - there's no direct peer connection (a peer carried through other peers)
  - the channel isn't connected
  - the browser can't say which certificate DTLS checked
  - a description names anything but exactly one certificate (any non-`sha-256` `a=fingerprint` line, or two different ones)
  - the remote description names another certificate than DTLS checked
- Whoever writes into the channel holds the key of the certificate DTLS checked.

### Proving a connection

In pair and self rooms a connection counts as a device only once that device has signed its channel.

- On every new connection each side sends its device logs, then `nonce` (16 random bytes in base32).
- A side answers each nonce signed by a key it takes there (the friend's devices, your own, or its own key) once, at most 8 per connection, since a peer reconnecting with its id greets again.
- The answer is `hello` with `binding: { nonce, local, remote }`, fingerprints as the sender sees them, its own first.
- The receiver takes it only when the nonce is the one it sent on that connection and the fingerprints are its own view swapped, compared as bytes.
- A hello forwarded or replayed from another connection names another channel and is ignored.
- Everything else counts only on a proven connection and only from the device that proved it, so a replay has no connection to count on.
- Presence, profile and `log-sync` go to a connection once it's proven. Nothing more goes once it has left, not even what was queued.
- What it sent before leaving still counts when read later (last messages, an `unfriend`), its hello included. But nothing that would answer it or change who it is (`bye`, `log-sync`) counts, nor anything sent under its id afterwards.
- A Pigeon from before binding sends unbound hellos and never answers a nonce. The two show each other offline and meet only through Lighthouses (letters, farewells, the self mailbox) until it updates.
- A friend with an updated device online gets no letters, so their not-yet-updated devices catch up once updated.

### Room names

- `pair:<base32 HMAC-SHA256(secret, "pigeon/pair/v2/" + UTC date)>`: where two friends meet.
  - Named from the 256-bit pair secret only they hold, new each UTC day (`2026-11-24`). Knowing their ids says nothing.
  - Carries chat, buzz, typing, files, letters.
  - Joined with a Trystero password: base32 HKDF-SHA256 of the secret (no salt, info `pigeon/pair/password`, 32 bytes). Offers can't be read and the room can't be entered without it.
  - In the last hour of a UTC day tomorrow's room is joined too, and in the first hour yesterday's, so clocks less than an hour apart still meet. One pair session spans the rooms (`pairing/pair-rooms.ts`).
- `pair:<hash of both ids>`: base32 SHA-256 of `pigeon/pair/v1`, then the two ids sorted, newline-separated. Anyone knowing both ids can compute it, so it's never joined. It is the chat's id: pair envelopes and chat entries are signed for it in every pair room.
- `self:<daily name>`: where your own devices meet, from the self secret (see The self room).
- While a secret is replaced, the old secret's pair or self rooms too, until the other side is seen holding the new one (see Replacing a secret).
- `link/v2:<nameplate>` and `link/v2:<hash of the link's secret>`: one pair per device-link code, used once (see Linking and Live codes).
- `invite/v2:<nameplate>` and `invite/v2:<hash of the link's secret>`: one pair per live invite code, used once (see Live codes).
- `page:<owner id>`: one per homepage. Snapshot requests and guestbook entries.
- `lobby`: opt-in public presence.

## Messages

- Every message is an envelope `{ v: 1, from, room, at, body, sig }` in canonical JSON (keys sorted), at most 64 KB (files are chunked).
- `sig` is `from`'s base32 signature over the envelope without `sig`. Naming the room stops replay into another room.
- In pair and self rooms a bound `hello` ties a connection to its device, which stops replay on another connection.
- In pair rooms `room` is the chat's id whichever daily room carried it, so a friend in two rooms sends the same envelope to both. `buzz` and `unfriend` are taken once.
- Dropped: unsigned, oversized, malformed, wrong-room, blocked-sender, and anything in a pair room from a key other than the friend's.

| Type                                                        | Room         | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hello`                                                     | any          | handle; `avatar` (drawing version, 1 when left out); `devices: true` from a Pigeon that knows device logs; `instance`, this run's random id; `sealing`, this device's bound sealing key (taken only from the device it names); `lighthouses`, up to 4 addresses where friends leave this Pigeon's mail. Sent again after a rename (a later `hello`'s handle is your new name). Unknown fields are left out and ignored. In pair and self rooms, `binding` (the nonce it answers and the channel's fingerprints), without which it counts for nothing there |
| `nonce`                                                     | pair, self   | 16 random bytes, sent first on every new connection, which the other side's `hello` must sign with the channel's fingerprints                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `device-log`                                                | pair, self   | your device log, before `hello` and whenever it changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `pake-start`, `pake-reply`, `pake-prove`, `pake-wrong`      | invite, link | a live code's handshake: both SPAKE2 messages, the opener's key confirmation, and "wrong" when it doesn't hold                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `link-offer`, `link-request`, `link-accept`                 | link         | linking a new device: whose it is (with its key confirmation), the new device's sealing key, then the bundle sealed to it, in at most 4 parts                                                                                                                                                                                                                                                                                                                                                                                                              |
| `pair-offer`, `pair-request`, `pair-accept`, `pair-decline` | invite       | the invite: who the inviter is (with its key confirmation), who asks and their sealing key, then the pair secret sealed to it, or no                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `presence`                                                  | pair, lobby  | status and personal message                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `profile`                                                   | self         | your name, personal message and `changedAt`; the newest wins on your devices                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `log-sync`, `log-entries`                                   | pair, page   | catch up on a signed log                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `typing`, `buzz`                                            | pair         | ephemeral, never stored; typing is resent every 3 s and lapses after 6 s                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `bye`                                                       | pair         | sent as a tab closes (`pagehide`), signed in advance; otherwise the timeout decides                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `unfriend`                                                  | pair         | you removed them; resent until delivered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `file-offer`, `file-chunk`, `file-ack`                      | pair         | chunked transfer with back-pressure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `letter-offer`, `letter-deliver`, `letter-receipt`          | pair         | store and forward                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `page-request`, `page-snapshot`                             | page         | fetch the newest signed snapshot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Pairing

An invite is either a live code or an invite link through Lighthouses. A live code pairs once and is hosted for 30 minutes, across reloads too.

### Live codes

Invite codes and device-link codes work the same way.

#### Codes and links

- A code is 10 base32 characters, shown `K7RT-VP2-BXQ`: 4 nameplate characters, then a 6-character password.
- The nameplate names the room (`invite/v2:<nameplate>` or `link/v2:<nameplate>`) and is public: relays see room names.
- The password only goes into SPAKE2, so nothing relays see can test a guess.
- Typing accepts either case, with or without dashes, and reads 0, 1 and 8 as o, l and b.
- A code is also a link, `https://pigeon.tomszir.com/#i/<secret><fingerprint>` (`#l/` for a device link): a random 16-byte secret in base32 replacing the password, then the maker identity's 8-byte fingerprint. 39 characters after `i/`.
- A link meets in a room of its own: `invite/v2:` (or `link/v2:`) plus the first 16 bytes, in base32, of SHA-256 of `pigeon/invite/v2/room/<secret>` (`pigeon/link/v2/room/...`). Nobody without the link can find it.
- The maker waits in both rooms, each taking only its own kind of secret.
- The QR code is the link. Opening a link takes it out of the address bar.

#### Handshake

- The opener (`a`) and the maker (`b`) run SPAKE2 (RustCrypto's `spake2` crate, Ed25519 group, built to WebAssembly) on each connection in the room.
  - Password: `code:<password>` or `link:<secret>` as UTF-8.
  - Identities: `pigeon/invite/v2/a/<room>` and `pigeon/invite/v2/b/<room>` (`pigeon/link/v2/...` for device links).
- `a` sends `pake-start` (`via`: `code` or `link`, plus its message). `b` answers `pake-reply`. Both derive a key.
- Each side's confirmation is HMAC-SHA256 under HKDF-SHA256 of that key (info `pigeon/invite/v2/confirm/a` or `/b`) over the canonical JSON transcript `{ v: "pigeon/invite/v2", room, via, a, b, aDevice, bDevice, aDtls, bDtls }`:
  - `a`, `b`: both SPAKE2 messages in base64
  - `aDevice`, `bDevice`: both device keys (each the signer of that side's envelopes)
  - `aDtls`, `bDtls`: both DTLS fingerprints from `binding(peer)`
- `a` sends its confirmation in `pake-prove`. `b` checks it first.
- Wrong tries, answered `pake-wrong`:
  - a confirmation that doesn't hold
  - a run not proven within 30 seconds
  - a run whose connection leaves before proving
- Five wrong tries stop the code, counted across both rooms and across reloads. Once used, no confirmation that came at the same time is checked.
- Limits:
  - `b` keeps at most 16 runs at once per room.
  - `a` runs at most 4 at once and 8 in all per opening, a stalled run giving way after 15 seconds, since whoever answers `a` can test one guess against its confirmation.
- `pake-wrong` proves nothing, so a Pigeon receiving it says the one that answered calls the code wrong.
- `b`'s confirmation comes in its offer.
- A relay in the middle shows each side its own certificate, so the transcripts differ and neither confirmation holds. Every later message must come over the same connection, signed by the same device.
- A transport that can't report a connection's fingerprints can't run it.

#### Offer, request, accept

- `pair-offer` carries the inviter's confirmation and name. From a non-first device it also carries `identity` and its device log, so the friend is saved as the identity and the fingerprint shown (and checked against a link's) is the identity's.
- The invitee is shown the name and fingerprint:
  - From a link: an offer whose fingerprint doesn't match the link's is refused.
  - From a typed code: they're warned to compare it with their friend's screen.
- Only after Ask to Be Friends does `pair-request` go back: their name, device log and device sealing key, signed by that device.
- The inviter sees each request in Add a Friend (name, fingerprint, bird, and a balloon when Add a Friend isn't in front) and chooses Add or Decline.
- Add:
  - makes a 32-byte pair secret
  - answers `pair-accept`: a `mail:pair` letter sealed to that sealing key, body `{ session, value }`, `session` being the transcript's SHA-256 in hex and `value` the secret, so it counts only on that connection
  - stops hosting the code
- Decline answers `pair-decline` and leaves the code open.
- Both save each other as friends with the secret and meet only in the secret's rooms, never the room named from their ids.
- Pigeons from before SPAKE2 live codes can't pair or link with current ones: they meet in other rooms. A current Pigeon recognises an older 8-character code, or its 21-character `#i/` or `#l/` link, and says to have the other side reload for a new code. Anything else that doesn't read as a code is refused.

#### Relay only

- All rooms, pair and invite alike, can go through the TURN relay only (File, Always Go Through the Relay in the Messenger, or Connection in Settings; `iceTransportPolicy: "relay"`). Friends never see your IP address. It's slower and needs the relay reachable.
- With it on, mail goes only to Lighthouses you chose (see Lighthouses you didn't choose), since a friend's own Lighthouse would see the IP the relay hides.
- Toggling rejoins every room Pigeon hosts under the new setting: friends', the code you host, your devices' room, and a device link being shown (which gets a new code).
- A device link already answered is left to finish. An invite or link you're opening keeps the setting it opened with until it ends.
- It fails closed: with no relay, Pigeon doesn't fall back to direct. A balloon (at most once a minute) says the relay can't be reached and where to turn the setting off.

#### Progress

- While waiting, the invitee's Add a Friend shows each real step (`openInvite`'s `onStep`):
  1. reaching the relays (the room is joined)
  2. finding whoever made the code (a peer connected and was sent `pake-start`)
  3. asking who they are (until `pair-offer`)
  4. after Ask to Be Friends, waiting for the inviter to add them
- A paper plane glides along a dotted path from you to your friend. The bar keeps moving. A countdown shows the give-up time (45 seconds for an answer, 3 minutes for the inviter to add you). A hint says what to check when a step stalls (`apps/messenger/connecting/`).
- Once paired, both go straight to the conversation, which opens with "Toms and Mika became friends on November 24 at 6:38 PM.", drawn from the friend's `addedAt`.

### Invite links

An invite link waits at the inviter's Lighthouses, so it works while the inviter is offline, and lets in as many people as it was made for.

#### The link

- `https://pigeon.tomszir.com/#b/<secret><fingerprint><maker><end>`, 86 characters, all lowercase:

| Part          | Encoding                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `secret`      | random 16 bytes, base32 (26 characters)                                                                   |
| `fingerprint` | first 16 bytes of SHA-256 of the inviter's identity, base32 (26 characters)                               |
| `maker`       | first 16 bytes of SHA-256 of the device that made the link, base32 (26 characters)                        |
| `end`         | when the link ends, whole seconds since 1970, 5 bytes big-endian, base32 (8 characters, no leftover bits) |

- Lowercase is the only spelling read. Capitals, or look-alikes that lowercase to a letter of it, are refused.
- `?l=<pigeon://lighthouse address>` follows when the inviter's list has none of the official Lighthouses.
- A link lasts 1 hour, 1 day or 7 days and is for 1, 5, 10 or 25 people, chosen when made.
- Opening one in the address bar takes it out of the address.
- A chat app previews it as the site itself, since nothing after `#` reaches a server. It never names the inviter.

#### Cards

- Making a link puts its card at each of the inviter's Lighthouses that has no pass:
  - tag `HMAC-SHA256(secret, "pigeon/invite/v1/card")`, until it expires
  - one drop hash, the link's own drop value's. The drop value never leaves that device.
- Each link has a 32-byte random claim key that never leaves that device. Every card is put claimed (see Lighthouses and mail), at each Lighthouse with `HMAC-SHA256(claim key, "pigeon/invite/v1/claim/" + Lighthouse id)`, a different value per Lighthouse.
- The first card is put before the link is shown. The link is shown only once its card is held at a Lighthouse every opener reads (the official ones, or the one the link names), so the maker holds the claim there from the start.
- A put refused as `taken` (only a tag someone claimed first can meet it) is put again unclaimed.
- A link made before cards were claimed gets a claim key at the next start or mail check, and its card is put again with it.
- Card: `{ v: "pigeon/invite-card/v1", identity, deviceLog, keys, name, lighthouses, expires, open, from, tag, sig }`.
  - `tag` is its own card tag.
  - Signed by the device that made the link, which must be active on the device log it carries.
  - Sealed with AES-256-GCM under HKDF of the secret (info `pigeon/invite/key`).
- When the inviter's device log, name or Lighthouses change, each open link's card is put again and the old one dropped by id at each Lighthouse.
- Closing a link (cancelled, or used up) puts a card with `open` false.
- Where a put doesn't get through, the card already there stays, and the new one is retried at each start and mail check.

#### Opening a link

- Lists the card tag at the official Lighthouses and the one the link names (when this Pigeon may reach it: see Lighthouses you didn't choose).
- At each Lighthouse:
  1. lists the tag's claimed blobs and opens up to 16
  2. lists everything under the tag and opens up to 100 more of at most 32 KB, newest first, skipping any already opened
- The second read covers Lighthouses from before claims (which refuse `list-claimed` as malformed) and cards not yet claimed.
- Before reading anything:
  - A link that has ended is refused as run out.
  - A link whose end is more than 7 days plus a day away (the day for clock skew) is refused as too long.
- Every card is checked:
  - The identity's long fingerprint must be the link's.
  - The signer must be active on the log, merged into the one this device keeps for that identity.
  - Each sealing key must be signed by its own device and active.
  - Only a card signed by the device the link names counts, and an open one only if its `expires` is no later than the link's end.
  - A card from a device that any log the asker has heard of that identity says was taken off is neither opened nor asked through.
- Of the cards that count, the newest log wins (epoch, then entries), a closed one over an open one on the same log.
- It shows the name and fingerprint.

#### Asking

- Refused once the link has ended.
- Puts a `mail:invite` letter once, sealed to the inviter's devices on the card, under `HMAC-SHA256(secret, "pigeon/invite/v1/ask/" + UTC date)` at the card's Lighthouses.
- Body:

| Field         | Holds                                                                 |
| ------------- | --------------------------------------------------------------------- |
| `name`        | the asker's name                                                      |
| `deviceLog`   | the asker's device log                                                |
| `keys`        | the asker's devices' sealing keys                                     |
| `lighthouses` | at most two Lighthouses without passes (a Pigeon with none can't ask) |
| `reply`       | a random 16-byte reply secret, fresh on every ask                     |
| `link`        | the link's card tag                                                   |

- Re-asking draws a fresh `reply`, so an answer to an earlier request can't end this one, and whoever read that request can't answer this one.
- The asker keys each pending ask by `(secret, identity, maker)` as decoded bytes: the link's secret, the identity its card names, and the device the link names.
  - Asking again through the same link replaces the pending ask.
  - A link with the same secret naming anyone else (one someone else made with that secret) is a separate ask and never replaces one.
- Device logs heard across requests to the same person are folded together: each request's, what answers carried, and the one kept for them.

#### Answering

- The maker fetches requests under its ask tags (at most 16 KB each, 200 a check).
- It keeps each request that names this link, from a device active on the log it carries, with keys signed by their devices: one per person, with each of their devices' reply secrets, until the inviter adds or declines.
- With 50 waiting, another is answered `busy`, to ask again later.
- Requests from someone blocked are dropped.
- A request through a closed or expired link is answered `closed` (at most 20 times a link, counting `busy`). So is everyone still waiting when it closes.
- A device of someone already added gets the same `added` answer.
- Adding:
  - keeps a new pair secret with the request first, so a Pigeon closed in between finishes on its next start
  - adds them as a friend with the request's device log, keys and Lighthouses
  - puts, for each device that asked, a `mail:invite-answer` letter sealed to their devices under `HMAC-SHA256(reply, "pigeon/invite/v1/answer/" + UTC date)` at their Lighthouses, again every 3 days until that device's receipt comes under the new pair secret
- The inviter is their friend at once. If the answer never reaches them (they stopped waiting, or stayed away past the link's end plus two days), the friend never shows up there.
- Declining puts `declined` once.

| Answer     | Body                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| `added`    | `{ answer: "added", secret, name, deviceLog, reply, link }`                                                        |
| `declined` | `{ answer: "declined", reply, link }`                                                                              |
| `busy`     | `{ answer: "busy", reply, link }`                                                                                  |
| `closed`   | `{ answer: "closed", deviceLog, reply, link }`, `deviceLog` being the inviter's log as the answering device has it |

- Every `invite-answer` signs `{ reply, link }`: the reply secret of the device it's for and the link's card tag. Both are required. An unbound answer is rejected.

#### Taking an answer

- The asker fetches its answer tags while the request waits.
- An answer counts for a request only when its `reply` and `link` are that request's, compared as decoded bytes. One naming another request (a copy put under this reply tag by a removed device or a Lighthouse) is left untaken, so it ends nothing and can't stand in for the real answer, whose letter id it shares.
- Every answer counts only from the device the link names, with no exception. Any answer from another device is dropped and the request keeps waiting, even a `closed` whose log takes the maker off (a device a recovery took off can sign on its old epoch).
- `added` is taken only when that device is active on the log it carries merged with every inviter log the asker has: the card's (kept with the request), every other request's to that identity, the one kept for them, and any a `closed` answer carried.
- The inviter is saved as a friend with that secret and merged log, so an older or stripped log can't bring back a removed device or drop the recovery key. Both then meet in the secret's rooms.
- A `closed` answer's log counts when its device is active on it, merged the same way. Once a request is answered `closed`, no `added` for it is taken.
- An older Pigeon on the inviter's list closing a removed device's link isn't heard: that link goes silent.
- After `added`, the asker keeps fetching that request's answer tags until two days after the link ends, without showing it, so a repeated `added` gets a fresh receipt if the first was lost.
  - Only the maker's answers are read there.
  - A repeated `added` changes nothing.
  - A `closed` from the maker with a log that holds merges that log into the friend's.
- While a link of yours is open or a request of yours waits, mail is checked every 30 seconds instead of every 10 minutes.

#### Your devices and links

- Only the device that made a link answers through it, and only its cards and answers count.
- It tells your other devices its links (`{ secret, owner, expires, uses, used, open }`) in the self mailbox, only so the Invite Links tab can count links open elsewhere. Nothing about a removal reads that list.
- Removing a device closes no link.
- Every device on the list, and one taken off, holds the secret of each link it heard of and can put cards under it, signed on the old log. Whoever opens another device's link takes none of those cards or answers, so a removed device can do nothing through them.
- A removed device's own links name it as maker, so it can still answer through them as you until each ends (at most 7 days after made), plus the two days an asker keeps taking answers. It can't extend a link, since the end is in the link.
- An honest removed device stops answering, so its links go silent: openers see the card and get no answer.
- Removals a device has acted on are kept in `removalsSeen`, written after the renew marks and checked at each start, so a removal stored just before a tab closed is acted on when it reopens.

### Replacing a secret

Whoever knows a pair secret can find and enter that friend's pair rooms and see that mail waits under its tags. Binding stops them passing for anyone, but they see when the two are online, and their IP addresses unless relay-only. The self secret gives the same view of your own devices.

A secret that may be known beyond the devices that should hold it is replaced with one that only ever travels sealed to devices:

- every secret from before codes went through SPAKE2, when a relay watcher could crack a typed code (or the code behind an `#i/` or `#l/` link), sit in the middle, and read the pair secret in `pair-accept` or the link bundle with the self secret and every pair secret
- every secret a device held when it's removed from your list, since it keeps what it was given

#### Which

- A friend's record carries `sealed: true` once its pair secret was made on this device or reached it sealed (live code, invite link, link bundle, or a replacement).
- The self secret has the same in `selfSecretState`, which holds the secret too, so both are stored in one write. `selfSecret` is still written after it, for a Pigeon that reads only that.
- A secret without the mark is from before.
- A self secret that never left this device (its log never had another device) is marked sealed and kept. One whose other devices are all gone is replaced on this device alone.

#### The proposal

- A `mail:rekey` letter with body `{ v: "pigeon/rekey/v1", replaces, secret, at, by, sig, logs }`:

| Field      | Holds                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `replaces` | base32 HMAC-SHA256(old secret, `pigeon/rekey/v1/replaces`)                                                                                |
| `secret`   | a new random 32-byte secret                                                                                                               |
| `at`       | when it was proposed                                                                                                                      |
| `by`       | the proposing device                                                                                                                      |
| `sig`      | `by`'s base32 signature over `{ v: "pigeon/rekey/v1/proposal", replaces, secret, at, by }`, so a relaying device can't change who or when |
| `logs`     | the newest device logs the sender knows for both sides (at most 2)                                                                        |

- For a friend: sealed to their devices still on their list (by their signed sealing keys) at their Lighthouses, under the old pair secret's tags (the only ones a friend who hasn't moved looks under). A copy with `friend` (their id) goes to your own other devices under the self secret's tags.
- For the self secret: sealed to your other devices still on your list, under the old self secret's tags.
- Never sent in a pair or self room, where whoever knows the old secret can sit.

#### Who starts

- Either side. At each mail check, once waiting mail is taken, a Pigeon proposes for every secret from before that has no proposal yet and someone to seal to. With nobody to seal to, it retries at the next check.

#### After a removal

- The remover (the list's writer, or the writer a recovery names) marks the self secret and every pair secret `renew: true` (kept with the record and with `selfSecretState`) and checks mail at once.
- At that check, and each one after until it can, it begins a new round for each marked secret, from the secret it holds now:
  - The proposal's `replaces` names that secret, not the one the last round replaced, so it isn't measured against that round's winner, which the removed device may hold.
  - It's sealed to the devices still on the lists, under the tags of the secret the other side is on.
  - A self secret with no other device left is just replaced here.
- The round under way becomes the round before, kept as `prior` beside `replacing`, and what it proposed as `begun`.
- Until a round begins from `begun`, a winner this device takes that isn't `begun` marks the secret `renew` again, so a new round begins from it at the same check. (A proposal from the other side made before it heard of the removal can be earlier.) A round that began from `begun` is taken as is, and `begun` is dropped.
- A friend added from an export file is marked the same way, since whoever had the file, or its source device, may know its secret.

#### Rounds

- A device takes a proposal for its round under way as below. One whose `replaces` names the secret it holds is a new round, taken when its `by` counts: it moves to it, and its round becomes the round before.
- A new-round letter also carries `prior`: the round before's winning proposal (`{ replaces, secret, at, by, sig }`, signed by its maker, `secret` being what the new round's `replaces` names). Its signature is checked.
  - A device still in that round follows it, whatever it chose there.
  - A device in a rival new round begun from another proposal of the round before compares the two as proposals in one round, so the earliest wins.
- A proposal for the round before, with nothing to move the device further, is answered with the winner and `prior`, also under the tags of the secret it proposed.
- A device keeps the round before's rooms and mail while neither round's new secret has been seen held by the other side, and fetches under the round before's old secret until its own round is let go.
- Only the round before is kept. A device two or more rounds behind gets nothing it can follow and stays apart until paired again.
- A round taken by a device that couldn't read it (a Pigeon from before new rounds takes `mail:rekey` and receipts it) is sent again when a device of the other side is met in the old rooms while none has been seen with the new one. Once per device and winner: the round's `resent` lists devices sent it, each added once a Lighthouse took the letter.

#### Settling

- Proposals for the same old secret are ordered by `at`, then `by`, then `secret` (the last two as decoded bytes). The first wins everywhere.
- A device keeps the winner it has seen. A losing proposal is answered with the winner, sent back to the sender (the friend's devices, or your own).
- When a device's winner changes, it sends the new winner to both sides, so a device the proposer couldn't seal to still hears it, and the proposer hears it's held.
- Durability:
  - Those letters, and a device's own proposals, are in its outbox before the new winner is kept. A tab closing in between puts them at its next start.
  - A tab closing before either retakes the unreceipted letter that brought the winner, or proposes again.
  - When they can't be stored, neither is the winner, and the letter that brought it doesn't count, so it's looked at again.
- Whatever order letters arrive in, all end on the earliest.
- Validity:
  - A proposal counts only with a `sig` that verifies against its `by`, whichever letter carries it.
  - A letter counts only from a device active on its sender's list (the friend's for theirs, your own for copies and the self secret), only for the secret this device holds or is replacing, and once per sender and id.
  - Its logs are merged first: those in every fetched letter before any is acted on.
  - A proposal whose `by` is no longer on its side's list never wins. One that was winning gives way to any that counts. With none, this device proposes again.
- So a removed device can't choose where the two sides end up.
- While a friend hasn't heard of the removal, a proposal from the removed device can move that friend for a while (out of the old rooms too), until a letter from a device that knows of the removal arrives. With the rest of that side not yet updated, that lasts until one of them updates.

#### Moving

- A device with a winner joins the new secret's rooms at once and keeps the old secret's (and mails under the old one) until it sees a device on the other side holding the new one: a `mail:rekey` from it naming it, or a bound hello from it in one of its rooms.
- Then it leaves the old rooms and mails under the new secret.
- It keeps fetching under the old secret's tags until every device on the other side's list has been seen that way. One away for any length of time still finds the old secret's mail answered: it proposes, loses, and is sent the winner.
- Then it lets the old secret go but keeps which proposal won, so a later, earlier-ordered proposal from a delayed device on its own side still moves it.
- A device whose winner changes sends it under the old secret's tags and under the replacement it held before (where devices that let the old secret go still look). A copy for your own devices goes under the self secret's tags.
- A device that had let the old secret go and is moved this way doesn't return to the old rooms or mail under the old secret.
- Only a proposal that wins before the old secret is let go is made again when its proposer is removed.
- A proposal whose `secret` is the old secret itself is ignored.

#### Older Pigeons

- A Pigeon from before this doesn't fetch `mail:rekey` and leaves it at the Lighthouse.
- While none of its side's devices has moved, it stays in the old rooms where the updated side still is, and mail between them uses the old tags.
- Once one of its side's devices has moved, the other side leaves the old rooms, and a non-updated device hears nothing new until it updates.
- Then it finds the proposal (put again every 3 days for 30 days) or, if expired, makes its own, which loses to the earlier one and is answered with it.
- A Pigeon that replaces secrets from before but not after a removal ignores a new round and stays on its secret, where the other side waits. It's sent the round again once updated and met there.

#### Linking meanwhile

- A link bundle carries each friend's replacement under way and the round before, and the self secret's as `selfReplacing` and `selfPrior`, so a device linked meanwhile carries on where its linker is.
- `selfSealed` says whether the self secret is from before, so the new device replaces it if the linker never gets to. A bundle without `selfSealed` is taken as sealed.

#### Your devices

- Once a pre-SPAKE2 self secret of an identity that ever had another device is replaced (proposed here, taken from another device, or replaced alone), My Devices asks you to confirm every device on the list is yours, until you do.
- A device someone else linked in the middle is on the list and gets the new secret like the rest. Removing it replaces the secrets again, without it.
- A replacement after a removal asks nothing: it was sealed to the list as it is.

## Removing and blocking

- Removing a friend deletes them and your chat from this browser and sends `unfriend` in your pair room.
- If they're offline:
  - The id (and pair secret) waits in `farewells`, and a session of its own sends it the next time they're there.
  - It's also left as a `farewell` letter sealed to their devices still on their list, at their Lighthouses (the official ones if they never said). Their Pigeon takes it at its next fetch, only from a device on your list. Its receipt ends the wait as meeting them would.
- Their Pigeon keeps the chat read-only, marks them "removed you" and stops its session. Removing them too deletes it.
- Pairing again makes you friends once more.
- Blocking also keeps their id in `blocked`:
  - Your codes leave their `pair-request` unanswered and never show it.
  - An invite of theirs you open is refused before anything is agreed.
- Petnames and mutes are yours alone and never leave the browser.

## Logs

Chats and guestbooks are signed append-only logs.

- Each author appends entries with a sequence number (1, 2, 3...) and a Lamport timestamp.
- Each entry is signed over `{ v: "pigeon/chat-entry/v1", log, author, seq, lamport, at, text }`. `log` is the log's id, for a chat the name from both ids (see Room names).
- On `hello` peers exchange `log-sync` summaries (per author, the highest sequence held with no gaps) and answer with `log-entries` batches of what the other lacks.
- Merging is a sorted union by (Lamport, author, sequence).
  - An entry that doesn't verify, or isn't by one of the pair, is dropped.
  - The first entry seen for a sequence wins.
- Lamport times:
  - Any verifying entry is taken whatever its Lamport time, as long as it's a safe integer. A time past that is never offered in a catch-up.
  - A new entry's time is one past the highest held that is no more than 2^20 times its rank (how many entries sort at or below it), and never past 2^53 − 1.
  - A made-up time far ahead is held and shown, but the clock doesn't follow it, so it can't push later messages past what peers take.
- A message is at most 4000 characters.
- A message written while the friend is offline goes by letter (see Letters) and also reaches them the next time both are online.
- Receipts are entries too.

## Lighthouses and mail

### Connections

- A Lighthouse is a peer with an Ed25519 key, reached over WebSocket at `pigeon://lighthouse/<id>?url=...`.
- Its `hello` carries `protocol` and `software`, shown as its own claim.
- A client's `hello` carries only `protocol` and a `nonce` for the connection.
- Requests are numbered (`req`, from 1) and unsigned.
- Each reply `{ v: 2, from, at, req, nonce, request, reply, sig }` is signed by the Lighthouse over the connection's nonce and `request`, the SHA-256 of the exact request frame it answers.

### Sealing keys

- Bound as `{ device, key, sig, hpke }`:
  - `key`: the raw P-256 public key in base64
  - `sig`: the device's signature over `{ v: "pigeon/sealing-key/v1", device, key }`
  - `hpke`: a second device signature over `{ v: "pigeon/sealing-key/hpke/v1", device, key }`, saying it opens HPKE mail
- Pigeons from before HPKE send no `hpke` and ignore it.
- A key whose `hpke` doesn't hold is refused. A copy of a kept key without `hpke` doesn't replace one with it.

### Letters on the wire

- A letter is `{ v: "pigeon/letter/v1", room: "mail:<kind>", sender, to, date, id, head: { epoch, seq }, from, at, body, sig }`, signed by device `from` of identity `sender`.
- `id` is 8 to 64 characters, taken once per sender.

| Kind            | Use                                                                          |
| --------------- | ---------------------------------------------------------------------------- |
| `farewell`      | removing a friend while they're offline                                      |
| `self`          | the self mailbox snapshot                                                    |
| `sync`          | the shared log                                                               |
| `receipt`       | a device has taken a letter                                                  |
| `invite`        | a request through an invite link                                             |
| `invite-answer` | the maker's answer                                                           |
| `letter`        | chat entries                                                                 |
| `rekey`         | replacing a secret                                                           |
| `pair`, `link`  | a live code's answer, handed over the connection, never left at a Lighthouse |

### Sealing

- Sealed with a random 32-byte content key (AES-256-GCM, nonce first). The content key and that device's 32-byte drop value are wrapped for each recipient device.
- The blob is `{ v, wraps: [{ e, w }], commit, content }` in canonical JSON:
  - Wraps are shuffled and name no device, so a device tries each.
  - `e` is only an uncompressed 65-byte point.
  - `commit` is HKDF-SHA256 of the content key (no salt). Every device checks it, so all open the same letter.
- One wrap form for the whole blob:

| `v` | When                                    | Wrap                                                                                                                                                                                                     | `commit` info                  |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 2   | every recipient device's key has `hpke` | RFC 9180 HPKE, base mode, single-shot: DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-256-GCM. `e` is the encapsulated key, `w` the ciphertext. Info `pigeon/mail/v2` (UTF-8), aad the 32 bytes of `commit` | `pigeon/mail/v2/commit/<kind>` |
| 1   | otherwise (every Pigeon opens it)       | AES-256-GCM (nonce first) under HKDF-SHA256 (no salt, info `pigeon/mail/wrap/<e>/<device key>`, both base64) of ECDH between a fresh P-256 key `e` and the device's key                                  | `pigeon/mail/commit`           |

- For `v: 2`, a device opens each wrap once, finds the kind by checking `commit` under each kind the fetched mailbox holds, and refuses a letter whose kind isn't that one.
- A device opens a letter only for its own identity, of a kind and date the fetched mailbox holds.
- A device whose sealing key isn't a usable point is left out of a blob, never the rest.

### Tags and storage

- Put under tag `HMAC-SHA256(pair or self secret, "pigeon/mail/v1/" + recipient identity + "/" + UTC date)`, with one drop hash per recipient device, sorted, for at most 30 days.
- Put at every Lighthouse on the recipient's list (said in `hello` as `lighthouses`, the official ones when unknown).
- A blob's id is SHA-256 of its tag, blob and drops (and owner, for a claimed blob), so the same bytes put unclaimed by someone else never stand in for it.
- Each device that takes mail drops its copy and puts a signed `receipt` back. Senders put again until each device's receipt comes.
- Mail counts only from a device active on the sender's newest log. A farewell from a device since removed is undone.

### Operations

| Operation      | Does                                                                             |
| -------------- | -------------------------------------------------------------------------------- |
| `put`          | stores a blob, optionally with a `claim`                                         |
| `list`         | exact tags and a cursor; answers id, tag and size                                |
| `list-claimed` | the same, for claimed blobs only                                                 |
| `get`          | one blob                                                                         |
| `drop`         | removes a blob                                                                   |
| `wait`         | `{ tags, cursor, seconds }`: 1 to 128 distinct tags, a lease of 1 to 600 seconds |

- `wait` is answered once by `waited { why }`, signed like every reply over the connection's nonce and the hash of the wait's frame:
  - `mail`: a blob is put under one of its tags past its cursor by another connection, or one is already there
  - `lease`: the lease ends, or another `wait` on the connection replaces it
  - It names no tag, id or size.
- A connection has one wait at most. A wait counts as a read. A Lighthouse from before waits calls it `malformed`.
- A put's reply and success never depend on waits, and go before any wait it wakes is answered.
- A put never wakes its own connection, or a wait whose lease has passed.
- The text frame `ping` is a keepalive answered `pong`, neither signed nor a request. A connection that keeps sending it isn't closed as idle.

### Claims

- A `put` may carry a `claim`, 32 bytes in base32. The Lighthouse keeps its SHA-256 with the blob as owner and never reveals it.
- A put is refused as `taken` while an unexpired claimed blob under the same tag has another owner. A tag's claimed blobs come only from the first claimer until all are dropped or expire.
- Ordinary puts under the tag, and `list`, are unchanged.
- Claims are for invite cards, whose tag anyone holding the link knows.
- A Lighthouse from before claims ignores the field and keeps the blob unclaimed.

### Lighthouses you didn't choose

A Lighthouse sees the IP address of whoever connects, and connecting points your browser at its host.

- Chosen: on your list, on the list your other devices last said, or official.
- Named by someone else: a friend's `hello`, an invite link's `?l=`, the card behind a link, or a request through one.
- Pigeon connects to one named by someone else only when its URL is `wss://` to a public host, and never while relay-only is on.
- Checking a Lighthouse in Network (on your list, or being added) reaches it whatever its address, since you chose it.
- A host isn't public when it's:
  - loopback, private, link-local, shared (100.64.0.0/10), multicast or other special-use, IPv4 or IPv6 (IPv4-mapped and NAT64 forms included)
  - `localhost` or a single-label name
  - under `.local`, `.localdomain`, `.internal`, `.intranet`, `.home.arpa`, `.home`, `.lan`, `.corp`, `.private`, `.test`, `.invalid`, `.example`, `.onion` or `.alt`
- An IPv4 host is parsed as a browser does, so `127.1` or `2130706433` is 127.0.0.1.
- A named address counts as chosen only when its URL exactly matches yours: another path on the same host can be another service.
- Known gaps:
  - A name is taken as written, so one whose DNS answers privately (`127.0.0.1.nip.io`) isn't caught.
  - Only some browsers check this themselves (recent Chrome asks before a public page reaches the local network; Firefox and Safari don't for WebSockets). With relay-only off a friend can still point a `wss://` connection at your network that way. It opens with TLS, so a service there sees a TLS handshake, not a WebSocket frame.
- Mail for a friend goes to their Lighthouses Pigeon may reach. With none, it waits until you meet, and the chat says so. Your other devices still get their copy.
- Receipts are mail too. With relay-only on and a friend using only their own Lighthouse, their chat doesn't hear you have it, and their Pigeon re-puts the letter every 3 days until you meet or 30 days pass.
- Turning relay-only on closes any connection to a Lighthouse it now refuses.
- A request through a link none of whose card's Lighthouses Pigeon may reach isn't sent. Add a Friend says it couldn't be left.
- On the inviter's side, adding someone whose Lighthouses it may not reach adds them, but the answer waits, re-put every 3 days until relay-only is off (never, if it stays on).

### Polling

- A Pigeon checks for mail:
  - on start
  - every 10 minutes while running
  - when you come back (tab shown, window focused, network returns)
  - 10 seconds after you send a message
- Triggers coalesce into one look, never within 5 seconds of the last. One asked for sooner waits. One asked for during a look runs after it, never beside it.
- In a look, at each Lighthouse, for every day since the last look (30 at most), plus tomorrow in the last two hours of today, it lists the tags each friend's mail and your other devices' mail would be under, in lists of at most 512 tags, from its cursor.
- The cursor moves only past what it could get, or what turned out gone (a blob listed then dropped or expired answers `unknown`), which it skips without stopping that Lighthouse's list.
- An unreachable Lighthouse ends its list until the next look.
- With more than one list, the saved cursor is the least over them. A finished list counts as far as anything was listed before its last page was asked for (one that finished early is asked once more), so a blob put mid-read is never passed.
- A look that didn't finish saves nothing and lists the same days next time.

### Waiting for mail

- After a look that read one of its own Lighthouses to the end (nothing refused, failed or held back), with Hear About Mail at Once on in Network (the default) and relay-only off, a Pigeon leaves a `wait` there:
  - tags: today's, plus yesterday's in the first two hours of the UTC day and tomorrow's in the last two, its own and invites' first, at most 128
  - cursor: the one that look saved
  - lease: until its next scheduled look, at most 600 seconds
- It never waits at a Lighthouse a friend or link named, nor at one taken off your list during the look (same key, address and pass).
- `waited { mail }` is only a cue: a random 0 to 2 seconds later it asks the scheduler for a look (still 5 seconds apart).
- Back-off: after a cue whose look took nothing that counted, or failed, the next cue waits a minute, then two, doubling to ten, until a look takes something. A receipt counts only when it's the first from its device for a letter still waiting on that device. So someone holding a tag can't keep it looking with junk.
- A wait never moves a cursor or takes anything.
- `lease` brings no look. The same wait is re-sent with a lease to the next look when:
  - `lease` arrives at the lease's end (a second early at most) and the next look is more than 5 seconds off
  - no answer has come 30 seconds past the lease (a quiet Lighthouse with nothing to wake it)
- No re-send follows an early `lease` (so a Lighthouse answering at once can't drive a loop), nor a look there that didn't finish (mail would answer at once).
- While a wait stands its connection sends `ping` every 50 seconds. The wait has no time limit of its own.
- A wait unanswered 30 seconds past its lease, or replaced, is taken as ended, so a lost answer never holds one of the connection's 16 request slots.
- Reconnects:
  - A connection that drops while waiting is reopened and the wait re-sent with what's left of its lease, while Pigeon is on screen.
  - Delay: 5 seconds doubling to 5 minutes, half of each delay random, reset once a wait has stood a minute or been answered.
  - A connection the Lighthouse closed for room (1013) waits for the next look.
- A Lighthouse that calls a wait `malformed` isn't asked again for an hour.
- Turning Hear About Mail at Once off, or relay-only on, closes every connection with a wait. Taking a Lighthouse off your list closes its one.

### Taking and sending

- It opens each letter, takes each (sender, id) once, drops its copy and puts a receipt back, again each time the letter is re-put, in case a receipt was lost.
- A letter from a device it doesn't know on the sender's list is left, to be looked at again when re-put.
- Every outgoing letter goes into the outbox before it's put, even during a look, so one whose tab closed before the put goes at the next start.
- Each put, first and every later one, is sealed to the recipient's devices on their list as known then, under the same id. What was put before is left to expire:
  - A device removed since isn't sealed to or waited on. One linked since is.
  - A letter nobody on the list is left to hear is dropped.
  - With no key known for a device it waits on, it waits, never sealed to an older key.
- A letter telling devices just taken off your list goes to them alone. One re-sending a secret's winner to one device goes to that device alone while it's on the list.
- It's re-put every 3 days until every recipient device's receipt comes or 30 days pass. A letter that only expired was never heard, so a farewell keeps being said in person.
- Puts ask for an hour less than the most a Lighthouse keeps, so a clock ahead of the Lighthouse's still fits.

## Letters

A message written while none of the friend's devices is connected goes by letter.

### Sending

- A `mail:letter` sealed to their devices still on their list, under the pair secret's tag, at every Lighthouse on their list (official ones when unknown).
- Body `{ log, entries }`: the chat's id and at most 50 (and 40 KB) of this device's own signed chat entries the friend isn't known to have.
- How far the friend has this device's entries:
  - up to the last one sent while they stayed connected for 3 seconds after
  - all of them once one of their devices has synced (its `log-sync` is answered with what it lacks)
  - what receipted letters carried, in order from the start (a receipt for a later letter doesn't vouch for an earlier one)
- One device of theirs syncing counts as all of them having it.
- Triggers:
  - 5 seconds after the last message, so a burst goes as one
  - a friend going offline with entries they weren't seen to have
  - each mail check, the first included, for anything written before a close. One during a run of puts mails what it found once that run ends (one more run, no more)
  - a letter that expired unreceipted has its entries mailed again

### Received

- The chat's Received is only on their word:
  - a receipt for the letter that carried the message, or
  - a sync of theirs whose summary holds it. Per author, the highest sequence any of their devices has said it has (no higher than the chat held of that author then) is kept with the friend's letters.
- A message that went straight to an online friend isn't called received until one of their syncs says so.

### Re-putting

- Each letter waits for every recipient device's receipt and is re-put every 3 days for at most 30 days.
- One no Lighthouse took yet is re-put at each mail check and on Try Again.
- A re-put goes to the friend's Lighthouses as known now (and reachable, see Lighthouses you didn't choose), and still to where it went before until receipts come, so a friend who moved their mail isn't left with it at Lighthouses they no longer read.
- It's the same letter and id, sealed again to their devices as they are then. A device that has it takes it once. No message or field is added.
- At most 50 wait per friend, counting only those not yet receipted, overtaken by a sync or expired.
- A Pigeon remembers its last 200 letters to a friend and the last 500 messages that came by letter, for the chat to say.

### Taking

- Taken only from a device on the sender's list, and only into the chat with them. One arriving before that chat runs is left, to be taken when re-put.
- Entries merge with the checks `log-sync` uses (signed for this chat, by an author that counts, first seen per sequence wins), so letters and syncs never disagree and arrival order doesn't matter.
- New entries count as unread.
- Each message remembers its way, shown as a mark on its panel:
  - sealing
  - mailed (left at which Lighthouses)
  - not mailed yet, when no Lighthouse took it (retried at each check)
  - received (once a receipt or sync says so)
  - waiting until the friend is online, when it can't be mailed
- A message that came by letter remembers through which Lighthouse. Unread ones that came together fold into one envelope naming it ([design.md](design.md)).

### Copies to your devices

- Letters carry only the sending device's own entries.
- Each goes with a copy for your other devices: the same `mail:letter`, from and to your own identity, with `friend` in its body, sealed to your other devices on the list under the self secret's tags, at the Lighthouses self mail goes to.
- A device takes a copy only from another of your devices, into the chat with that friend if it has one, as its own words: not unread, no "came by letter" line.

### Limits

- Pigeons from before letters don't fetch them and get the messages when both are online.
- Letters are sealed to devices' long-term sealing keys. There are no one-time prekeys yet.

## pigeon:// addresses

- `pigeon://<name>/<path>`.
- The name resolves petname → handle seen signed by the Lighthouse directory → raw `PeerId`. Ambiguity shows a picker.
- Explorer joins `page:<owner>`, accepts the highest-versioned snapshot with a valid owner signature, sanitizes it with [PigeonHTML](pigeonhtml.md), and renders it.
- No answer: the "page not hosted" screen.
