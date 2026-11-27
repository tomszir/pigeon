# 0063: Waiting for mail, as modelled

Waiting for mail at a Lighthouse is built as [0055](0055-waiting-for-mail-at-a-lighthouse.md) says, with the twelve points found reading it settled by a model, waits counted against their range by tags rather than by connections, a look over several lists that never passes a blob it hasn't listed, and an ask during a letter run kept for after it.

- Status: accepted
- Date: 2026-11-27

## Context

0055 decided that a connected Pigeon may ask a Lighthouse to answer one held `wait` as soon as mail is put under tags it names, and that the wait's state machine is modelled before any code. Reading it before modelling turned up twelve points (#144): four where it was wrong or unsafe as written, eight gaps. Two bugs belong with it: a look over more than one list saves the furthest cursor any list reached, which passes a blob put under a list that finished while another was still reading, and a mail check's `resume` that comes during a letter run is lost (#126); waits bring looks and checks closer together, so both come up more often. How much one look may take from a Lighthouse (#170) is left to a design of its own.

The model is `verification/models/lighthouse-wait/`, written from `verification/specs/lighthouse-wait.md`: a reference Lighthouse for Node and the Worker, Pigeons that look, wait, reconnect and turn waiting off, a look over several lists with mail put while it reads, and letter runs. Each rule below is a switch in it, and turning any off is caught.

## Decision

Everything in 0055 stands, except where this says otherwise.

### At the Lighthouse

- **Waits count against their range by tags.** `waitingPerRange` (16 waiting connections) and `waitingPer48` (64) become `waitedTagsPerRange` (2,048) and `waitedTagsPer48` (8,192): the tags those waits could hold at 128 each, so no range gets more of the index than before, while about 60 Pigeons with 30 tags each fit behind one carrier address instead of 16. `maxWaitedTags` (200,000) stays.
- **Only waits heard from count.** A waiting connection that has sent neither a frame nor a keepalive for the idle time (120 seconds) counts toward no limit, isn't woken, and is closed when it's noticed: when waits are counted, at a wake, at the hourly alarm, or when room is wanted. Closed, not just skipped, so it can't come back with a keepalive and push a range past its budget after someone else took its room.
- **The Worker's read counts live in memory**, as its other counts do, so they start again when it sleeps; the model holds it to that rather than to Node's counts across a sleep.
- **Keepalives count as hearing from a connection on both Lighthouses.** The Worker reads the runtime's auto-response timestamp beside the time of the last frame. A keepalive is no request and counts against no limit on either.
- **A new wait ends the standing one first**, with `lease`, whatever then happens to the new one: refused, answered at once, or standing.
- **The Worker catches up after a reset.** It keeps one number in its storage, `wokeThrough`, the highest seq whose wakes have all been sent, written after each put's wakes. Waking with its memory lost, it wakes the waits that blobs past `wokeThrough` are news to, before it answers any lease that has passed. The store doesn't say who put a blob, so this catch-up may wake a blob's putter or a wait whose lease ended since the put, once.
- **Closing for room.** A new connection that finds no room closes idle connections first, then the waiting connection whose wait has stood longest among those counted against every limit that's full (its range's, its /48's, everyone's), so closing it makes room, with code 1013 and the reason `room`. Only if none can be closed is the newcomer refused.
- **What "a put doesn't depend on waits" means.** A put's reply and the store come out the same whatever waits stand, and the reply goes before any wait it wakes is answered. A wait is still a frame and a read, counted like a list.

### At the Pigeon

- **A wait follows only a look that read its Lighthouse to the end**: nothing refused, nothing failed to get, nothing held back by a source's limit. Otherwise its tags would hold a blob past its cursor and every wait would be answered at once.
- **A wait's tags come from the look before it**: today's, yesterday's in the first two hours of the UTC day and tomorrow's in the last two, by that look's clock, which are always among what it listed. Sent again after a drop, the wait names the same tags with what's left of its lease.
- **Turning waiting off, or relay-only on, closes every connection with a wait standing**, so the Lighthouse stops learning presence at once.
- **Closed for room, a Pigeon waits for its next scheduled look** before it opens that connection again. Other drops are reopened while Pigeon is on screen, after 5 seconds doubling to 5 minutes, and the doubling starts again once a wait has stood a minute or been answered.
- **The cursor saved never passes a blob not yet listed.** A look reads its tags in lists of 512, each to its end. The cursor it saves is the least over the lists, a finished one counting as far as anything had been answered before its last page was asked for, since a blob put after that has a later seq. A list that finished before the others got that far is asked once more at the end. A look that didn't finish saves no cursor and keeps the last look's days, as it does now.
- **An ask during a letter run is kept.** A `wrote` or `resume` that comes while a friend's run is under way runs once more when the run ends, if anything is still to be mailed. A run that stops at the cap of letters waiting for receipts starts nothing by itself.

### How it's checked

The implementation passes the model's conformance traces (`model/conformance.ts`): random traces the reference makes as it runs, which each Lighthouse, through its own tests, must answer exactly as the reference does, connection by connection, with every put's reply before its wakes. The client's look and letter runs are tested against the model's cases: every small store over several lists, mail put while a look reads, a Lighthouse that stops answering partway, and a resume during a run.

## Consequences

The twelve points each have an invariant, and the model shows the design keeps them on Node and on the Worker. Many Pigeons behind one carrier address can all wait, without anyone getting more of the index. A Pigeon that turns waiting off stops showing it's there. A hostile Lighthouse can't use waits to make a Pigeon look again and again: a look that didn't finish sends no wait. One look still takes everything a Lighthouse lists.

The Worker writes one number to storage after each put that woke someone, never a tag or a connection's waits. After a reset it may wake a putter's own wait, or one whose lease ran out, once.

Ruled out:

- **Counting waits per connection**, as 0055 did: it leaves out people behind shared addresses.
- **Skipping quiet waits without closing them**: they come back and push a range past its budget.
- **Re-checking every standing wait each time the Worker wakes**: it would cost a query per wait on every put after a quiet spell, where `wokeThrough` costs one number.
- **Saving the furthest cursor of the lists**, as a look did: a blob put under a list that finished while another was still reading was passed by.
- **Looking again on a cue after a look that didn't finish**: a Lighthouse that never lets a look finish would keep a Pigeon looking every few seconds.
