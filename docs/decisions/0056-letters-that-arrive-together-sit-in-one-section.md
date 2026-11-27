# 0056: Letters that arrive together sit in one section

Unread messages that came by letter are gathered under one heading in the chat, with the details of each behind a small envelope, instead of a line above every message.

- Status: superseded by 0061
- Date: 2026-11-26

## Context

A message that came by letter said so in a line above it. After a few days away that line repeated for every message, and nothing marked where the unread ones began. [0039](0039-messages-through-lighthouses.md) put the line there; this changes only how it is shown, not what is kept or sent.

The chat keeps, per message that came by letter, the name of the Lighthouse that brought it, and nothing about when it was taken. A message's own time is its author's clock, for display only.

## Decision

- **Together means unbroken and unread.** Messages arrived together when they are a run of a friend's messages that all came by letter and that were unread when the window opened (or came in while it was open), with nothing between them: none of yours, none that came straight, no buzz, no coming or going. The run's heading counts them and names every Lighthouse they came through.
- **No time taken is kept.** Grouping by when each letter was fetched would need a new field in what's stored for letters, and would split what you meet as one: letters fetched hours apart with nothing from either side between them were all waiting when you came back. The log's order and the unread count are the data the chat already has.
- **Unread is read when the window opens.** The messages that were unread then are worked out once and kept for as long as the window is open, so reading the section doesn't dissolve it under you. The next time the chat opens it has settled: the messages sit in the normal chat like any other, with no heading and no envelope. The maintainer chose that over keeping the envelope: once read, a message's way no longer needs saying, and the chat reads the same as one that never had letters. The Lighthouse is still kept with the message, and the Today screen still says "By letter, through Loft" for what's unread.
- **Only your own Lighthouses are named.** Mail is fetched only from your own list, so every letter came through one of yours. The heading doesn't say "yours" or "theirs", as nothing could make it say the second.
- **The same words for a screen reader.** The heading is the section's name; each envelope is a button named by its details, which open on hover, click or tap.

## Consequences

A chat opened after letters came shows one heading and no extra line under each message, and nothing is stored or sent differently, so older records and other devices are unaffected. A section can span several fetches; what a reader can't see is how long the letters waited. Ruled out: a time window around each fetch (splits one stretch away into sections for no reason a reader could see), and keeping the envelope once read (a mark on every old message that came by letter, for something nobody is waiting to learn).
