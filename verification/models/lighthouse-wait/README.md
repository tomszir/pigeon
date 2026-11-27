# Model: waiting for mail at a Lighthouse

An executable model of a connected Pigeon waiting to hear that its mail has come, of a look that reads more tags than one list takes, and of letters asked for during a run, written from `verification/specs/lighthouse-wait.md` and the docs, with the conformance traces both Lighthouses must pass.

It is TypeScript run directly by Node 24, using type stripping and no dependencies. Nothing in it is taken from the implementation's code. Each rule of the design is a switch, and a planted defect turns one off.

## Running it

```sh
node --test model/                  # every test, one process (about 10 seconds)
node --test model/*.test.ts         # the same, one process per file
PIGEON_HEAVY=1 node --test model/*.test.ts   # ten times the random traces and walks
pnpm exec tsc -p verification/models/lighthouse-wait   # from the repository root
```

`node --test model/` runs the folder as one module: `model/package.json` points it at `model/all.ts`, which loads each test file. The model typechecks under the packages' strictest settings (`tsconfig.json`), so a package's tests can import `model/conformance.ts` as it is.

## What's in it

- `lighthouse.ts`: the reference Lighthouse, a pure function from a state and one event (a connection opening or closing, a frame, a keepalive, time passing, the Worker sleeping, its alarm) to the next state and what it sends. Node and the Worker are the same function with a different `variant`: Node answers a lease at its end and closes an idle connection on its timer; the Worker notices both only when something wakes it, loses its memory whenever it sleeps, and can be reset between storing a blob and sending its wakes.
- `checks.ts`: the Lighthouse's invariants, worked out on every event from the state before it, what went in and what came out, by plain rules of their own that never read the switches. A ghost carries the wakes still owed across a reset, reads counted independently, and the store as puts and drops alone would leave it.
- `system.ts` and `wait-model.ts`: Pigeons and a Lighthouse together. Clients look (listing to the end, taking and dropping what's theirs), wait after each look with tags from that look, hear `waited`, look again on a cue, put copies for their other devices, lose their connections (closed, or silent without the Lighthouse knowing) and reopen them, are closed for room, and turn waiting off. A sender puts mail, today's or, in the day's last two hours, tomorrow's. The Lighthouse can fail every get for a while. Nine scenarios, each on Node and on the Worker.
- `fetch.ts`: one look at one Lighthouse with more tags than one list takes, over every store of up to four blobs in two lists (junk that never opens, blobs shared with other devices that stay listed after a drop), every schedule of puts while the look reads, and a Lighthouse that stops answering partway. It exports the cases as `checkLooks`, so an implementation's look can run them.
- `letters.ts`: one friend's letter runs, with messages written while they're away and sent live while they leave unseen, receipts, a letter expiring, and mail checks asking to resume at any point.
- `conformance.ts`: the test an implementation must pass. It makes seeded random traces while the reference runs (connections in three address ranges, waits of good and bad shapes, puts new and again, lists, drops, keepalives, closes, silences, time, and on the Worker its sleeps, alarms and resets mid-put), and an implementation, through a `Subject`, must send each connection the same things in the same order, with a put's reply before its wakes. It also checks Node and the Worker against each other.

## Results

Every exploration below finished, unbounded by the cap; the numbers are states and depth.

| Scenario                                                 | States and depth                     |
| -------------------------------------------------------- | ------------------------------------ |
| Look, wait, a put, a cue, a drop and a reopen            | Node 52,171 / 11; Worker 51,864 / 11 |
| The Worker sleeps and resets between a put and its wakes | Worker 550 / 7                       |
| A Lighthouse whose gets fail                             | Node 26 / 5; Worker 26 / 5           |
| Waits and lists share a range's reads                    | Node 16 / 5; Worker 16 / 5           |
| The UTC day turns between a look and a wait sent again   | Node 217 / 7; Worker 217 / 7         |
| Waiting turned off with a wait standing                  | Node 47 / 4; Worker 47 / 4           |
| A full Lighthouse closes a waiter for a newcomer         | Node 76 / 5; Worker 76 / 5           |
| A waiting connection that goes silent                    | Node 88 / 6; Worker 87 / 6           |
| Three Pigeons behind one IPv4 address                    | Node 110 / 4; Worker 110 / 4         |

All invariants hold in every scenario, in random walks (300 a scenario, up to 40 steps; 3,000 heavy), on 200 conformance traces of 80 events on each Lighthouse (2,000 heavy), in Node against the Worker on the same traces, in every case the look model makes (7,381 stores; 793 schedules of up to two puts over 91 stores, the Lighthouse answering or stopping partway; 1,720 schedules of three puts over 10 stores: 313,233 in all). Letter runs: 931 states, depth 16.

Every planted defect is caught by the invariant it names, with a shortest history:

| Defect                                              | Caught by                             | Shortest history                                                                                                      |
| --------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| a new wait leaves the old one unanswered            | W1 one reply                          | S puts m1 under a's today tag, settle                                                                                 |
| no answer at once for mail already there            | W3 at once                            | a looks, S puts m1, a's connection drops, a reopens and waits again                                                   |
| a put wakes its own connection's wait               | L5 no self or stale wake              | a looks, a puts a copy for its other devices                                                                          |
| the Worker notices leases only by a timer it lacks  | L5 no self or stale wake              | a looks, time passes three times, S puts m1                                                                           |
| waits not counted as reads                          | L3 read                               | S puts m1, settle                                                                                                     |
| the index not rebuilt when the Worker wakes         | W2 never lost                         | a looks, S puts m1 and the Worker resets before its wakes, settle                                                     |
| nothing woken again after a reset                   | W2 never lost                         | a looks, S puts m1 and the Worker resets before its wakes, settle                                                     |
| a silent connection's wait still counted            | L7 refusal justified                  | a looks, a's connection goes silent, time passes twice, a looks                                                       |
| keepalives not counted as hearing from a connection | K1 keepalive                          | a looks, time passes three times                                                                                      |
| wakes sent before the put's reply                   | O1 reply first                        | a looks, S puts m1                                                                                                    |
| puts refused while waits fill the index             | W4 put alone                          | a, b and c look, S puts m1                                                                                            |
| the answer names the tag                            | W6 reveals nothing                    | a looks, S puts m1                                                                                                    |
| no waiter closed for a newcomer                     | E1 eviction                           | b joins and looks, settle                                                                                             |
| waits counted per connection, not by tags           | L7 refusal justified                  | settle: the third Pigeon behind one address is refused                                                                |
| a wait after a look that failed                     | C4 quiet                              | S puts m1, the Lighthouse fails every get, a looks, a looks on its cue three times                                    |
| today's tags named when waiting again               | C7 nothing new revealed               | a looks, its connection drops, the last two hours of the day begin, a reopens and waits again                         |
| waiting left standing when turned off               | C5 off means off                      | a looks, a turns waiting off                                                                                          |
| reopened at once after a close for room             | C6 no churn                           | b joins and looks, a looks, b reopens and waits again                                                                 |
| a cue moves the cursor                              | C2 a wait moves no cursor             | a looks, S puts m1                                                                                                    |
| the furthest list's cursor saved                    | F2 no lost mail                       | a put under one list, and a later one under another, while the last lists are asked once more: the first is passed by |
| a finished list counted only as far as it listed    | F5 a finished look saves what it read | an empty list read first holds the cursor where it was                                                                |
| a mail check's resume dropped during a run          | R1 nothing held                       | a message written, a run starts and puts a letter, a message goes live and its friend leaves, the run ends            |
| a run started again whenever one ends               | R2 one run per ask                    | three messages, a run reaches the cap, and runs follow each other on their own                                        |

Each Lighthouse defect also makes the conformance traces tell the defective reference from the right one, on each Lighthouse it applies to, and the Worker noticing leases only by a timer it lacks makes it differ from Node.

## Bounds

- One Lighthouse; one to three Pigeons and one sender; up to two puts, three looks, four ticks of time, and one or two of each fault. Budgets are in `wait-model.ts`.
- Limits scaled down: a wait takes up to 3 tags and 3 seconds; the idle time is 2 or 3; reads, tag budgets and connections a few each. The conformance traces use the protocol's own 128 tags, 600 seconds and pages of 256, with small budgets.
- Frames per minute, puts per hour, store size, claims and `get` are left out: waiting changes none of them. Blobs don't expire within a run.
- A look in the system model reads its tags in one list; several lists are `fetch.ts`'s. How much a look may take isn't modelled here.
