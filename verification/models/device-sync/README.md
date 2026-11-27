# Model: keeping your devices in step

An executable model of sharing friends, petnames, blocks, settings, chat history and invite links across one person's devices, written from `verification/specs/device-sync.md` and the docs, to choose a design before one is built.

It is TypeScript run directly by Node 24, using type stripping and no dependencies. Nothing in it is taken from the implementation's code. The design it checks is the one `verification/specs/device-sync-design.md` recommends; each rule of that design is a switch, and a planted defect turns one off.

## Running it

```sh
node --test model/                  # every test, one process (about 3 minutes)
node --test model/*.test.ts         # the same, one process per file
PIGEON_HEAVY=1 NODE_OPTIONS=--max-old-space-size=7000 node --test --test-concurrency=3 model/*.test.ts
```

`node --test model/` runs the folder as one module: `model/package.json` points it at `model/all.ts`, which loads each test file.

A plain run keeps at most 40,000 states per exploration (`model/limits.ts`), so the larger scenarios stop at a bound and say so. `PIGEON_HEAVY=1` lifts it to 2,000,000, which explores every scenario to the end, and runs 3,000 random walks per scenario instead of 200 (a quarter of an hour or so with three files at once).

## What's in it

- `explore.ts`: a breadth-first explorer over a model's steps, deduplicating states by a hash of their one spelling, so the first violation of each invariant comes with a shortest history. Each state is also settled (every letter delivered, every device run until nothing changes) and checked against the invariants that hold once mail settles; settling that runs out of rounds fails S0, and S1 bounds the renewals. Seeded random walks go deeper than the search.
- `data-*.ts`: your data, which is friends, tombstones, petnames, blocks, settings and pair secrets.
  - Your devices are A (writes the device log), B, and C or X; the friends are F and G.
  - Each device keeps a log of signed entries. Devices swap them by summary (per author, the highest number held and a digest) and fold them into what they show (`data-fold.ts`).
  - Pair secrets are signed proposal chains per friendship, settled as replacement rounds settle them, first secrets included (`data-secrets.ts`). A device whose secret changes tells the friend (`data-tell.ts`). The friend runs the same rules (`data-friend.ts`): it forwards its proposals when its secret changes, refuses letters from a device it knows you removed, may propose a round of its own, and may remove one of its own devices, after which its writer renews. After a removal each side's writer renews every friendship whose secret was signed without knowing that removal.
  - X may be removed and hostile (`data-hostile.ts`). It forges entries at early or current stamps, a pair-secret proposal claiming a high round, and a second first secret stamped as early as it can; signs two entries with one number; sends them to your devices and to friends; meets your devices in the self room; and reads every letter sealed to it.
  - A device's clock can run a month ahead, and be removed after its changes; a Lighthouse can hold the friend's mail. Two devices can pair again with one friend at once, and in the relay scenario the friend has a second device. Lighthouses lose letters, tabs close mid-check, and devices take mail in any order, or not at all for as long as the explorer likes.
- `chat.ts`: chat history on a device that learns of a friend through your data, with messages written on every side, letters held back or expired, and the friend met live.
- `links.ts` and `links-model.ts`: invite links on your other devices, options (a), (b) and (c) side by side.
  - Each option runs with the link's maker running, away, removed or replaced.
  - Option (b) also runs with two askers, a busy answer, two approvals and a decline at once, and an approving device removed before the maker acts.
  - Options (b) and (c) run against a hostile removed device that forges an approval, a request and an answer, and answers an asker itself.
- `legacy.ts`: a pair from before pair secrets moving to one with two devices on the lower-id side (#158).

## Results

Every exploration below finished, unbounded by the cap.

| Model and scenario                                                              | States      | Depth   | Invariants                                                            |
| ------------------------------------------------------------------------------- | ----------- | ------- | --------------------------------------------------------------------- |
| Your data: friends added, renamed, unfriended                                   | 52,738      | 21      | all hold                                                              |
| Your data: unfriended and paired with again                                     | 10,976      | 17      | all hold                                                              |
| Your data: blocks                                                               | 9,811       | 17      | all hold                                                              |
| Your data: settings and petnames, a device away                                 | 161,688     | 18      | all hold                                                              |
| Your data: a clock a month ahead                                                | 7,219       | 15      | all hold                                                              |
| Your data: a hostile removed device, with a forged proposal, mailing the friend | 383,706     | 17      | all hold                                                              |
| Your data: a friendship paired before the removal is heard                      | 238         | 11      | all hold                                                              |
| Your data: a removed device in the self room, two entries one number            | 422,677     | 18      | all hold                                                              |
| Your data: a removed device forges a second first secret, mailed to the friend  | 239,899     | 20      | all hold                                                              |
| Your data: both sides remove a device of their own                              | 2,089       | 13      | all hold                                                              |
| Your data: the friend's second device passes the chain on                       | 240         | 10      | all hold                                                              |
| Your data: a fast-clocked device pairs, then is removed                         | 1,107       | 13      | all hold                                                              |
| Your data: a removed device raises the threshold and forges a first secret      | 439,575     | 23      | all hold                                                              |
| Your data: the friend's mail held while forgeries reach it                      | 56,319      | 20      | all hold                                                              |
| Your data: a removed device skips a number                                      | 242         | 11      | all hold                                                              |
| Your data: devices holding different entries of one author                      | 435         | 11      | all hold                                                              |
| Your data: a removed device stamps at the cap                                   | 7,750       | 16      | all hold                                                              |
| Your data: entries with kind names an object already has                        | 244         | 12      | all hold                                                              |
| Your data: the friend replaces a secret in the window                           | 373         | 10      | all hold                                                              |
| Your data: two devices pair again with one friend at once                       | 46          | 9       | all hold                                                              |
| Your data: a fast-clocked device removed after its changes                      | 5,719       | 16      | all hold                                                              |
| Your data: a device linked after a removal                                      | 117,909     | 19      | all hold                                                              |
| Your data: tabs closed mid-check                                                | 10,500      | 14      | all hold                                                              |
| Your data: an entry only a newer Pigeon reads                                   | 252         | 10      | all hold                                                              |
| Chat history                                                                    | 8,210       | 14      | all hold                                                              |
| Chat history, the friend also met live                                          | 6,422       | 12      | all hold                                                              |
| Moving to pair secrets, two devices                                             | 13          | 4       | all hold                                                              |
| Links (a), (b), (c): maker runs, away, removed, replaced                        | 8 to 24,973 | 4 to 20 | all hold; (c) leaves one-sided friendships when the maker doesn't run |
| Links (b): two askers, one approved, one declined                               | 204,708     | 21      | all hold                                                              |
| Links (b): the second asker busy                                                | 1,692       | 14      | all hold                                                              |
| Links (b): approved twice and declined at once                                  | 51,004      | 18      | all hold                                                              |
| Links (b): the approving device removed                                         | 4,498       | 17      | all hold                                                              |
| Links (b), hostile removed device                                               | 18,305      | 17      | all hold                                                              |
| Links (c), hostile removed device                                               | 23,322      | 17      | K2, K5 broken                                                         |

Random walks (3,000 a scenario, up to 60 steps) over the repair, removal, window, roots, self-room and link scenarios found nothing either.

Every planted defect is caught by the invariant it names, with a shortest history:

| Defect                                                                                     | Caught by | Shortest history                                                                                                                                      |
| ------------------------------------------------------------------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| missing tombstone                                                                          | T1        | B pairs with G, B and A check mail, A unfriends G, settle                                                                                             |
| secret per friend, not per friendship                                                      | P3        | A unfriends F, A pairs with F again, settle                                                                                                           |
| last writer by arrival                                                                     | W1        | A names F, C names F, settle                                                                                                                          |
| stamps refused when ahead                                                                  | C1        | C's clock runs a month ahead, C unfriends F, settle                                                                                                   |
| sealed to every device ever known                                                          | P2        | A removes X, settle                                                                                                                                   |
| secret without the log                                                                     | P4        | A removes X, settle                                                                                                                                   |
| secret by the highest round                                                                | P6        | X, still on the list, forges a proposal claiming round 50 and sends it to A; A checks mail; A removes X                                               |
| any first secret counts, the first held kept                                               | P5        | A pairs with G; X reads its first secret, forges a second stamped as early as it can and sends it to A and B; A removes X; B checks mail; settle      |
| only friendships live at the removal renewed                                               | P2b       | B pairs with G, A removes X, B checks mail, settle: everyone on the secret X read                                                                     |
| the friend's earlier proposal kept                                                         | P2b       | F proposes a replacement, sealed to X too; A removes X; settle                                                                                        |
| renewal by time, never ending                                                              | S0        | A removes X, F removes one of its own devices, settle: the two writers renew each other for ever                                                      |
| renewal by time, with a fast clock                                                         | S1        | X's clock runs a month ahead; X names F; X and A check mail; A removes X; settle: 12 renewals                                                         |
| the friend not forwarding                                                                  | P3        | A pairs with G, A checks mail, X forges a second first secret for G and mails it to G, settle                                                         |
| a relay without the other side's log                                                       | P2        | A removes X, replaces the secrets, checks mail; F's first device passes the chain to its second, which sends it to your devices sealed to X           |
| a threshold friends never see                                                              | P3        | X's clock runs ahead; X pairs with G; X and A check mail; A removes X; settle: G discounts its only first secret                                      |
| a threshold friends never see, gamed                                                       | P3        | B's clock runs ahead and B pairs with G; X raises the threshold, A removes X; X forges a first secret at the removal's time and mails it to G; settle |
| summaries by the highest unbroken number                                                   | S0        | X signs an entry skipping a number and sends it to A, settle: your devices mail each other for ever                                                   |
| stamps past entries that no longer count                                                   | W2        | A removes X; X sends B an entry at the cap; B hears, renames F at the cap; A renames F after seeing it, ties, and loses                               |
| a re-pair race settled by the friendship each device paired                                | T4        | A unfriends F; both check mail; B and A pair with F; settle: each ends the other's, and F's is gone                                                   |
| kind names looked up through the prototype                                                 | C2        | X signs an entry whose kind is `__proto__` and sends it to A, settle                                                                                  |
| the friend taking a removed device's letters                                               | R5        | A pairs with G, checks mail, removes X, replaces the secrets, checks mail; X forges a first secret and mails it to F                                  |
| the friend counting a removed device's replacement                                         | P5        | A removes X, X forges a proposal and mails it to F, settle                                                                                            |
| a removed device's first secret trusted by its marker                                      | P5        | A pairs with G, checks mail, removes X; X forges a first secret claiming it knew, mails it to G; settle                                               |
| two re-pairings left as they are                                                           | P3        | A unfriends F; A and B check mail; B and A pair with F; settle                                                                                        |
| removal stamped by the writer's clock alone                                                | W1        | X names F; X and A check mail; A removes X; settle: X's rename, which A held, stops counting                                                          |
| secret state dropped at a tombstone (with the removal stamped by the writer's clock alone) | P3        | X, still on the list, forges a proposal and an unfriend stamped past its removal and sends them to A; A checks mail, removes X; B checks mail; settle |
| the friend not told                                                                        | P3        | X, still on the list, forges a proposal and sends it to A, settle                                                                                     |
| removed device not discounted                                                              | R2        | A removes X, X forges a proposal and an unfriend at a current stamp, sends them to B, B checks mail, settle                                           |
| letters from a removed device taken                                                        | R1        | A removes X, A and B check mail, X forges and sends to A, settle                                                                                      |
| summaries without a digest                                                                 | C1        | X forges a rename and signs a second entry under its number, sends one to A and one to B; they swap by summary                                        |
| same sealed letter put again                                                               | P1        | A removes X, replaces the secrets, links C, checks mail; the letter is lost for B; A checks mail                                                      |
| letters outside the outbox                                                                 | P3        | A removes X, replaces the secrets, its tab closes before it puts, settle                                                                              |
| one unreadable entry refuses the letter                                                    | C1        | B pairs with G, B writes an entry only a newer Pigeon reads, settle                                                                                   |
| no history between your devices                                                            | H1        | settle                                                                                                                                                |
| an entry taken twice                                                                       | H2        | f writes, settle                                                                                                                                      |
| shown in arrival order                                                                     | H3        | f checks mail, settle                                                                                                                                 |
| answers taken from any device                                                              | K1        | X answers the asker itself, settle                                                                                                                    |
| approvals counted by stamp                                                                 | K3        | X forges an approval, A checks mail, A removes X, settle                                                                                              |
| approvals that name no request                                                             | K8        | B checks mail, a person approves q1 on B, settle: q2 is added                                                                                         |
| decisions not spent                                                                        | K7        | A and B both approve q1, settle: q1 hears two answers                                                                                                 |
| request and answer entries from anyone                                                     | K9        | X forges a request and a `declined`, settle                                                                                                           |
| an unnamed `pair-secret-ok`                                                                | P3        | A and B meet the friend in the old room together, settle                                                                                              |
| a named ok without device sync                                                             | P3        | A meets the friend in the old room, settle                                                                                                            |

## Bounds

- Two or three of your devices, one or two friends, one or two askers, one removal, and one or two of each change a person makes. Each scenario's budget is in `data-model.ts` and `links-model.ts`.
- A device's clock moves with its own actions and can jump ahead once; clocks don't move while mail settles. A hostile device stamps as early as it can, or at the newest time it has seen.
- A history page carries one entry, and letters have no size.
- The writer proposes after a removal and a hostile removed device proposes one of its own; rounds from the friend's side, and rounds two deep, aren't explored.
- The friend has one device, which may propose one round and remove one device of its own; what that removed device reads isn't tracked.
- Older Pigeons, the update, recovery epochs, entries from keys never on the device log, size caps, and link and reply secrets aren't modelled; the spec's §7 says how each is handled.
