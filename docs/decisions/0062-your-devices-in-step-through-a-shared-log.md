# 0062: Your devices in step through a shared log

Your devices keep friends, petnames, mutes, blocks, settings, chat history and invite links in step through a signed log of each device's changes, passed on in the self room and the self mailbox, with tombstones that nothing undoes and pair secrets sealed beside the log, never in it.

- Status: accepted
- Date: 2026-11-27

## Context

Linking copies your friends once ([0024](0024-a-signed-list-of-devices.md)). After that only the device log, your name ([0036](0036-your-name-on-all-your-devices.md)), your Lighthouse list and a count of invite links are kept in step, so a friend added on the phone never reaches the desktop, and neither do the messages with them (#138). The maintainer wants linked devices to share everything.

Constraints:

- A removed device is hostile for anything it ever sent ([0051](0051-replacing-secrets-after-a-removal.md)).
- Only a link's maker answers through it ([0060](0060-invite-links-bound-to-their-maker-for-a-week.md)).
- Shared state is per-author signed append-only logs, not a CRDT library ([0003](0003-signed-append-only-logs-not-yjs.md)).
- One sealed letter holds 44 KB, and a Lighthouse lets one address put 200 blobs a day under one tag.
- Older Pigeons keep working.

A model of the design and its alternatives, `verification/models/device-sync/`, and a design note, `verification/specs/device-sync-design.md`, set out the options, the invariants and what each planted defect breaks.

## Decision

- **A shared log of your changes.** Each device appends signed entries (`add`, `tomb`, `pet`, `mute`, `block`, `setting`, link entries, `approve`), each stamped later than anything the device has seen. Your devices pass each other what the other lacks, in the self room and in one new letter kind, `mail:sync`, under the self secret's tags.
- **Rules for what it shows.**
  - A friendship (an incarnation) lives until a tombstone names it. Nothing undoes a tombstone; only pairing again makes a new one.
  - Every other value takes its newest stamp.
  - Entries a removed device stamped from its removal on count for nothing, and its letters are refused by any device that knows of the removal.
- **Pair secrets beside the log.** A friend's secret and replacement state travel as the sender's current state, sealed only to devices on its list, in letters carrying its device log, which is merged first. A device takes a later replacement round, or a confirmed secret over its own unconfirmed one (#158).
- **Chat history by page.** The most recent 200 messages a chat go by mail, paced under the Lighthouse's limit. Older history catches up live.
- **Invite links, option (b).** Every device shows your links and their requests. Any device can approve, as an entry; the maker carries it out when it next runs, and acts only on a device still on its list. Nothing changes for whoever asks.
- **Older Pigeons** are sealed `mail:sync` only once they say they read it. At the update, friends that differ between devices are listed for the person to settle.
- **Settled with it.**
  - Always Go Through the Relay is one setting for all your devices, newest change winning, and Settings says so.
  - Mutes sync with petnames.
  - Unfriending reaches every device, and the confirmation says "on all your devices".
  - Tombstones are kept for good.
  - There is one letter kind, `mail:sync`, for every kind of data.
  - A link waiting on its maker shows "waiting for the phone", or whatever that device is called, and a new link is offered once the maker is gone. An approval lapses if the device that made it is removed before the maker acts on it.
- **First:** #150, #157 and #203.

## Consequences

What it gives: a friend, petname, block or setting changed on any device reaches the others within a mail check, with none of them online together; a device back from weeks away can't bring back a friend you removed; and history follows a friend to every device.

What it accepts, each set out in the design note:

- the window before a device hears of a removal;
- entries a removed device stamps before its removal;
- a removed device's last unsent changes;
- clocks within a day winning close races;
- a person settling friends that diverged before the update;
- Lighthouses seeing how often you change things;
- approvals waiting for the link's maker.

Ruled out:

- **Snapshots of your data**: a set can't be merged from snapshots, so a device away brings back removed friends.
- **Option (c), shared approval**: a removed device's friend record has the maker send the removed device's own secret.
- **Letting any device answer through a link**: it undoes what binding links to their maker fixed.
