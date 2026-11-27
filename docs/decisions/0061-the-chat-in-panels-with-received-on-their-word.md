# 0061: The chat in panels, with Received only on their word

Messages are drawn as panels with at most a small mark each, what came by letter while you were away is one pixel envelope, and "Received" is said only when the friend has said they hold the message.

- Status: accepted
- Date: 2026-11-27

## Context

The chat drew each message as a line, with a status icon after every message of yours, a line of words under the newest, and, for what came by letter, a brown section with an envelope icon on each message. After a few days away or a long conversation that was busy, and most of it said nothing anyone was waiting to learn. [0039](0039-messages-through-lighthouses.md) put those words there and [0056](0056-letters-that-arrive-together-sit-in-one-section.md) grouped the unread letters under a heading. The maintainer chose a simpler screen from three rounds of previews.

A message sent while the friend was online went straight to them, and the chat said nothing for it. The data for a stronger claim exists: each device of theirs sends a `log-sync` on connecting, whose summary says how far it holds each author's entries.

## Decision

- **Panels, not lines.** Yours on the right in Luna blue, theirs on the left in warm grey, with the friend's bird beside the last panel of a run, a time on the last panel of each minute and a day line between days. Groups are left out; their format comes with groups.
- **Marks, option A.** Only the newest message of yours and any not yet received carry a mark, in the panel's corner: a grey tick for Mailed (a Lighthouse took it), two blue ticks for Received, two blue arrows for sealing. A failure always keeps its warning, a red "Not mailed yet" line with Try Again. "Waiting for Jo to be online" is quiet text and nothing else is red.
- **Received is on their word.** It is said for a receipt of the letter that carried the message, or a sync of theirs whose summary holds the message's sequence. The chat keeps the highest each author's entries any device of theirs has said it holds, with the friend's letters, and it only grows. A message that went straight to a friend who was online has no mark until a later sync of theirs holds it, and never over-claims before. Staying connected for a few seconds, or being answered a sync, still decides what is mailed (nothing is mailed twice for it) but isn't called received. Nothing is added to what is sent, signed or stored by a Lighthouse; a friend can already say anything in a receipt, so a sync's word is no weaker.
- **One envelope for what came by letter.** The unread messages from a friend that came by letter, with nothing else between them, are one panel from the friend with a pixel-art envelope. Opening it plays a few stepped frames and lets the messages in as ordinary panels under one etched line, "3 messages by letter, through Loft". The grouping rule, the unread rule and the naming of every Lighthouse are as [0056](0056-letters-that-arrive-together-sit-in-one-section.md) has them; only how the group is drawn changes, so 0056 is superseded.
- **No dark theme.** The previews' dark frames were only a check of legibility.

## Consequences

The chat reads as plain panels once messages settle, and a message that didn't reach anyone says so in red. A message sent straight to a friend usually shows nothing until they next connect, then settles as received without ever having over-claimed. The tooltips on the old icons are gone: where a message was left is in the Mailed tick's tooltip, and the Lighthouses a letter came through are in the envelope's line. New assets are the two ticks, recoloured from the XP checkmark, and the airmail letter with its opening frames, in `assets/brand/`. Ruled out: a dark theme; showing every message's mark all the time; a per-message "Received" from staying connected, which would claim a message the friend's Pigeon never took.
