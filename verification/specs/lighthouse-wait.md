# Waiting for mail at a Lighthouse: a specification

What a Lighthouse and a Pigeon must keep to when a connected Pigeon waits to hear that mail has come, when one look reads more tags than one list takes, and when letters asked for during a run go out, written from the docs as state machines and invariants, with the executable model in `verification/models/lighthouse-wait/` that checks them and the conformance traces an implementation must pass.

Conventions. `P` is docs/protocol.md, `TM` docs/threat-model.md, `LH` docs/lighthouse.md. Nothing here is taken from code. Real values are given first; the model scales them down (`model/wait-model.ts`, `model/conformance.ts`).

## 1. What there is today

- A Lighthouse answers `hello`, `put`, `list`, `list-claimed`, `get` and `drop`, one signed reply to each request, over the connection's nonce and the hash of the exact frame (P, Lighthouses and mail).
- A Pigeon looks for mail when it starts, every 10 minutes, when you come back to it, and 10 seconds after you send, never within 5 seconds of the last look (P). So mail put a moment after a look waits up to 10 minutes, even when its recipient is connected to that Lighthouse.
- A look lists every tag mail to it could be under, in lists of at most 512 tags, from a cursor it saves per Lighthouse, and gets every blob listed. With more than one list it saves the furthest cursor any list reached, which passes a blob put under a list that finished while another was still reading. How much one look may take is left to its own design (#170).
- A letter run seals and puts a friend's letters one at a time. A mail check's `resume` that comes while a run is under way is dropped, so whatever the run didn't set out to mail waits for the next check (#126).
- Limits count per address range (an IPv4 address or IPv6 /64) and per IPv6 /48 (LH, Limits). The Worker Lighthouse is one Durable Object; its sockets hibernate, and it loses what's in memory whenever it sleeps.

## 2. Actors

- **The Lighthouse**, Node or Worker. Node keeps everything in memory for as long as it runs, and has timers. The Worker has no timers (a timer keeps it awake): it notices a lease that has passed, or a connection gone quiet, when something next wakes it (a frame, a connection, a close, its hourly alarm). Its memory is lost whenever it sleeps, and it can be reset between storing a blob and sending the wakes that blob causes. What it keeps with each socket (the attachment) and in its storage survives both.
- **A Pigeon** with one connection per Lighthouse on its own list. It looks, then waits; hears `waited`; looks again on a `mail` cue; loses its connection and reopens it while on screen; can be closed for room; and can turn waiting off (the setting, or Always Go Through the Relay).
- **A sender**, any connection that puts mail under the Pigeon's tags: a friend, or another of your devices.
- **Others behind the same address**: many Pigeons behind one carrier address share its range's limits.

## 3. The Lighthouse's state machine, per connection

```
            connect (room, or room made)
  (none) ──────────────────────────────▶ open, no wait
                                           │   ▲
                         wait, well formed │   │ waited{mail} / waited{lease}
                         within limits,    │   │ (a put, a lease ending, a new wait)
                         nothing past its  ▼   │
                         cursor          waiting ──── close, or closed for room or idle ──▶ gone (no answer)
```

- A `wait { tags, cursor, seconds }` with 1 to 128 distinct tags and a lease of 1 to 600 seconds. Anything else is `malformed`. A well-formed wait first ends the wait standing on its connection, answering it `waited { lease }`, whatever happens to the new one.
- It counts as a read; past the range's reads it's `limit`.
- Past a tag budget it's `limit`: the tags in live waits from its range (2,048), from its IPv6 /48 (8,192), and from everyone (200,000). Only waits whose connections have been heard from within the idle time count; a waiting connection gone quiet past it is closed when it's noticed.
- If its tags already hold a live blob past its cursor, it's answered `waited { mail }` at once. Otherwise it stands until the first of: a put stores a new blob under one of its tags past its cursor, from another connection, before its lease ends (`mail`); its lease ends (`lease`); a new wait replaces it (`lease`); the connection closes (no answer).
- `waited { why }` says `mail` or `lease`, nothing else, and is signed like every reply, over that connection's nonce and the wait frame's hash.
- A put's reply and the store come out the same whatever waits stand. Its reply goes before any wait it wakes is answered.
- `ping`, a text frame, is answered `pong`. It is no request, isn't signed, counts against no limit, and says the connection is still there: a connection that keeps sending it isn't idle. The Worker answers it through the runtime's auto-response, without waking, and reads when it last did so (the auto-response timestamp) when it judges a connection idle.
- **The Worker, waking.** Its index from tag to waiting connections is rebuilt from the attachments. It keeps one number in its storage, `wokeThrough`: the highest seq whose wakes have all been sent, written after each put's wakes. Waking with its memory lost, it wakes the standing waits that blobs past `wokeThrough` are news to, before anything else, then answers every lease that has passed. The store doesn't say who put a blob, so this one catch-up may wake a blob's putter, or a wait whose lease ended since the put; at most once a reset.
- **No room.** A new connection that finds the total, its range's or its /48's connections full closes idle connections first, then the waiting connection whose wait has stood longest among those counted against every limit that's full, so closing it makes room. It's closed with code 1013 and the reason `room`. Only if none can be closed is the newcomer refused.

## 4. The Pigeon's state machine, per Lighthouse

```
  look ──▶ read to the end? ──no──▶ (no wait; the schedule looks again)
             │yes
             ▼
           wait ──waited{mail}──▶ cue: a look within 0–2 s, through the scheduler ──▶ look
             │──waited{lease} at its end, or no answer 30 s past it──▶ wait again, leased to the next look (none if it's under 5 s off)
             │──closed for room (1013)──▶ held off until the next scheduled look
             │──dropped otherwise, on screen──▶ reopen after 5 s, doubling to 5 min, and wait again
             └──waiting turned off──▶ connection closed
```

- It waits only at Lighthouses on its own list, only with waiting on and relay-only off, and only after a look that read its lists there to their end: nothing refused, nothing failed, nothing a source's limit held back. Its cursor is the one that look saved.
- Its tags are taken from that look's own: today's, yesterday's in the first two hours of the UTC day and tomorrow's in the last two, by the look's clock. So they are always a subset of what that look listed. Past 128 it keeps its own and its invites' tags and those of the friends it heard from most recently. Sent again after a drop, it names the same tags, with the lease that's left.
- Its lease runs to its next scheduled look, at most 600 seconds. A lease cut shorter than that (to an invite's quick look that has since stopped, or to a moment as a timer's look began) is renewed: once it has run its course, the same wait, same tags and same cursor, is sent again with a lease to the next scheduled look, unless that is 5 seconds off or less. A wait the client gives up on 30 seconds past its lease, unanswered, is renewed the same way: a Worker with nothing to wake it leaves an ended lease unanswered, and keepalives don't wake it. After a look there that didn't finish, a wait still standing from before isn't renewed, since mail past its cursor would answer it at once. A `lease` that comes before the lease's end (more than a second early, since leases are whole seconds) isn't renewed, so a Lighthouse that answers at once can't keep the Pigeon sending waits; and each lease sent again is longer than 5 seconds, so it's one wait per few seconds at most.
- A `waited` only asks for a look; it never moves the cursor, takes, opens or drops anything.
- Turning waiting off, or relay-only on, closes every connection with a wait standing.
- A connection closed for room isn't reopened to wait until the next scheduled look; other drops are reopened while Pigeon is on screen, and the backoff starts again once a wait has stood a minute or been answered.

## 5. One look over several lists

- At each Lighthouse a look reads its tags in lists of 512, all from the cursor it saved there, a page at a time, each to its end.
- **The cursor saved** is the least over the lists, each counted as far as it's known to have left nothing unlisted: a finished list as far as the furthest any list had been answered before its last page was asked for, since a blob put after that has a later seq. A list that finished before the others got as far is asked once more at the end, so an empty one doesn't hold the cursor where it was. This holds with mail put while the look reads.
- **A look that didn't finish** (a list or a blob that couldn't be got, a source's own limit holding blobs back) saves no cursor and keeps the last look's days (F6), so the next lists the same days again from where the last finished one stopped.
- How much one look may take, and how a tag flooded with junk is kept from holding back the rest, is left to its own design (#170).

## 6. Letter runs

- `wrote` and `resume` that come while a run is under way are remembered, and once the run ends one more run goes, if anything is still to be mailed.
- A run that ends at the cap of letters waiting for receipts starts nothing more by itself; the next ask (a receipt's mail check, a message) does.

## 7. The 12 points from reading the first design, and how each is settled

| #   | Point                                                                      | Settled                                                                                                                                                                                                                                             | Checked by |
| --- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | "A put doesn't depend on waits" holds only for the put's own handling      | It is stated for what it is: a put's reply and the store don't depend on waits. A wait is a frame and a read, counted like a list; a keepalive counts against nothing. Waiting connections can be closed for room, so they don't keep a putter out. | W4, E1     |
| 2   | Waits count as reads, so they can push a look's list into `limit`          | A refused list moves no cursor, and a wait costs one read a look. Mail is late, never lost.                                                                                                                                                         | L3, C1     |
| 3   | Relay-only turned on leaves a wait standing for up to 600 s                | Turning waiting off or relay-only on closes every connection with a wait standing.                                                                                                                                                                  | C5         |
| 4   | 16 waiting connections per IPv4 address leaves out people behind a carrier | Waits are counted by their tags: 2,048 per range and 8,192 per /48, the tags 16 and 64 full waits would hold, so nobody gets more of the index than before while 60 or so Pigeons of 30 tags fit behind one address, not 16.                        | L7         |
| 5   | A client's own copy put during its look wakes its next wait                | Kept, and bounded: the wait is answered at once, the next look moves past it. At most one extra look for a look that put mail under its own tags.                                                                                                   | W3, C4     |
| 6   | A reset Worker that kept its sockets loses unsent wakes                    | `wokeThrough` in its storage, and the catch-up on waking.                                                                                                                                                                                           | W2         |
| 7   | Auto-answered pings never update the Worker's idle time                    | It reads the auto-response timestamp as well as the last frame.                                                                                                                                                                                     | K1         |
| 8   | One failed blob fetch answers every new wait at once                       | No wait after a look that didn't read its Lighthouse to the end.                                                                                                                                                                                    | C4         |
| 9   | Dead sockets keep their waiting slot up to an hour on the Worker           | A waiting connection quiet past the idle time counts toward no limit and is closed when noticed: when waits are counted, at a wake, at the alarm, when room is needed.                                                                              | L7, L4     |
| 10  | Near midnight UTC the subset rule breaks ("last hour" against "two hours") | The wait's tags come from the look's own, by the look's clock, with the protocol's two hours; sent again unchanged.                                                                                                                                 | C7         |
| 11  | Waiters closed for room reopen and close each other                        | Closed for room with code 1013, and not reopened until the next look; the newcomer closes only a waiter counted against every full limit.                                                                                                           | C6, E1     |
| 12  | The checks leave out answering at once when mail is already there          | It's an invariant.                                                                                                                                                                                                                                  | W3         |

## 8. Invariants

Each has the id the model's checks use (`model/checks.ts`, `model/wait-model.ts`, `model/fetch.ts`, `model/letters.ts`).

### The Lighthouse

- **W1. One reply.** Each wait gets exactly one `waited`, or none if its connection closes first; every `waited` answers the wait standing on its connection, or the wait in that very frame. No wait disappears from an open connection unanswered.
- **W2. Never lost.** While a wait stands, its connection stays open and is heard from, a new blob put under one of its tags past its cursor, by another connection, before its lease ends, leads to `waited { mail }` by the end of that event, or, if the Worker was reset in between, by the next event that reaches it. Across hibernation too.
- **W3. At once.** A wait whose tags already hold a live blob past its cursor is answered `mail` at once, its own connection's blobs included.
- **W4. A put alone.** A put's reply and the store are what puts and drops alone would give, with or without waits.
- **W5. A wait moves nothing at the Lighthouse.** Only puts and drops change the store.
- **W6. Reveals nothing.** `waited` says `mail` or `lease` and nothing else; `mail` only when a list of the wait's tags from its cursor would name a blob.
- **L1. One wait per connection.** A new well-formed wait ends the standing one first, with `lease`, before anything is said about the new one.
- **L2. Shape.** A wait the wrong shape is `malformed`; one the right shape never is.
- **L3. Waits are reads.** Past the range's reads in a minute, a wait is refused like a list, and so is a connection's `hello`. The Worker counts in memory, so it holds a range to its reads since it last woke, never across a sleep or a reset.
- **L4. Tag limits.** Live waits that are heard from never hold more tags than the range's, the /48's and the total budget, nor more than 128 tags or 600 seconds each.
- **L5. No self or stale wake.** A put's own wake never goes to its own connection, or to a wait whose lease has passed. (The Worker's catch-up after a reset is the exception §3 names.)
- **L6. The same on both.** On the same events, Node and the Worker give every frame the same reply, hear of mail for the same waits, and close or refuse the same connections for room. The Worker may answer a lease later, or not at all if the connection closes first.
- **L7. A refusal is justified.** A wait is refused for its tags only when live waits that are heard from leave no room.
- **K1. Keepalives.** Only a connection quiet for the idle time, keepalives counted, is closed as idle.
- **E1. Eviction.** A new connection closes a waiter only when there's no room and no idle connection to close, choosing the longest-standing waiter among those counted against every full limit; it's refused only when none can be closed.
- **O1. The put's reply first.** A put's reply goes before the wakes it causes.

### The Pigeon

- **C1. No lost mail.** Once mail settles, every blob put under a Pigeon's tags has been taken by one of its looks, whatever its waits did.
- **C2. A wait moves no cursor.** Only a look changes the cursor or what's been taken.
- **C4. Quiet.** With no new mail from anyone, looks on a cue stop: at most two in a row.
- **C5. Off means off.** No wait stands for a Pigeon that turned waiting off, beyond a connection already gone quiet, which the idle time closes.
- **C6. No churn.** A Pigeon closed for room doesn't reopen to wait before its next look.
- **C7. Nothing new revealed.** Every tag a wait names was listed by the look before it.
- **C8. Waits until the next look.** A Pigeon that's on, connected, and has waited since a look that read its Lighthouse to the end always has a wait standing there, or a cue for a look, until that next look: a lease that ends is followed by the wait sent again in the same moment.

### One look

- **F2. No lost mail.** Looks one after another take every blob meant for the device, however the store is laid out, whatever is put between and during looks, and when the Lighthouse stops answering a list or a get partway: junk, blobs shared with other devices that stay listed after a drop, lists of any size. A blob that couldn't be got is got next time.
- **F5. A finished look saves what it read.** A look over a store nothing is put to finishes, and saves a cursor as far as the Lighthouse answered any of its lists with, worked out from the Lighthouse's answers, not the look's own word.
- **F6. An unfinished look keeps its days.** A look the Lighthouse stopped answering, a list or a get, doesn't move the days the next one reads.

### Letter runs

- **R1. Nothing held after a run.** Once no run is under way or due, nothing asked for since it last stopped counting waits, unless letters waiting for receipts are at the cap.
- **R2. One run per ask.** An ask starts at most one run after the one under way, so a friend who can't be mailed doesn't get a run every 5 seconds.

## 9. What a Lighthouse learns

Unchanged from the first design: no tag it doesn't already see, since a wait names a subset of what the look before it listed (C7); while Pigeon is open and waiting, that it's open, to the second, which tags that connection waits on and for how long, and that mail put under them is fetched moments later, in memory beside the connection's address. `waited` itself says one bit a list would say (W6). The Worker writes one number, `wokeThrough`, to its storage, and never a tag or a connection's waits.

## 10. Bounds of the model

- One Lighthouse, one to three Pigeons, one sender; up to two puts, three looks, four ticks of time, one or two of each fault (a drop, a silence, a sleep, a reset, a failing Lighthouse, the day turning).
- Limits scaled: a wait takes up to 3 tags and 3 seconds, the idle time is 2 or 3, tag budgets a few tags.
- Frames per minute, puts per hour and their /48 caps, store size, claims and `get` are left out: waiting changes none of them.
- One look: every store of up to four blobs over three tags in two lists; every schedule of up to two puts over its first six requests, lists and gets alike, over stores of up to two, with the Lighthouse answering everything or stopping at its first or third list or its first or second get; and every schedule of three puts over eight requests, over stores of one. Lists of 2 tags, pages of 1. The puts and failures happen inside the Lighthouse, whatever the look does; puts it never got as far as are made after it. A source's own limit isn't modelled; a look it holds back saves no cursor, as one that failed doesn't.
- The Worker's read counts are forgotten when it sleeps; Node's aren't. Parity traces leave sleeps and resets out.
- The conformance traces use the protocol's own shape limits (128 tags, 600 seconds, pages of 256) with small budgets, five connections in three ranges, and run 200 traces of 80 events (2,000 with `PIGEON_HEAVY=1`).
