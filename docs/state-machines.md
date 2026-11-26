# State machines

Pairing, linking and recovery as the states each side goes through, what moves it on, and what it checks first, drawn in ASCII beside the message sequences in flows.md.

[flows.md](flows.md) draws the same handshakes as messages between two sides, and the device log's own states; [protocol.md](protocol.md) wins where either differs from it. [threat-model.md](threat-model.md) lists every message with the checks it gets. Boxes are states; an arrow is labelled with what moves it on, and anything not drawn leaves the state as it is.

## Live codes: the side that made one

An invite code and a device-link code run the same machine, in `invite/v2:` or `link/v2:` rooms. The code as a whole:

```text
            Add a Friend makes a code (30 minutes), or
            File, Link a Device makes one (10 minutes)
                              |
                              v
   +-------------------------------------------------------+
   | OPEN                                                  |
   | waits in <kind>/v2:<nameplate> for the typed code,    |
   | and in the room named from the link's secret; an      |
   | invite code is hosted again after a reload, with the  |
   | wrong tries it had                                    |
   +-------------------------------------------------------+
       |              |                |                |
       | 5th wrong    | its time is    | Add or Link    | cancelled, or
       | try          | up (*)         | sent the       | a new code made
       |              |                | answer         |
       v              v                v                v
   +---------+   +---------+      +--------+       +---------+
   | STOPPED |   | EXPIRED |      |  USED  |       | CLOSED  |
   +---------+   +---------+      +--------+       +---------+

   Every end leaves both rooms; STOPPED and USED wait 2 seconds first,
   so the last pake-wrong or the answer can leave.
   (*) A device-link code with a request showing at its 10 minutes
       ends when that request is answered or goes.
```

Each connection in either room gets a run of its own, counted against the code:

```text
      a connection in the room
                |
                | pake-start: the code is OPEN, under 5 wrong tries;
                | `via` is the secret this room takes; no run on this
                | connection yet, fewer than 16 at once; the channel's
                | fingerprints are known. Answers pake-reply.
                v
          +-----------+   pake-prove with a wrong MAC       +--------+
          |  REPLIED  |----------------------------------->| FAILED |
          |           |   no pake-prove within 30 seconds  |        |
          |           |----------------------------------->|        |
          |           |   the connection leaves            |        |
          +-----------+----------------------------------->+--------+
                |                                    a wrong try, counted
                | pake-prove from the same           and shown at once;
                | device, its MAC right              pake-wrong sent if it's there
                v
          +-----------+
          |  PROVEN   |   sends pair-offer or link-offer: its own
          +-----------+   MAC, its name, and whose it is
                |
                | pair-request or link-request, the first on this
                | connection, from the run's device: its identity
                | holds against the log kept for it, it isn't
                | blocked or this Pigeon, and its sealing key is
                | signed by that device and usable
                v
          +-----------+   Decline, or Not This Device     +---------+
          |  ASKING   |---------------------------------->| REFUSED |
          |  shown    |                                   +---------+
          +-----------+    pair-decline sent (an invite); this
                |          connection can't ask again; the code
                |          stays OPEN for someone else
                |
                |   the connection leaves: the request goes, and
                |   nothing is counted against the code
                |
                | Add, or Link (each still on this run's connection)
                v
          +-----------+
          | ANSWERED  |   pair-accept or link-accept: the answer
          +-----------+   sealed to its key, naming this run's
                          session; the code is USED
```

An invite shows every request that holds at once, each in Add a Friend. A device link shows one at a time, and keeps the others that came meanwhile to show in turn if it's refused or goes.

## Live codes: the side that opened one

The same for an invite and a device link, until the answer.

```text
      a typed code, or an opened #i/ or #l/ link
                |
                v
          +-----------+   joins the code's room and sends pake-start to each
          |  LOOKING  |   connection there: at most 4 runs at once and 8 in all;
          +-----------+   one stalled for 15 seconds gives way to the next
           |    |   |
           |    |   +-- pake-wrong on its run, and no run left ---> WRONG CODE
           |    |
           |    +------ 45 seconds, an offer refused because its
           |            fingerprint wasn't the link's --------------> IMPOSTOR
           |            45 seconds, otherwise ----------------------> GAVE UP
           |
           | pake-reply: sends pake-prove. Then an offer on that run, from
           | its device, whose MAC holds and whose identity claim holds;
           | from a link, the identity's fingerprint must be the link's
           v
          +-----------+   shows the name and fingerprint: checked against
          |  OFFERED  |   the link's, or, from a typed code, to compare
          +-----------+   with the other screen
           |          |
           |          +-- Cancel ------------------------------------> GAVE UP
           |
           | Ask to Be Friends, or Continue: pair-request or link-request,
           | with this device's sealing key
           v
          +-----------+
          |   ASKED   |   waits up to 3 minutes for the other side to choose
          +-----------+
           |    |    |
           |    |    +-- 3 minutes ----------------------------------> GAVE UP
           |    +------- pair-decline on the run --------------------> DECLINED
           |
           | pair-accept or link-accept on the run, from its device: the
           | sealed answer opens, names this run's session, and holds
           v
       PAIRED, or LINKED
```

Every end leaves the room. A device link can only be opened on a Pigeon with no friends or devices of its own, not waiting for its list after a recovery, and not by the Pigeon that showed the code.

## Pairing

What each side keeps once a live code pairs them:

```text
   inviter (ANSWERED)                         invitee (PAIRED)
   ------------------                         ----------------
   a new 32-byte pair secret,                 the pair secret from the sealed
   sealed to the invitee's key                answer
          |                                          |
          v                                          v
   +---------------------------------------------------------------+
   | FRIENDS: each saves the other, with the secret and the        |
   | device log they sent, and meets them only in the secret's     |
   | daily rooms. Paired again with someone already a friend (as   |
   | after their recovery), the chat and petname stay and the new  |
   | secret replaces the old one.                                  |
   +---------------------------------------------------------------+
          |                                          |
          | Remove                                   | `unfriend` heard, in a
          v                                          v pair room or by farewell
   forgets them and the chat; says               keeps the chat read-only,
   `unfriend` in person or leaves                marked "removed you"; stops
   a farewell at their Lighthouses               its session
```

## Invite links through Lighthouses

The link, on the device that made it. Only that device answers through it.

```text
         Make an Invite Link: 1 hour to 30 days, for 1 to 25 people;
         its card put, claimed, at each of this device's Lighthouses
         without a pass
                                   |
                                   v
                              +---------+   the device log, name or Lighthouses
                              |  OPEN   |<--+ change: the card is put again
                              +---------+---+
                               |       |
       its last place taken,   |       | its time is up: the card
       Cancel, or its device   |       | expires at the Lighthouses
       taken off your list (*) |       v
                               |  +---------+
                               |  | EXPIRED |
                               v  +---------+
                              +---------+
                              | CLOSED  |  a closed card put, which wins over
                              +---------+  an open one on the same log;
                                           everyone waiting is told `closed`

   (*) Another of your devices closes it, with a card signed on the newer log
       and claimed with the link's claim key.
```

One person's request through it, kept per identity:

```text
     mail:invite under today's ask tag: it names this link, isn't from
     someone blocked, and its device and keys are on the log it carries
                                   |
              +--------------------+---------------------+
              | link CLOSED or     | 50 already waiting  | otherwise
              | EXPIRED            |                     |
              v                    v                     v
       answered `closed`    answered `busy`        +-----------+  another of their
       (with `busy`, at     (ask again later)      |  WAITING  |<-+ devices asks:
       most 20 a link)                             +-----------+--+ its reply kept too
                                                    |         |
                       Decline: answered            |         | Add: a place left,
                       `declined`, no place used    |         | still OPEN
                                                    v         v
                                          +----------+   +-----------+
                                          | DECLINED |   |  ADDING   |  pair secret kept first:
                                          +----------+   +-----------+  a Pigeon closed now
                                          they may ask         |        finishes it on its
                                          again                |        next start
                                                               |
                                                               | befriends them; `added`, with
                                                               | the secret, put to each device
                                                               v that asked
                                                         +-----------+
                                                         |   ADDED   |  a later request from
                                                         +-----------+  them gets the same
                                                                        answer
```

The asker's side of one request:

```text
     opens the link: at the official Lighthouses and the one the link
     names, up to 16 claimed cards under its card tag, then up to 100 of
     everything there, newest first; of the cards that hold, the newest
     log wins
                                   |
                                   | Ask to Be Friends: mail:invite sealed to
                                   | the card's devices, put once
                                   v
                             +-----------+   mail looked for every 30 seconds,
                             |  WAITING  |   under its own reply secret's tags
                             +-----------+
                               |   |   |
                               |   |   +-- `declined`, `closed` or `busy`, from
                               |   |       a device on the card, or `closed` with
                               |   |       a log its device is on --> that answer;
                               |   |       no `added` taken after `closed`
                               |   +------ the link's end and 2 days more -> stops looking
                               |
                               | `added`, from a device on the log it carries, merged
                               | with any a `closed` answer carried, the sender being
                               | the identity the card named
                               v
                             FRIENDS, with that secret; its answers still looked
                             at (every 10 minutes) until the link's end and 2 days
                             more: a `closed` answer's log is merged into the friend's,
                             so a device it took off their list stops counting
```

## Linking a device

The live-code machines above carry the link; this is what the device that writes your list does once you choose Link, and what the new device does with the answer.

```text
   writer (request ASKING)                           new device (ASKED)
   -----------------------                           ------------------
   Link chosen
       |
       +-- the bundle wouldn't fit one sealed
       |   letter (44 KB): refused, nothing signed
       +-- the new device has gone: nothing signed
       |
       | signs `add` for it, unless it's on the
       | list already from a link that didn't finish
       v
   sends link-accept, the bundle sealed to its
   key in up to 4 parts
       |                                                  |
       +-- not sent (it left, or the code                 | the parts, in order,
       |   stopped): it stays on the list, since          | from the run's device
       |   a removal is final, to be handed               v
       |   everything if it's linked again          opens the bundle; its
       |                                            identity is the one offered,
       v                                            and its device log verifies
   LINKED: your list and keys go to                 whole and lists this device
   your devices in the self room and                      |
   by self mail                                           v
                                                    keeps it all and starts
                                                    again as that identity
```

The new device's own place on the list then follows the device log's states in [flows.md](flows.md#the-device-log): ACTIVE until removed, REMOVED for good within its epoch.

## Recovery

Your recovery key, across epochs:

```text
   +---------+  Make a Recovery Key: the first device,   +--------------+
   | NO KEY  |----------------------------------------->| K1 COMMITTED |
   +---------+  once, signs { identity,                  | epoch 0      |
                type: "recovery-key", key, at }, and a    +--------------+
                `name` entry for itself
                                                                |
     a recover signed by the current key Kn, starting epoch n:  |
     its writer, the devices it keeps (up to 8), and the next   |
     key                                                        v
                                                         +--------------+
                                                         | Kn+1 CURRENT |---+
                                                         | epoch n      |   | the next
                                                         +--------------+<--+ recover
                                                                             (at most
                                                                              8 epochs)
```

Using it on a device that's already yours (Use My Recovery Key): the key signs a recover that makes this device the writer and keeps it and, if you choose, your other devices. The log stays whole, and devices left off are sent the log so they stop.

Using it with every device lost (Recover My Pigeon), on a new browser:

```text
   +-------------+
   | EMPTY       |  no friends, no devices of its own
   +-------------+
       |
       +-- the code is for this browser's own identity ------> use the key here instead
       +-- this Pigeon has friends or devices ----------------> refused: leave it first
       |
       | the code: identity I, epoch n, key Kn. Shows the next key Kn+1 and
       | goes on once you say you've kept it. Kn signs a recover: epoch n,
       | writer this device, keep [this device], next Kn+1
       v
   +-------------+
   | TAIL        |  the log is { from: n, by: Kn, epochs: [that recover] }
   | waiting for |  and nothing before it; a new self secret
   | its list    |
   +-------------+
       |   - Pigeons that don't already keep I's log refuse a tail: it can
       |     pair only with friends who knew I before
       |   - it can't link a device, or be linked or recovered over, except
       |     by the same code again
       |
       | pairs again by invite with an old friend, whose Pigeon takes the tail
       | on top of the epochs it keeps; that friend sends back I's whole log
       | in their pair room, which this device takes only if its key for
       | epoch n is Kn
       v
   +-------------+
   | WHOLE       |  this device writes I's list; every other device was
   +-------------+  removed as of the recover's time
```

Until one old friend has handed the whole log back, the tail is the only copy of the recovery, and Kn still matters: Kn+1 is worth nothing to a friend who hasn't seen epoch n. A friend who hasn't seen it yet still takes I's devices from before.
