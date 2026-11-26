# Flows

The protocol's handshakes and state machines drawn in ASCII, RFC style, so Help can show them as they are.

Every diagram follows [protocol.md](protocol.md), which wins where the two differ. Names in angle brackets are filled in at run time; `--->` is one envelope, `===` a room both sides are in.

## Invite handshake

Toms makes a live code and Mika opens it ([Pairing](protocol.md#pairing)). Both sides are on their first device; from any other device, `pair-offer` and `pair-request` also carry `identity` and the device log, and the fingerprint is the identity's.

```text
  Toms (inviter)        invite/v2:<nameplate>, or       Mika (invitee)
  --------------        the link's room                 --------------
  makes K7RT-VP2-BXQ:
  nameplate K7RT (public),
  password VP2BXQ, and a
  16-byte link secret; hosts
  it for 30 minutes, across
  reloads; waits in both
  rooms: invite/v2:K7RT, and
  invite/v2:<hash of the
  link secret>
        |                                                        |
        |                     types the code, and joins its room |
        |                    or opens #i/<secret><fingerprint>   |
        |                                and joins the link's    |
        |<----- pake-start { via: code or link, SPAKE2 A } ------|
        |------ pake-reply { SPAKE2 B } ------------------------>|
        |                                                        |
        |      both now hold a key, the same one only if both    |
        |      used the same password or link secret             |
        |                                                        |
        |<----- pake-prove { MAC a } ----------------------------|
        |                                                        |
  checks MAC a over the transcript: room, via, both SPAKE2
  messages, both device keys, both DTLS fingerprints. Wrong:
  pake-wrong, one wrong try shown to Toms; five stop the code,
  and none that came at the same time is checked after that
        |                                                        |
        |------ pair-offer { MAC b, Toms's name } -------------->|
        |                                                        |
        |                       Mika checks MAC b, then sees     |
        |                       Toms's name and fingerprint:     |
        |                       - from a link, an offer whose    |
        |                         fingerprint doesn't match the  |
        |                         link's is refused              |
        |                       - from a typed code, she is      |
        |                         told to compare it with Toms's |
        |                         screen                         |
        |                                                        |
        |<----- pair-request { Mika's name, sealing key } -------|
        |              (Mika chose Ask to Be Friends)            |
        |                                                        |
  Toms sees Mika's name, fingerprint and bird, and chooses:
        |                                                        |
  Add: makes a 32-byte pair secret
        |------ pair-accept { mail:pair letter sealed to ------->|
        |         Mika's key: the secret and the session }       |
  Decline:                                                       |
        |------ pair-decline ----------------------------------->|
        |       (the code stays open for the right person)       |
        |                                                        |
  stops hosting the code                          saves Toms, with
  saves Mika, with the secret                     the secret
        |                                                        |
        +=========== pair:<daily name from the secret> ==========+
                     (never the old pair room)

  someone in the middle, relaying every message unchanged, shows
  each side a certificate of their own: the two transcripts name
  different DTLS fingerprints, MAC a doesn't check, and nothing
  past pake-wrong is sent
```

## Pair rooms by day

Two friends meet in a room named from their pair secret and the UTC date ([Rooms](protocol.md#rooms)). Around midnight UTC both days' rooms are joined, so clocks less than an hour apart still meet. One pair session spans the rooms, and the same envelope goes to each.

```text
  name(day)     = "pair:" + base32( HMAC-SHA256( secret,
                                    "pigeon/pair/v2/" + day ) )
  password      = base32( HKDF-SHA256( secret, no salt,
                                       "pigeon/pair/password", 32 ) )

  UTC        21:00    22:00    23:00    00:00    01:00    02:00
               |        |        |        |        |        |
               |<-------- 2026-11-24 ---->|<------ 2026-11-25 -------
               |        |        |        |        |        |
  name(11-24)  ====================================|
  name(11-25)                    |==============================...
                                 |        |        |
                                 |        |        +-- first hour over:
                                 |        |            yesterday's room left
                                 |        +-- the date changes
                                 +-- last hour of the day:
                                     tomorrow's room joined too

  In both rooms at once, an envelope still names the chat's id
  (the old pair room's name) as its room, so the friend takes
  buzz and unfriend only once. pair-secret and pair-secret-ok
  count only in the old pair room itself.
```

## Replacing an old secret

A pair secret from before codes went through SPAKE2 is replaced over sealed mail ([Replacing an old secret](protocol.md#replacing-an-old-secret)). Here both Toms and Mika propose at once; the self secret goes the same way between your own devices.

```text
  Toms                     Lighthouse, under               Mika
  ----                     the OLD secret's tags           ----
  secret X from before                           secret X from before
  proposes S1 at 12:00                           proposes S2 at 12:00
  joins S1's rooms, keeps X's                    joins S2's rooms, keeps X's
        |--- mail:rekey { X, S1, 12:00, T } ---->|  sealed to Mika's devices
        |<--- mail:rekey { X, S2, 12:00, M } ----|  sealed to Toms's devices
        |    (and a copy of each to the sender's own other devices,
        |     under the self secret's tags)
        |                                        |
  earliest wins everywhere: by at, then by device, then secret.
  Say (12:00, T) comes first:
        |                                        |
  S2 loses: answers with S1                      S1 wins: takes it,
        |--- mail:rekey { X, S1, 12:00, T } ---->|  answers with it
        |<--- mail:rekey { X, S1, 12:00, T } ----|  leaves S2's rooms
  Mika holds S1: heard                           Toms holds S1: heard
        |                                        |
        |=============== S1's rooms =============|
  each leaves X's rooms once it hears a device of the other's holds
  S1 (that letter, or a bound hello in S1's room), mails under S1
  from then, and still looks under X's tags until every device on
  the other's list has been heard; each letter carries both sides'
  device logs, each proposal is signed by the device that made
  it, and a proposal from a removed device never wins

  after that, which proposal won is kept: an earlier one that was
  held up, from one of Toms's own devices, still moves everyone,
  sent under X's tags and under S1's, where those that let X go look

  someone who knows X can sit in X's rooms and see what waits
  under X's tags, but every rekey is sealed to device keys, and
  S1's rooms and tags can't be worked out from X

  a friend whose Pigeon hasn't updated stays in X's rooms, where
  Toms waits too, so they keep chatting; once it updates it finds
  the proposal waiting, or makes its own, which loses and is
  answered with S1
```

## Saying hello

Every new connection in a pair or self room, between Toms's device and one of Mika's ([Rooms](protocol.md#rooms)). Each side does both halves at once; one is drawn. `T` and `M` are the certificate fingerprints of the data channel, as `binding` gives them.

```text
  Toms                     pair:<daily name>                     Mika
  ----                     -----------------                     ----
        |------------ device-log (if he has one) --------------->|
        |------------ nonce { n: 16 random bytes } ------------->|
        |                                                        |
        |                        Mika's view: local M, remote T  |
        |<----- hello { ..., binding: { n, local M, remote T } } |
        |                                                        |
  takes the hello only when n is the nonce sent on this
  connection and local/remote are his view (T, M) swapped;
  until then nothing else from it counts, and none of
  presence, profile or log-sync goes to it
        |------------ presence, log-sync ----------------------->|
        |    (and profile, between your own devices)             |
        |                                                        |
        |  a relay between two connections has a certificate     |
        |  of its own on each, so a hello it forwards names      |
        |  the wrong channel and is ignored                      |
        |                                                        |
  a Pigeon from before binding never answers the nonce, and
  its unbound hello counts for nothing: they meet only
  through Lighthouses until it updates
```

## Linking a device

Toms puts his phone on his device log ([Devices](protocol.md#devices)). The laptop is the device that writes the log; the phone must have no friends of its own, or leave the Pigeon it has first. The code and the first four messages are an invite's ([Invite handshake](#invite-handshake)), in another room.

```text
  Laptop (writes the log)    link/v2:<nameplate>,     Phone (new device)
  -----------------------    or the link's room       ------------------
  File, Link a Device
  hosts both rooms for 10
  minutes; shows the code,
  the link #l/<secret><fingerprint>
  as a QR code, and its
  Pigeon's fingerprint
        |                                                       |
        |                         File, Link to My Other Device |
        |                     types the code or opens the link; |
        |                                                 joins |
        |<------ pake-start, pake-reply, pake-prove ----------->|
        |        (as for an invite; a wrong MAC is a wrong      |
        |        try, five stop the code)                       |
        |                                                       |
        |------ link-offer { MAC b, whose it is (and the ------>|
        |                    device log, if not the first) }    |
        |                                                       |
        |                         from a link, its fingerprint  |
        |                         must match; from a typed code |
        |                         the phone shows it, you check |
        |                         it's the laptop's and choose  |
        |                         Continue                      |
        |                                                       |
        |<----- link-request { the phone's sealing key } -------|
        |                                                       |
     +---------------------+                 +---------------------+
     | 3f9a 21c0 77d1 0b4e |  both show the  | 3f9a 21c0 77d1 0b4e |
     +---------------------+  phone's finger-+---------------------+
                              print, which the
                              transcript covered
        |                                                       |
  you check it's the phone
  in your hand and choose
  Link: signs 'add phone'
  (refused before, with
  nothing signed, when the
  bundle wouldn't fit one
  sealed letter, 44 KB)
        |                                                       |
        |------ link-accept { part, parts, mail:link letter --->|
        |         sealed to the phone's key: the session and    |
        |         the bundle: identity, device log, self        |
        |         secret, profile, friends and their pair       |
        |         secrets, blocked list, friends' device logs } |
        |                                                       |
        |                                keeps it all and starts
        |                                again as Toms; chats
        |                                catch up in pair rooms
        |                                                       |
        +============ self:<daily name from the self secret> ===+
                      (device logs only)
```

## The device log

An identity's device log, as a state machine ([Devices](protocol.md#devices)). Each epoch has one writer, whose entries form a single chain, each naming the signature of the one before.

A device, within one epoch:

```text
               add                         remove
               (writer signs,              (writer signs)
               with a name)
  +----------+ -------------> +--------+ --------------> +---------+
  | not on   |                | ACTIVE |                 | REMOVED |
  | the list |                +--------+                 +---------+
  +----------+                  |    ^                   for good in
                                |    | name              this epoch:
                                +----+ (writer signs)    its key can't
                                                         be added again

   - The writer is on the list and can't be removed.
   - In epoch 0 the writer is the first device, whose key is the
     identity's PeerId; it is on the list without an entry.
   - What a device signed before it was removed still counts, by
     its own time; nothing later is taken from it.
```

The log, across epochs:

```text
   +---------------------------------------------------------+
   | EPOCH 0          writer: the first device               |
   | entries: add / remove / name                            |
   +---------------------------------------------------------+
        |
        | recovery { key: K1, at, sig }
        |   signed once by the first device over
        |   { identity, type: "recovery-key", key, at },
        |   with a 'name' entry for the first device
        v
   +---------------------------------------------------------+
   | EPOCH 0, key K1 committed                               |
   +---------------------------------------------------------+
        |
        | recover { epoch: 1, writer: W, keep: [{ device, name }]
        |           (up to 8, W among them), next: K2, at, sig }
        |   signed by K1 over { identity, type: "recover", ... }
        v
   +---------------------------------------------------------+
   | EPOCH 1          writer: W                              |
   | the list is 'keep'; every other device, the old writer  |
   | too, is removed as of 'at'                              |
   | entries: add / remove / name, their bytes add 'epoch'   |
   +---------------------------------------------------------+
        |
        | recover { epoch: 2, ..., next: K3 }, signed by K2
        v
       ...                                    (at most 8 epochs)

   The list comes from the latest epoch alone. An older epoch's
   entries only say who was once yours and until when.
```

What a merge of two copies of one log keeps:

```text
   two copies of one identity's log
        |
        +-- they name different recovery keys
        |      -> the key you had first stays
        |
        +-- they disagree on an epoch's recover
        |      +-- you hold a later epoch on top of it
        |      |      -> yours stays; the other copy is refused,
        |      |         with everything after it
        |      +-- it's your latest epoch
        |             -> the lower signature wins, with everything
        |                after it
        |
        +-- they agree on every recover
               -> the copy with more epochs wins
               -> within an epoch, the longer copy of the same
                  chain wins; a copy that disagrees on an entry
                  both have is ignored

   then, over 100 entries in all:
        the oldest epochs lose their last entries first;
        the current epoch is never cut
```

## Recovery with every device lost

Rook has lost his laptop, his only device, and opens Pigeon in a new browser with his recovery key. Mika knew him before, so her Pigeon keeps his log.

```text
  New browser N             Mika's Pigeon               Lost laptop L
  (no friends)              (keeps Rook's log:          (the first device,
                            epoch 0 and key K1)         now a thief's)
       |                          |                          |
  1. File, Recover My Pigeon;     |                          |
     type K1's code               |                          |
  2. shows the next key K2;       |                          |
     goes on once you say         |                          |
     you've kept it               |                          |
  3. signs, with K1:              |                          |
     recover { epoch 1,           |                          |
       writer N, keep [N],        |                          |
       next K2, at }              |                          |
     N's log is a tail:           |                          |
     { from: 1, by: K1 },         |                          |
     nothing before it            |                          |
       |                          |                          |
       |-- pair again by invite,  |                          |
       |   as Rook, with the ---->|                          |
       |   tail                   |                          |
       |                     4. the tail follows on          |
       |                        from her epoch 0 and         |
       |                        K1 signed it: same Rook,     |
       |                        same chat and petname;       |
       |                        the new pair secret          |
       |                        replaces the old             |
       |                          |                          |
       +=== pair:<daily name, ===+                          |
       |    new secret>          |                          |
       |                          |                          |
       |<-- device-log -----------|                          |
       |    (Rook's whole log:    |                          |
       |     epoch 0, K1, epoch 1)|                          |
       |                          |                          |
  5. takes it: its key for        |                          |
     epoch 1 is K1, the tail's    |                          |
     'by'; N can link devices     |                          |
     and make friends again       |                          |
       |                          |                          |
       |                          |<-- invite, speaking -----|
       |                          |    as Rook's first device|
       |                     6. refused: her copy of         |
       |                        the log says a recovery      |
       |                        took L off the list          |
```

Until one old friend has handed the whole log back, the tail is N's only copy of the recovery: N can't link a device or make new friends, refuses to be recovered over except with the same code again, and the old code still matters, since K2 is worth nothing until a friend has seen epoch 1. A friend who hasn't seen the new log yet still trusts L.
