# Keeping your devices in step: a design note

A proposed design for sharing friends, petnames, blocks, chat history, invite links and settings across a person's linked devices, for the maintainer to choose from. It is checked by the model in `verification/models/device-sync/` against the invariants in `device-sync.md`. Nothing here is built.

## 1. Recommendation in brief

- **One shared log of your own changes.** Each device keeps a signed, append-only log of the changes a person makes on it: friend added, friend ended, petname, mute, block, setting. Your devices pass each other the entries the other lacks, the way a chat catches up, both in the self room and through the self mailbox. What a device shows is worked out from all the entries it holds, so the same entries give the same result on every device, whatever order they came in.
- **Conflicts.**
  - A friendship is a set entry that only a tombstone ends, and nothing undoes a tombstone.
  - A petname, mute, block or setting goes to the entry with the newest stamp (newest-wins per field, with your name's clock rule).
  - Entries a removed device stamped from its removal on don't count.
- **Pair secrets move beside the log, never in it.** Each friend's secret, and any replacement under way, is carried as the sender's current state. It is sealed only to devices on the sender's list, in letters that also carry the sender's device log. A device takes a secret only if it is a later replacement round than its own, or if its own was never confirmed.
- **Chat history by page.** A device sends your other devices the chat entries they aren't known to hold, at most 50 entries and 40 KB a letter. The most recent 200 messages per chat go by mail; deeper history catches up live, as today.
- **Invite links: option (b).** Every device shows your links and the requests on them. Any device can approve, which records "add them" in the shared log. The device that made the link carries it out the next time it runs, as the only device whoever asked takes an answer from. If that device is gone, the requests show it, as in option (a).
- **First, four fixes:** #150, #157 and #203 before any of this, and #158 with the pair-secret part (§8).

The model holds every invariant under this design and catches each planted defect (§9).

## 2. What syncs today, and what this adds

Today a link bundle copies your friends once. Afterwards only the device log, your name and personal message, your Lighthouse list and a count of each device's invite links are kept in step. A friend added on one device is never seen by the others, and copies of what you write to that friend are dropped there, because a device takes a copy only into a chat it already has.

| Data                                   | Carried as                                                                                                 | Conflict rule                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A friendship                           | `add` entry: friend id, incarnation id, when added                                                         | live until a `tomb` names its incarnation; a tomb is never undone                                  |
| Ending it (unfriend)                   | `tomb` entry naming the incarnation                                                                        | permanent; pairing again makes a new incarnation                                                   |
| Blocking                               | `tomb` for each live incarnation, and `block: true`                                                        | newest stamp wins; a block hides friendships added before it                                       |
| Unblocking                             | `block: false`                                                                                             | newest stamp wins                                                                                  |
| Petname, mute                          | `pet` and `mute` entries per friend                                                                        | newest stamp wins                                                                                  |
| Settings                               | `setting` entries, one per key (Always Go Through the Relay)                                               | newest stamp wins                                                                                  |
| The friend's card                      | state, not log: name, device log, sealing keys, Lighthouses, as the friend signed them                     | the friend's device log rules; keys only signed by their own device                                |
| The pair secret                        | state, not log: current secret, replacement round under way and before, sealed only to devices on the list | a later round wins; an unconfirmed secret gives way to a confirmed one                             |
| Chat history                           | chat entries as they are, in pages                                                                         | sorted union, as `log-sync`                                                                        |
| Invite links, requests                 | entries from the maker: link made, request waiting, request answered; `approve` entries from any device    | the maker's entries are the truth; an approval counts only while its device is on the maker's list |
| Name, message, Lighthouses, device log | unchanged                                                                                                  | unchanged                                                                                          |

**Why a log of changes, not snapshots.** The self mailbox's snapshot (`mail:self`) works because it has one value per field and a time. Friends are a set, and a set can't be merged from snapshots: a friend missing from a snapshot may have been removed, or may never have been heard of. That gap is how a device that was away brings back a friend you removed. A log of signed changes, passed on until every device holds every entry, is what Pigeon already does for chats (signed append-only logs, one per author). It needs no new library, and every entry says who made it, which is what lets a removal discount a removed device's entries.

**Why per-field newest-wins, not a richer CRDT.** Everything except the friend set is a single value a person sets, and the friend set is an observed-remove set, which the tombstones give. The stamp is your name's rule: later than anything the device has seen, and refused when more than a day ahead of the receiving clock. So a change made after seeing another beats it, whatever the clocks say, and a device back from days away can't bring an older value back.

**An entry** is `{ v: "pigeon/your-data/v1", identity, device, n, stamp, kind, ... }`, signed by the device. `n` counts that device's entries from 1. The kind (`add`, `tomb`, `pet`, `mute`, `block`, `setting`, `approve`, `link`, `request`, `answer`) is in the signed bytes, so an entry can't pass as anything else Pigeon signs. Two different entries from one device with the same `n` can only come from that device. Every device keeps the one with the lower signature bytes, so they still converge.

**An incarnation id** is 16 random bytes made when a friendship begins (pairing, an invite link, an `added`). A friend from before this update gets one derived from the friend's id and `addedAt`, so every device holding a copy from the same link bundle derives the same id.

**The letter.** One new kind, `mail:sync`, under the self secret's tags, sealed to your other devices on the sender's list that said they read it (§7). Its body is the sender's device log, a page of entries the recipient isn't known to have, the friend cards and secret states that changed, and chat pages, up to one sealed letter (44 KB). One kind for everything, rather than one per kind of data: every kind needs the same sealing, the same device-log-first rule and the same recipients. A Lighthouse can't tell kinds apart anyway, and fewer kinds means fewer ways for a check to differ. In the self room the same content goes as `sync-summary` (how far this device holds each device's log, as `log-sync` does) and `sync-entries`, on a connection proven by a device on the list.

**When a letter goes.** 5 seconds after the last change, so a burst goes as one letter, as letters to friends do. Also at every mail check that took something its other devices may lack, and through the outbox, put again every 3 days until each recipient's receipt comes. A newer letter replaces an older one still waiting on the same devices. A put again is sealed again to the list as it is then.

## 3. Pair secrets and removed devices

- A pair secret is never an entry, because an entry is kept for good and passed to every device linked later. It travels as each device's current state for that friend: the secret, and the replacement round under way and the one before, which is what a link bundle already carries.
- Every letter that carries one carries the sender's device log, and every mail check merges every log it fetched before acting on anything. So a device holding a secret made after a removal has heard of that removal, and never seals the secret to the removed device (P4, P2).
- A device adopts another's secret for a friend only when it is a later replacement round, or when its own was never confirmed by the friend (§8, #158). A replacement still happens only through the existing replacement rounds; your-data sync only carries their outcome to devices that missed it.
- A removed device's entries stamped from its removal on count for nothing. Its letters are refused by a device that knows of the removal, and its entries stamped before the removal are its own word (R2, R3).
- A device that hasn't yet heard of a removal still treats the removed device as yours, and can seal it a secret made in that window. That stops when it merges the log. It is the window threat-model.md already describes for friends who haven't seen the newer list.

## 4. Chat history

- **A device that learns of a friend** gets the chat from your other devices: they send the entries it isn't known to hold, a page a letter, newest first. "Known to hold" is what its receipts and its own letters said, kept per device as for letters to friends. An expired page's entries are sent again.
- **A copy for a chat a device doesn't have yet** is left, not receipted, and taken once the friendship arrives, as letters from friends already are.
- **History depth.** The most recent 200 messages per chat by mail, because a chat can be large. A message is at most 4000 characters, so a 40 KB page holds 9 messages at worst and 50 (the cap) usually; 200 messages is 4 to 23 letters. Older history catches up live, in the pair room, the first time both devices are online with the friend there (`log-sync`, as today), or from an export file.
- **Pacing.** A Lighthouse lets one address put 200 blobs a day under one tag, and all your self mail on a day shares one tag. So history goes at most 100 letters a day from one device, the newest chats first, and the rest the next day. A new device with 50 long chats has their recent messages within a day, and deeper history as it meets your other devices.
- **Deletions.** Pigeon has no message deletion: an entry holds text. Unfriending deletes the chat on every device. Pairing again brings back what the friend's devices send in their catch-up, as on one device today.
- **Attachments.** Files aren't built. When they are, history carries the chat entry that names a file, not the file.

## 5. Invite links on your other devices

Only a link's maker answers through it, and whoever opens or asks through it takes cards and answers only from that device. Every option keeps that on the asker's side; they differ in who decides and who makes the pair secret.

| Option                                    | Approve on another device?              | Maker away for good                                                     | Maker removed                                    | Maker replaced (linked again under a new id) | A hostile removed device                                                                                                                                             | Keeps the maker-bound guarantees?                     |
| ----------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **(a)** see only                          | no                                      | requests wait, shown on every device; no answer                         | the link goes silent, as today; requests show it | as removed: the new id isn't the maker       | nothing                                                                                                                                                              | yes                                                   |
| **(b)** ask the maker (recommended)       | yes; carried out when the maker runs    | the approval waits, shown as "waiting for the phone"; nothing one-sided | as (a); its pending approvals lapse              | as (a)                                       | nothing: an approval counts only while its device is on the maker's list when the maker acts (K3), and the maker makes the secret itself                             | yes                                                   |
| **(c)** share the approval                | yes; your side shows the friend at once | your side shows a friend who never hears they were added                | as away, for good                                | as away, for good                            | breaks: a removed device's friend record, stamped before its removal, has the maker send the removed device's own secret (K2), and two records can disagree (K3, K5) | on the asker's side, but the secret isn't the maker's |
| (d) any device answers, its own signature | yes                                     | works                                                                   | works, and so does the removed device            | works                                        | adds people as you through any link it heard of                                                                                                                      | no: it is what binding a link to its maker replaced   |

What the model found (`links.test.ts`, every history explored):

- (a) and (b) hold K1–K5 under every condition, and (b) against a hostile removed device too.
- (c) holds with the maker running. With the maker away, removed or replaced, it ends with your devices showing a friend who was never added. Against a hostile removed device it breaks K2, K3 and K5.
- Under every option, a maker removed just after approving, before its letter reached another device, leaves the person added and your devices not knowing. That is the "last changes of a removed device" residual (spec §5), which the model reaches as "one side only" in (a) and (b) too.
- Planted defects: answers taken from any device (K1); approvals counted by stamp rather than by the list when the maker acts (K3).

**Pick: (b).** It is the only option that lets you approve anywhere and changes nothing the asker relies on. What it costs: an approval made on the desktop takes effect when the phone next runs. Every device shows that, says which device made the link, and offers a new link when that device is gone.

## 6. What Lighthouses see

- **Today**, under your self tag, a Lighthouse sees: a `mail:self` snapshot when a name, Lighthouse list, device or link changes; a copy of each letter you send a friend; and replacement letters. It sees each blob's size, when it was put and fetched, and how many devices it was sealed to.
- **With this**, it also sees a blob within seconds of each change you make (a petname, a block, a setting), and bursts of history pages when a device learns of a friend or is linked. The tag still changes daily and still names nothing. A Lighthouse can't tell `mail:sync` from other self mail, because the kind is checked inside the seal.
- **What leaks more:** how often you change things, and roughly how much history a new friend or device brought.
- **Mitigation:** pad `mail:sync` letters to 4, 16 or 40 KB, batch changes, and pace history (§4). Padding costs at most 36 KB a letter, and history pages are near 40 KB anyway.

## 7. Older Pigeons on some devices

- **A device on an older Pigeon** can't open `mail:sync`: its kind isn't one it knows, so it would leave the letter, and the sender would put it again every 3 days for 30 days. So each device says in its own `mail:self` snapshot, and in its self-room hello, which kinds it reads. `mail:sync` is sealed only to devices that said so. An older device stays as it is today: it gets your name and Lighthouses, keeps its own friends, and its changes don't reach the others.
- **The upgrade.** On its first start with this, a device writes entries for what it already holds: an `add` per friend (with the derived incarnation id), a block per blocked person and its petnames, all at the lowest stamp. So any change made since on another device wins.
- **Diverged before the update.** A friend that one device has and another doesn't, from before the update, is the one thing no device can settle alone: the friend may have been removed on one, or added on the other. So those adds come in marked "from before", and a device that lacks the friend shows them in a list, "On your other devices only", with Add here and Remove everywhere, rather than adding or dropping them silently.
- **Mixed versions.** Entries of a kind a device can't read are kept, counted for catching up, and skipped, so a newer device's entries never stop an older one taking the rest (C2, and #157 for link bundles).

## 8. Issues this design takes in

| Issue                                                        | Covered or prerequisite           | How                                                                                                                                                                                                                                                                                                                                                                                                                | Order                                                                                 | Cost                                                                                                                       |
| ------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| #158 two devices on the lower-id side split a pair           | covered, by the pair-secret part  | `pair-secret-ok` names the secret it confirms, and only the device whose secret it is moves. A device whose own wasn't taken stays put, and takes the confirmed secret from your other device through the sealed sync. It can't learn it from the old room, which anyone who knows both ids can enter. Modelled (`legacy.ts`, P3): today's unnamed ok splits, and a named ok without sync leaves the device stuck. | with step 2 (pair secrets in sync); the named ok alone would leave the device unmoved | small: one field in `pair-secret-ok`, one adoption rule; only pairs from before pair secrets that never moved are affected |
| #157 a link bundle refuses every friend over one bad record  | prerequisite, and covered in sync | The bundle's friends are read one by one, as imports are, with the same name checks and unknown keys dropped. Sync entries are read the same way: an unreadable one is kept and skipped (C2). Modelled: "one unreadable entry refuses the letter" breaks C1.                                                                                                                                                       | step 0, before sync: a new device's starting state is its bundle                      | small; a test with a bad record                                                                                            |
| #203 mail put again isn't sealed to a friend's new devices   | prerequisite, and covered in sync | Mail put again is sealed again to the recipient's list as it is then, adding devices linked since and leaving out devices removed since. Modelled (P1): "same sealed letter put again" leaves out a device linked since and keeps a removed one.                                                                                                                                                                   | step 0, before your-data letters carry pair secrets                                   | one more seal per re-put, a new blob id, and the old blob left until it expires or is dropped                              |
| #150 a changed replacement winner is sent outside the outbox | prerequisite                      | Every letter goes into the outbox before it's put, replacement winners included, and is put at the next start if the tab closed. Modelled (P3, O1): "replacement outside the outbox" leaves a friend on the old secret.                                                                                                                                                                                            | step 0: sync sends secret states that must survive a closed tab                       | small; a test that closes the service between the change and the put                                                       |

**Build order.**

0. #150, #157 and #203.
1. The shared log: friends, tombstones, petnames, mutes, blocks and settings; `mail:sync` and its self-room messages; the kinds each device reads; the upgrade. This step needs a decision record, and review rounds, since your-data letters are a new signed format.
2. Pair secrets and replacement state in sync, with #158.
3. Chat history pages.
4. Invite links, option (b).

Each step is checked against this model first, as the repo asks for anything that changes a signed format or moves secrets.

## 9. What the model shows

- **Under the design,** every scenario holds every invariant, explored breadth first to the end or to a bound, and with seeded random walks deeper.
  - Your data: friends, blocks, settings, removal, the removed device in the self room, a link after a removal, a tab closed before the put, and an unreadable entry.
  - Chat history.
  - Invite links (a) and (b), under every condition.
  - Moving to pair secrets.
- **Each planted defect is caught by its invariant:**
  - missing tombstone (T1);
  - last writer by arrival (W1);
  - sealed to every device ever known (P2);
  - secret without the log (P4);
  - removed device not discounted (R2);
  - letters from a removed device taken (R1);
  - same sealed letter put again (P1);
  - replacement outside the outbox (P3);
  - one unreadable entry refuses the letter (C1);
  - no history between your devices (H1);
  - an entry taken twice (H2);
  - shown in arrival order (H3);
  - answers taken from any device (K1);
  - approvals counted by stamp (K3);
  - an unnamed `pair-secret-ok` (P3);
  - a named one without sync (P3).
- The model's README has the numbers.

## 10. Costs

- **To people.**
  - The shared log is small: a few hundred bytes an entry, and a person makes few changes. A thousand unfriends is about 200 KB, kept for good so a device away for long can't bring a friend back.
  - Each device stores every chat, which is the point.
  - A new device fetches a few MB of recent history in its first day.
  - Mail checks don't get more frequent.
- **To Lighthouses.**
  - One blob per change (batched), sealed to your other devices, gone once each has taken it.
  - History pages when a device learns of a friend or is linked: at most 100 blobs, about 4 MB, a day per device.
  - A small official Lighthouse (1 GiB) holds a few hundred new devices' first day at once.

## 11. Residuals this accepts

- Until a device hears of a removal, the removed device is yours to it: it may be sealed a secret made then, and its entries taken. That ends when the log is merged, and nothing it makes after every device has heard counts.
- A removed device can stamp entries before its removal. Such an entry counts only if a device that hadn't heard took it. A value set that way loses to any change made after its stamp; a friendship it ends stays ended until you pair again.
- What an honest device changed just before its removal, and hadn't sent, is lost with it. That includes a link's `added` it sent just before: the person is added, and your other devices don't know them until they meet.
- A device whose clock runs fast wins close races (within a day), as your name does today.
- Friends that diverged before the update need a person to settle them.
- Lighthouses see how often you change your data, and bursts of history.
- History by mail stops at 200 messages a chat; the rest needs the devices online with the friend, or a file.
- An approval made on another device waits for the link's maker to run, and lapses if the maker is removed or replaced.

## 12. Open questions for the maintainer

Each has a recommended answer.

1. **Should Always Go Through the Relay be one setting for all your devices?** Recommended: yes, newest change wins, and Settings says it applies to every device. The alternative, per device, is safer for someone who wants it only on the phone, but then "settings" covers nothing yet.
2. **Do mutes sync with petnames?** Recommended: yes. They're yours across your devices, never sent to friends.
3. **How much history by mail?** Recommended: the most recent 200 messages a chat; more only live or by file.
4. **Option (b) for links?** Recommended: yes, with the "waiting for the phone" state, and a "make a new link" offer when the maker is gone.
5. **Diverged friends at the update:** recommended: list them and ask, rather than adding (which would bring back friends removed before the update) or dropping (which would lose friends added on one device).
6. **An approval made on a device that's removed before the maker acts on it:** recommended: it lapses. Approvals are instructions, not state, and the person approves again on a device still on the list.
7. **Unfriending reaches every device:** recommended: yes, with the confirm saying "on all your devices".
8. **Tombstones kept for good?** Recommended: yes. They're small, and dropping them lets a device that was away long bring a friend back. Compacting can come when someone has thousands.
9. **One `mail:sync` kind, or one per kind of data?** Recommended: one (§2).
