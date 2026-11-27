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

- **A shared log of your changes.** Each device appends signed entries (`add`, `tomb`, `pet`, `mute`, `block`, `setting`, link entries, `approve`, `decline`). An entry counts only from a device that is or was on your device log; each author's entries are capped at 10,000 of 1 KB. Your devices pass each other what the other lacks, by a summary that carries per author the highest number held and a digest of those entries, so two entries one device signed under one number reach every device and the lower signature wins everywhere. They do it in the self room and in one new letter kind, `mail:sync`, under the self secret's tags.
- **Stamps order, never refuse.** A device stamps a change later than its own clock and than every entry it holds about the same friend or setting. A stamp is never refused for being ahead of the receiving clock, and nobody's clock follows it.
- **Rules for what it shows.**
  - A friendship (an incarnation) lives until a tombstone names it. Nothing undoes a tombstone; only pairing again makes a new one. Of two live incarnations of one friend, the newer add shows. A friend from before the update gets an incarnation id derived from the friend's id alone.
  - Every other value takes its newest stamp. A block hides friendships added at or before it.
  - Entries a removed device stamped from its removal on count for nothing, and its letters are refused by any device that knows of the removal. Its removal time is the `at` of what took it off the latest epoch's list; a device on that list is never discounted.
- **Pair secrets beside the log, per friendship.** Each friendship's pair-secret state is its signed proposal chain: the secret made when pairing and every replacement proposal, each naming the secret it replaces. It travels sealed only to devices on the sender's list, in letters carrying its device log, which is merged first. It stays, unused, after the friendship's tombstone lands, since a removed device's tombstone can stop counting. A device is on the secret replacement rounds' rules settle on: from the first secret, the earliest proposal for the one held, counting only proposals from devices on their side's list. A claimed round counts for nothing, and a removed device's proposal stops counting once its removal is heard. A device whose secret for a friendship changes sends the chain to the friend's devices too, as replacement rounds do. A confirmed secret is a friendship's first; an unconfirmed one is never in the chain (#158).
- **Chat history by page.** The most recent 200 messages a chat go by mail, at most 50 letters a day from a device, after its your-data and secret letters. Pages name their friendship, and a device drops those of a friendship it ended. Older history catches up live.
- **Invite links, option (b).** Every device shows your links and their requests. Any device can approve or decline, as an entry naming the link, the request and the asker's key; the maker carries out the first that counts for each request it fetched, once, and acts only on a device still on its list. Only the maker's link, request and answer entries count. Link and reply secrets never go in an entry. Nothing changes for whoever asks.
- **Older Pigeons** are sealed `mail:sync` only once they say they read it. At the update, friends that differ between devices are listed for the person to settle.
- **Settled with it.**
  - Always Go Through the Relay is one setting for all your devices, newest change winning, and Settings says so.
  - Mutes sync with petnames.
  - Unfriending reaches every device, and the confirmation says "on all your devices", or names a device on an older Pigeon that won't hear it until it updates.
  - Tombstones are kept for good.
  - There is one letter kind, `mail:sync`, for every kind of data.
  - A link waiting on its maker shows "waiting for the phone", or whatever that device is called, and a new link is offered once the maker is gone. An approval lapses if the device that made it is removed before the maker acts on it.
- **First:** #150, #157 and #203.
- **After the first review round** (before anything was built), the decision was refined as above: pair-secret state per friendship, kept after a tombstone, chosen by replacement rounds' rules rather than a bare round, and sent to the friend when it changes; summaries with a digest; stamps never refused; decisions on links bound to their request and spent once; and the rules on who writes which entry. The model and the design note were changed with it.

## Consequences

What it gives: a friend, petname, block or setting changed on any device reaches the others within a mail check, with none of them online together; a device back from weeks away can't bring back a friend you removed; and history follows a friend to every device.

What it accepts, each set out in the design note:

- the window before a device hears of a removal;
- entries a removed device stamps before its removal;
- a removed device's last unsent changes;
- a fast clock winning races between changes made without seeing each other;
- two devices pairing again with one friend at once;
- an older Pigeon on the list missing an unfriend until it updates;
- a person settling friends that diverged before the update;
- Lighthouses seeing how often you change things;
- approvals waiting for the link's maker.

Ruled out:

- **Snapshots of your data**: a set can't be merged from snapshots, so a device away brings back removed friends.
- **Option (c), shared approval**: a removed device's friend record has the maker send the removed device's own secret.
- **Letting any device answer through a link**: it undoes what binding links to their maker fixed.
