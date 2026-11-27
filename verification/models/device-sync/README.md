# Model: keeping your devices in step

An executable model of sharing friends, petnames, blocks, settings, chat history and invite links across one person's devices, written from `verification/specs/device-sync.md` and the docs, to choose a design before one is built.

It is TypeScript run directly by Node 24, using type stripping and no dependencies. Nothing in it is taken from the implementation's code. The design it checks is the one `verification/specs/device-sync-design.md` recommends; each rule of that design is a switch, and a planted defect turns one off.

## Running it

```sh
node --test model/                  # every test, one process (about 2 minutes)
node --test model/*.test.ts         # the same, one process per file
PIGEON_HEAVY=1 NODE_OPTIONS=--max-old-space-size=6000 node --test --test-concurrency=3 model/*.test.ts
```

`node --test model/` runs the folder as one module: `model/package.json` points it at `model/all.ts`, which loads each test file.

A plain run keeps at most 40,000 states per exploration (`model/limits.ts`), so three of the your-data scenarios stop at a bound and say so. `PIGEON_HEAVY=1` lifts it to 2,000,000, which explores every scenario to the end, and runs 3,000 random walks per scenario instead of 200 (about 3 minutes with three files at once).

## What's in it

- `explore.ts`: a breadth-first explorer over a model's steps, deduplicating states by a hash of their one spelling, so the first violation of each invariant comes with a shortest history. Each state is also settled (every letter delivered, every device run until nothing changes) and checked against the invariants that hold once mail settles. Seeded random walks go deeper than the search.
- `data-*.ts`: your data, which is friends, tombstones, petnames, blocks, settings and pair secrets. Your devices A (writes the device log), B, and C or X; friends F and G. X may be removed and hostile: it forges entries at early or current stamps, signs two entries with one number, sends them, meets your devices in the self room, and reads every letter sealed to it. Lighthouses lose letters, and devices take mail in any order, or not at all for as long as the explorer likes.
- `chat.ts`: chat history on a device that learns of a friend through your data, with messages written on every side, letters held back or expired, and the friend met live.
- `links.ts`: invite links on your other devices, options (a), (b) and (c) side by side, with the link's maker running, away, removed or replaced, and against a hostile removed device.
- `legacy.ts`: a pair from before pair secrets moving to one with two devices on the lower-id side (#158).

## Results

From `PIGEON_HEAVY=1`. Every exploration below finished, unbounded by the cap.

| Model and scenario                                  | States        | Depth   | Invariants                                                 |
| --------------------------------------------------- | ------------- | ------- | ---------------------------------------------------------- |
| Your data: friends added, renamed, unfriended       | 21,341        | 19      | all hold                                                   |
| Your data: blocks                                   | 4,960         | 15      | all hold                                                   |
| Your data: settings and petnames, a device away     | 101,159       | 18      | all hold                                                   |
| Your data: a hostile removed device                 | 179,012       | 20      | all hold                                                   |
| Your data: a removed device in the self room        | 59,887        | 17      | all hold                                                   |
| Your data: a device linked after a removal          | 32,163        | 18      | all hold                                                   |
| Your data: a tab closed before the put              | 20            | 7       | all hold                                                   |
| Your data: an entry only a newer Pigeon reads       | 258           | 10      | all hold                                                   |
| Chat history                                        | 8,210         | 14      | all hold                                                   |
| Chat history, the friend also met live              | 6,422         | 12      | all hold                                                   |
| Moving to pair secrets, two devices                 | 13            | 4       | all hold                                                   |
| Links (a), (b): maker runs, away, removed, replaced | 86 to 13,147  | 8 to 19 | all hold                                                   |
| Links (b), hostile removed device                   | 26,903        | 15      | all hold                                                   |
| Links (c): maker runs, away, removed, replaced      | 116 to 10,530 | 8 to 16 | all hold; one-sided friendships when the maker doesn't run |
| Links (c), hostile removed device                   | 30,412        | 14      | K2, K3, K5 broken                                          |

Random walks (3,000 a scenario, up to 60 steps) over the removal, self-room and link scenarios found nothing either.

Every planted defect is caught by the invariant it names, with a shortest history:

| Defect                                  | Caught by | Shortest history                                                                                 |
| --------------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| missing tombstone                       | T1        | B adds G, B checks mail, A checks mail, A unfriends G, settle                                    |
| last writer by arrival                  | W1        | A names F, C names F, settle                                                                     |
| sealed to every device ever known       | P2        | A removes X, settle                                                                              |
| secret without the log                  | P4        | A removes X, settle                                                                              |
| removed device not discounted           | R2        | A removes X, X forges an unfriend at a current stamp, sends it to B, B checks mail, settle       |
| letters from a removed device taken     | R1        | A removes X, A and B check mail, X forges and sends to A, settle                                 |
| same sealed letter put again            | P1        | A removes X, replaces the secrets, links C, checks mail; the letter is lost for B; A checks mail |
| replacement outside the outbox          | P3        | A removes X, replaces the secrets, its tab closes before it puts, settle                         |
| one unreadable entry refuses the letter | C1        | B adds G, B writes an entry only a newer Pigeon reads, settle                                    |
| no history between your devices         | H1        | settle                                                                                           |
| an entry taken twice                    | H2        | f writes, settle                                                                                 |
| shown in arrival order                  | H3        | f checks mail, settle                                                                            |
| answers taken from any device           | K1        | X answers the asker itself, settle                                                               |
| approvals counted by stamp              | K3        | X forges an approval, A checks mail, A removes X, settle                                         |
| an unnamed `pair-secret-ok`             | P3        | A and B meet the friend in the old room together, settle                                         |
| a named ok without device sync          | P3        | A meets the friend in the old room, settle                                                       |

## Bounds

- Two or three of your devices, one or two friends, one removal, and one or two of each change a person makes. Each scenario's budget is in `data-model.ts`.
- Stamps are Lamport times. A hostile device stamps as early as it can, or at the newest time it has seen.
- A history page carries one entry, and letters have no size.
- Replacement rounds are the writer's alone and honest. Their own rules under a hostile removed device are another model's subject.
- Older Pigeons and the upgrade aren't modelled. The design note says how they'd work.
