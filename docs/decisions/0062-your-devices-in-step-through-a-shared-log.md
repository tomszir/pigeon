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

- **A shared log of your changes.** Each device appends signed entries (`add`, `tomb`, `pet`, `mute`, `block`, `setting`, link entries, `approve`, `decline`). An entry counts only from a device that is or was on your device log; each author's entries are capped by number, at 10,000, of 1 KB each, so every device refuses the same ones. Your devices pass each other what the other lacks, by a summary that carries per author the highest number held and a digest of those entries, so two entries one device signed under one number reach every device and the lower signature wins everywhere. They do it in the self room and in one new letter kind, `mail:sync`, under the self secret's tags.
- **Stamps order, never refuse.** A device stamps a change later than its own clock and than every entry about the same friend or setting that counts on it. A stamp is never refused for being ahead of the receiving clock, only for being above the cap (2^53 − 2^32): such an entry counts for nothing but is kept for catching up, and a device's own stamps stop at the cap; nobody's clock follows it.
- **Rules for what it shows.**
  - A friendship (an incarnation) lives until a tombstone names it. Nothing undoes a tombstone; only pairing again makes a new one. Of two live incarnations of one friend, the newer add shows until a device that holds one's secret sees the friend in it (its hello in those rooms, or a letter from one of its devices under those tags), which then ends the other; the friendship a device paired is no evidence of where the friend is. A friend from before the update gets an incarnation id derived from the friend's id alone.
  - Every other value takes its newest stamp. A block hides friendships added at or before it.
  - Entries a removed device stamped from its removal on count for nothing, and its letters are refused by any device that knows of the removal. The threshold is the removal's own `at`: the writer stamps the device-log entry that removes a device (or the `recover` that leaves it off) later than every entry it holds from that device that counts, and never above the cap, so it always fits in the device log, and the threshold travels wherever the device log does, friends and older Pigeons included, and is written in the same entry as the removal. It never moves the writer's clock; a device on the latest epoch's list is never discounted.
- **Pair secrets beside the log, per friendship.** Each friendship's pair-secret state is its signed proposal chain: the secret made when pairing and every replacement proposal, each naming the secret it replaces. It travels sealed only to devices on the sender's list, in letters carrying its device log, which is merged first. It stays, unused, after the friendship's tombstone lands, since a removed device's tombstone can stop counting. A device is on the secret replacement rounds' rules settle on: from the first secret, the earliest proposal for the one held, counting only proposals from devices on their side's list. A claimed round counts for nothing, and a removed device's proposal stops counting once its removal is heard. A first secret counts as an entry does (from a device on the list, or a removed one if stamped before its removal), and of several the earliest wins. Every proposal carries signed the removals its maker had merged. After a removal, each side's writer renews every live friendship whose secret was signed without knowing that removal, or made by the removed device, so nothing the removed device read in the window stays in use; a renewal knows the removal, so renewals end: one per friendship and side for the removal, plus one for each rival signed without knowing it. The friend runs the same rules, forwards its proposals when its secret changes, and refuses letters from a device it knows you removed. A first secret carries its add's stamp. A device whose secret for a friendship changes sends the chain to the friend's devices too, as replacement rounds do. A confirmed secret is a friendship's first; an unconfirmed one is never in the chain (#158).
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
- **What this replaces in replacement rounds.** The marker each proposal carries replaces the `begun` rule, and the whole chain per friendship replaces keeping only the round before and `prior`; the rest of the rounds' rules stand.
- **After the first review round** (before anything was built), the decision was refined as above: pair-secret state per friendship, kept after a tombstone, chosen by replacement rounds' rules rather than a bare round, and sent to the friend when it changes; summaries with a digest; stamps never refused; decisions on links bound to their request and spent once; and the rules on who writes which entry. The model and the design note were changed with it.
- **After the second review round**, also refined: first secrets counted and chosen like replacements; the writer renewing whatever the removed device may have read; a removal stamped after what the writer held; two re-pairings settled by the friend; and protocol.md's removing-a-friend text to change as the design note says.
- **After the third review round**, also refined: renewal decided by the knowledge each proposal carries rather than by time, so it ends when both sides run it; the removal's threshold kept apart from the writer's clock; the friend forwarding and refusing as above; and the model checking that settling ends.
- **After the fourth review round**, also refined: a letter carrying a chain carries both sides' newest device logs, merged before sealing, between one side's own devices too.
- **After the fifth review round**, also refined: the threshold moved from a `removal-threshold` entry in your shared log, which friends never received, into the removal's own device-log `at`, so a friend judges a removed device's first secret by the same threshold as your devices. A stolen device that stamped an entry far ahead while on the list pushes that `at` out as far, so its chat messages dated before it keep counting after the removal; that is accepted, and chat measures nothing but `at`.
- **After the review of the first build**, also refined: fold reads only kinds it owns, so a kind name like `__proto__` or `constructor` is unreadable, never a failure; a device settles a re-pair race only on the friendship it has seen the friend in. Also: a summary gives the highest number held, not the highest unbroken, and one digest of the entries held up to it (no list of missing numbers), so a removed device skipping a number can't keep your devices sending, and an entry a device won't act on is still kept and counted; the per-author cap is on entry numbers, so devices never refuse different entries and resend them to each other for ever; every string another device controls (kind and setting names, friend, person, incarnation, link and request ids) is looked up only as a name the table itself holds; a change's stamp follows only entries that count, so a removed device's entry stamped at the cap can't push later changes there; an entry above the cap counts for nothing (kept for catching up) and a device's own stamps stop at it. A device that still counts can stamp at the cap and freeze one register's order to device ids; that is accepted, and a causal pointer, considered for it, was not taken.
- **After the review of the threshold in the device log**, also refined: a removal's `at` follows only the removed device's entries that count and stops at the cap, so an entry it stamped above the cap while still on the list, which counts for nothing, can't push the removal past the whole numbers a device log takes and leave the device impossible to remove.

## Consequences

What it gives: a friend, petname, block or setting changed on any device reaches the others within a mail check, with none of them online together; a device back from weeks away can't bring back a friend you removed; and history follows a friend to every device.

What it accepts, each set out in the design note:

- the window before a device hears of a removal;
- entries a removed device stamps before its removal;
- a removed device's last unsent changes;
- a fast clock winning races between changes made without seeing each other;
- two devices pairing again with one friend at once, connecting until the friend is seen in one;
- a removed device's last changes the writer never held, when its clock ran fast;
- an older Pigeon on the list missing an unfriend until it updates;
- a person settling friends that diverged before the update;
- Lighthouses seeing how often you change things;
- approvals waiting for the link's maker.

Ruled out:

- **Snapshots of your data**: a set can't be merged from snapshots, so a device away brings back removed friends.
- **Option (c), shared approval**: a removed device's friend record has the maker send the removed device's own secret.
- **Letting any device answer through a link**: it undoes what binding links to their maker fixed.
