# 0039: Messages through Lighthouses

A message written while a friend isn't connected is left in their mailbox at their Lighthouses as a letter, so it reaches them when they next open Pigeon even if you're offline by then.

- Status: accepted
- Date: 2026-11-25

## Context

A chat message today waits in your own Pigeon until you and your friend are online together; if you close Pigeon first, they never get it until you're both back. The M16 mailbox ([0037](0037-the-lighthouse-and-its-mailbox.md)) already carries farewells, your devices' news and invite links, sealed to the recipient's devices under daily tags from the pair secret. The roadmap's M4 asks for letters through it, receipts, and showing who carried each one, and also for forward secrecy with one-time prekeys and letters carried by online mutual friends.

Chat entries are already signed log entries that any of the two sides' devices merge with the same checks, whatever route they came by.

## Decision

- **A letter carries chat entries.** It's a `mail:letter` sealed to the friend's devices still on their list, under the pair secret's tag for that day, at every Lighthouse on their list (the official ones when unknown). Its body is `{ log, entries }`: the chat's id and a batch of your own signed entries, at most 50 and 40 KB, so the sealed letter fits a Lighthouse's 64 KB.
- **When a letter goes.** When you send a message and none of your friend's devices is connected, your Pigeon waits 5 seconds for more (a burst of messages is one letter), then mails every entry of yours the friend hasn't been seen to have. A message sent while they're connected goes as now, and counts as theirs once they've stayed connected 3 seconds; if they drop before that, it goes by letter too.
- **Taking a letter in.** The friend's Pigeon merges the entries into the chat with the checks `log-sync` uses (signed for this chat, by a device on your list, the first entry seen for a sequence wins), so a letter and a later sync never disagree and order of arrival doesn't matter. It counts them as unread, as messages that arrived live are.
- **Receipts and resends** are the mailbox's: each of their devices that takes a letter puts a receipt back, and an entry stops being mailed once a receipt or a sync shows they have it. Resends come every 3 days for at most 30 days, as all mail does. Each Pigeon keeps at most 50 letters waiting per friend.
- **Saying where a message is.** Each of your messages shows its state in the chat: sealing, "Left at Loft and Dovecote for when Jo's back" (the Lighthouses that took it), and "Jo has it" once a receipt or a sync says so. Each message that came by letter says "Came by letter while you were away, through Loft". One that can't be left anywhere says it waits until they're online.
- **Older Pigeons** don't fetch `mail:letter`, so they get your messages as now, when you're both online.

### For later

- **One-time prekeys** for forward secrecy, a good deal later. Until then a letter is sealed to a device's long-term sealing key, as farewells are: someone who later steals that device's key could open letters still held at a Lighthouse, for up to 30 days. The maintainer judged that acceptable for now: someone holding your friend's unlocked device has more than Pigeon's letters. Prekeys get a decision of their own.
- **Mutual friends as carriers.** (Your own other devices getting the letters you sent, also listed here at first, was built soon after, with a copy of each letter in the self mailbox: see the protocol.)

## Consequences

Messages reach friends who are offline, and you can close Pigeon right after sending. A burst of messages is one letter, so Lighthouses see about one blob per conversation pause rather than per message. What a Lighthouse learns is what 0037 says of any tag. Until prekeys, a stolen sealing key exposes the letters still waiting for that device.

Ruled out:
- **A letter per message**: more blobs, more puts, more for a Lighthouse to see.
- **A new message format**: letters carry the chat's own signed entries, so there's one way to check them.
