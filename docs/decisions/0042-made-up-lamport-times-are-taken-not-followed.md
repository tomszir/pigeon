# 0042: Made-up Lamport times are taken, not followed

A chat entry with a Lamport time far ahead of the log is taken like any other, and the chat's clock follows a time only when it's within 2^20 times its rank in the log, rather than the entry being refused.

- Status: accepted
- Date: 2026-11-26

## Context

A chat is a set of signed append-only logs, one per device, merged and sorted by Lamport time. Each new entry took the highest time held plus one, with no limit, so a friend could send an entry at 2^53 - 1: the next entry anyone wrote in that chat was 2^53, which isn't a safe integer, and every peer's shape check refused it along with the whole batch it came in. The friend could stop a chat from syncing with one entry.

The obvious fix is to refuse an entry whose time leads the highest the receiving log holds by too much. Reviewing that showed it makes whether an entry is taken depend on what the receiver already holds, and that devices can be made to hold different things: a friend, or a device of theirs that is later stolen or removed, sends one of your devices a high time and another a low one for the same sequence number. The first device's replies then build on the high time, and the second refuses them, and everything after them, for good. Letters make it worse, since a refused entry that came by mail is still receipted and never sent again. Exempting your own devices' entries fixes one side of this but not the other, because the poison can sit on the receiving side's own devices.

Taking every entry but leaving far-ahead times out of the clock has to be done so that what's followed doesn't hinge on one entry. Stopping at the first jump of more than 2^20 between times fails that: a device that took a friend's steps up follows them, one that didn't stops early, and its replies sort above the messages they answer. Capping the clock at 2^20 per entry held fails too: after one made-up time, every new time is about the writer's entry count times 2^20, and a replier holding fewer entries than the writer ties with the question or sorts below it.

## Decision

- An entry that verifies is taken whatever its Lamport time, as long as it's a safe integer (the existing shape check); taking it never depends on the receiving log.
- A new entry's time is one past the highest time held that is at most 2^20 times its rank, the number of entries sorting at or below it, and never past 2^53 - 1. A time higher than that is held and shown but not followed.
- A catch-up never offers an entry whose time isn't a safe integer, so a log that already holds one can't poison a batch.

## Consequences

- No honest entry is ever refused for its time, and no device writes a time a peer refuses, so no device can be cut off from another by one, and syncing never stops.
- An honest time is never more than the number of entries in the chat, so in a chat with no made-up times every device follows every time, and a device that holds a message writes after it.
- A made-up time far past 2^20 times its rank, the 2^53 - 1 of the original problem among them, is never followed and moves nobody's clock.
- A made-up time placed at the edge of its rank's limit is followed by a device that holds it, and that device's next message gets a time just past it. A device that lacks the made-up entry, because the friend held it back or because it came from a device the friend has since removed, may not follow that message's time, and its reply then sorts above the message it answers. It takes the friend one entry and an uneven delivery; it changes only the order shown, never what is delivered, and the next message the second device writes after catching up sorts correctly.
- Followed times rise to at most 2^20 times the number of entries in the chat, so pushing the clock to the limit takes about 2^33 entries, which isn't feasible.
- A made-up time stays in the chat, shown after everything else, and messages written afterwards sort above it.
- A log that already holds an entry of your own past a safe integer never sends it, so peers' summaries of you stop below it: what you wrote after it is offered again on every catch-up. Only a log written to after a made-up time, before this change, can hold one.
- Backdating, an entry with a time lower than the replies it answers, isn't prevented: a Lamport time is its author's claim about what they had seen, and nothing can check it. Like the case above, it only changes the order shown.
- This departs from the issue's wording, which asked for such entries to be refused; refusing is what was ruled out above.
