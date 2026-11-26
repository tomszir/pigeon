# Flows

The protocol's handshakes and state machines drawn in ASCII, RFC style, so Help can show them as they are.

Every diagram follows [protocol.md](protocol.md), which wins where the two differ. Names in angle brackets are filled in at run time; `--->` is one envelope, `===` a room both sides are in.

## Invite handshake

Toms makes an invite and Mika opens it ([Pairing](protocol.md#pairing)). Both sides are on their first device; from any other device, `pair-request` and `pair-offer` also carry `identity` and the device log, and the fingerprint is the identity's.

```text
  Toms (inviter)               invite:<code>              Mika (invitee)
  --------------               -------------              --------------
  makes K7RT-VP2B; hosts it
  for 30 minutes, across
  reloads; joins and waits
        |                                                        |
        |                            types the code or opens the |
        |                        link #i/<code><fingerprint>;    |
        |                                                  joins |
        |<-------------- pair-request { code, Mika's name } -----|
        |                                                        |
        |------- pair-offer { code, Toms's name } -------------->|
        |                                                        |
        |                       Mika sees Toms's name and his    |
        |                       16-hex fingerprint:              |
        |                       - from a link, an offer whose    |
        |                         fingerprint doesn't match the  |
        |                         link's is refused              |
        |                       - from a typed code, she is      |
        |                         told to compare it with Toms's |
        |                         screen                         |
        |                                                        |
        |<-------------- pair-confirm (Mika chose Add) ----------|
        |                                                        |
  adds Mika; makes a 32-byte
  pair secret
        |------- pair-accept { secret, 52 base32 chars } ------->|
        |                                                        |
  stops hosting the code                          saves Toms, with
  saves Mika, with the secret                     the secret
        |                                                        |
        +=========== pair:<daily name from the secret> ==========+
                     (never the old pair room)
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
  buzz, unfriend, pair-secret and pair-secret-ok only once.
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

Toms puts his phone on his device log ([Devices](protocol.md#devices)). The laptop is the device that writes the log; the phone must have no friends of its own, or leave the Pigeon it has first.

```text
  Laptop (writes the log)        link:<code>          Phone (new device)
  -----------------------        -----------          ------------------
  File, Link a Device
  hosts link:<code> for
  10 minutes; shows the link
  #l/<code><fingerprint>
  as a QR code and in letters
        |                                                       |
        |                         File, Link to My Other Device |
        |                     types the code or opens the link; |
        |                                                 joins |
        |<---------------------- link-request ------------------|
        |                                                       |
        |-------- link-offer { whose it is (and the device ---->|
        |                      log, if not the first device) }  |
        |                                                       |
     +--------+                                            +--------+
     | 482913 |   both show the same 6-digit check, from   | 482913 |
     +--------+   SHA-256 of "pigeon/link/v1", the code    +--------+
                  and both device keys
        |                                                       |
  you check the numbers match
  and choose Link:
  signs 'add phone' (refused
  before, with nothing signed,
  when the bundle wouldn't fit
  one 64 KB envelope)
        |                                                       |
        |-------- link-accept { bundle } ---------------------->|
        |           identity, device log, self secret,          |
        |           profile, friends and their pair secrets,    |
        |           blocked list, friends' device logs          |
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
