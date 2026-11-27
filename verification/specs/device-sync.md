# Keeping your devices in step: a specification

What it means for a person's linked devices to share their friends, petnames, blocks, chats, invite links and settings, written from the docs as invariants an implementation must keep, with the executable model in `verification/models/device-sync/` that checks them.

Conventions. `P` is docs/protocol.md, `TM` docs/threat-model.md, `SM` docs/state-machines.md, `LH` docs/lighthouse.md. Rules the docs draw on are named by topic in code font: `signed-device-list` (one writer, removal final), `self-room` (your name and message in the self room, newest wins), `replace-after-removal` (new pair and self secrets after a removal), `maker-bound-links` (an invite link names the device that made it and its end, and only that device's cards and answers count), `signed-logs` (shared state as per-author signed append-only logs), and `lamport` (made-up Lamport times taken, not followed). Nothing here is taken from code.

## 1. What is shared today, and the gap

- A link bundle copies, once, the identity, device log, self secret, profile, friends with their pair secrets, the blocked list and friends' device logs (P, Devices). Chats aren't in it.
- After linking, only the device log, your name and personal message (self room and self mail), your Lighthouse list and the invite links each device made (self mail) are kept in step. "The rest of your own data isn't kept in step between devices" (P).
- A chat catches up between your devices only in pair rooms (`log-sync`), and only on a device that has that friend. A letter's copy for your other devices goes "into the chat with that friend if it has one" (P, Letters), so a device without the friend drops the copy.
- Petnames and mutes "are yours alone and never leave the browser" (P, Removing and blocking).

So a friend added on one device never shows on another, and neither does anything said with them. This spec covers all of the following:

| Data                                                             | Today                          | In scope here                                |
| ---------------------------------------------------------------- | ------------------------------ | -------------------------------------------- |
| Friends (with pair secret, name, sealing keys, Lighthouses, log) | copied once at linking         | added, unfriended and re-added on any device |
| Petnames, mutes                                                  | never leave the device         | changed on any device                        |
| Blocks                                                           | copied once at linking         | blocked and unblocked on any device          |
| Chat history                                                     | pair rooms only, friend needed | every message on every device                |
| Invite links you made, and requests waiting on them              | count only, from the maker     | seen everywhere; see §6 for who approves     |
| Settings (Always Go Through the Relay)                           | per device                     | changed on any device                        |
| Name, personal message, Lighthouse list, device log              | kept in step                   | unchanged                                    |

## 2. Actors and what they can do

- **Your devices.** One writes the device log (the first device, unless a recovery named another; `signed-device-list`). Each may be away for any length of time, closed between any two steps, and on an older Pigeon. A device away longer than mail is kept (30 days) is out of the bounds below.
- **A removed device.** Taken off the list by the writer or a recovery. TM treats it as hostile for anything it ever sent: it keeps every secret it held and reads every letter sealed to it. It can sign anything with its own key, at any stamp (its stamps are its own word), sign two different entries with one number, and send to any of your devices, and it can answer in the self room. It can't sign as another device, and it can't change the device log (`signed-device-list`).
- **A friend** and the friend's devices, who hold the pair secret and take only letters sealed to them.
- **Lighthouses** hold mail for at most 30 days. They may delay, drop, reorder or duplicate it. They can't open it, and they see sizes, timing, tags and how many devices a blob is sealed to (LH).
- **Someone asking through an invite link**, who takes answers only from the device the link names (`maker-bound-links`).

"Mail settles" means: no letter waits that a device on the list could still take, every outbox has put what it holds, and every device on the list has made a mail check after the last change. Settled states are where convergence is checked. Safety invariants are checked on every state.

## 3. Invariants

Each has the id the model's checks use.

### Convergence

- **C1. Devices on the list converge.** Once mail settles, every device still on the list shows the same friends (the same live friendships), petnames, blocks and settings, whatever order letters came in, whichever were lost and put again, and however long any device was away within the bound.
- **W1. The newest change wins.** Once mail settles, each value a person can change (a petname, a block, a setting) is the one from the change with the highest stamp. A device stamps a change later than its own clock and later than every entry it holds about the same friend or setting, so a change made after seeing another beats it. A device back from days away never brings an older value back. Of two changes made without seeing each other, the higher stamp wins, then the device, then the entry's number, the same everywhere.
- **C3. No stamp is refused.** An entry is never refused or held back for being stamped ahead of the receiving device's clock; the stamp only orders it. A device whose clock once ran far ahead doesn't stop the others taking its later changes, and nobody's own clock follows its stamps.
- **C4. Two entries under one number still converge.** A device that signs two different entries under one number (only it can) can't leave your devices apart: a summary carries, per author, a digest of the entries held, so a device whose digest differs is sent that author's entries, and every device keeps the one with the lower signature.
- **C2. Nothing unreadable stops the rest.** An entry a device can't read (from a newer Pigeon) doesn't stop it taking the rest of the same letter or later letters, and it is kept, so the device acts on it once it updates.

### Tombstones

- **T1. An ended friendship stays ended.** Once mail settles, a friendship ended on a device on the list (by unfriending or blocking) shows on no device of the list. Only pairing again brings that friend back, as a new friendship.
- **T2. A tombstone held is never undone.** A device that holds a tombstone written by a device on the list never shows that friendship again, whatever arrives later, from a device that was away or from a removed one.
- **T3. A removal stays.** A device removed from the list is never put back by any device's data, which can't carry or change the device log (`signed-device-list`; checked by the device log's own tests, not this model).
- **T4. One friendship shows per friend.** Two live friendships with one friend (paired again on two devices at once) show as the newer add, the same everywhere.

### Pair secrets

- **P1. Sealed to the list.** Every letter a device on the list puts, or puts again, is sealed to exactly the devices on its own list at that moment: not to a device removed since, and not without a device linked since.
- **P2. No new secret to a removed device.** A removed device never reads a pair secret made by a device that already knew of its removal: neither the replacement the removal began (`replace-after-removal`) nor any friend's secret made after.
- **P3. One pair secret per friend.** Once mail settles, every device of yours on the list and the friend are on the same pair secret, for the same friendship. Pair-secret state belongs to a friendship (an incarnation), not to the friend, so pairing again after an unfriend leaves no device on the dead friendship's secret.
- **P4. Secret holders know the removal.** A device holding a pair secret made after a removal has merged the device log that removed it, so it never seals that secret to the removed device. That holds if every letter carrying a secret carries the sender's device log, and logs are merged before anything else is acted on.

- **P5. No friendship on a removed device's secret.** Once mail settles, no device on the list and no friend is on a pair secret a removed device proposed. A secret is chosen as replacement rounds choose (`replace-after-removal`): from the friendship's first secret, the earliest proposal (time, device, secret) for the secret held, counting only proposals signed by a device on its side's list. A claimed round number counts for nothing, and a proposal whose device is removed stops counting, so a device on it falls back.

A secret made by a device that hadn't yet heard of a removal can reach the removed device; see §5.

### The removed device

- **R1. Nothing once all know.** Nothing a removed device makes after every device on the list knows of its removal reaches any of them, directly or passed on by another device.
- **R2. Discounted from its removal.** On a device that knows of a removal, nothing the removed device stamped at or after its removal counts, wherever the entry came from. Its removal time is the `at` of the entry that took it off the current epoch's list, or of the `recover` that left it off; a device on the latest epoch's list is never discounted, whatever an earlier epoch says.
- **R4. Only your devices write.** An entry counts only from a device that is or was on your device log, in any epoch. One from any other key is refused and never passed on.
- **R3. What it sent before.** What it stamped before its removal counts, as a chat entry from before a removal does (TM, Removed devices). Its stamps are its own word, so it can stamp a new entry before its removal. Such an entry counts only if it reaches a device on the list that hasn't yet heard of the removal (R1), and it only wins over values nobody has changed since its stamp (W1). A tombstone stamped that way ends a friendship; pairing again is the remedy, as it is for a stolen device's unfriending while still on the list. A device that knows of the removal doesn't take letters from it at all.

### Chat history

- **H1. No message lost.** Once mail settles, with no two devices online at the same time, every device that has the friend holds every message anyone wrote in that chat, including what was said in the pair room before it heard of the friend, and what came by letter before it did.
- **H2. No message twice.** No device holds an entry twice, however many times it arrives (letter, copy, history page, put again, `log-sync`).
- **H3. Stable order.** Every device shows the chat in the order of (Lamport time, author, sequence) (P, Logs), so two messages never swap places when another arrives.
- **H4. Same chat.** Once mail settles, every device that has the friend shows the same chat.

Pigeon has no message deletion: a chat entry holds text only, and unfriending deletes the whole chat on the device that does it. With your data kept in step, an unfriend deletes it on every device. History pages and copies your devices send each other name the friendship they belong to, inside the seal, and a device drops those for a friendship it has ended, so a page left at a Lighthouse by a device that was away doesn't bring the chat back after pairing again. Pairing again still brings back whatever the friend's own devices send in their catch-up, as on one device today.

### Invite links on other devices

- **K1. Only the maker adds.** Whoever asks through a link is added only by an `added` from the device the link names, under every option (`maker-bound-links`).
- **K6. The maker answers only what it fetched.** A link's `request` and `answer` entries count only from the link's maker, so the maker never answers a request another device wrote, and no device shows one.
- **K2. No removed device holds a new friend's secret.** A friend added through a link, on a secret made by a device that knew of a removal, is on a secret the removed device doesn't hold.
- **K3. The maker acts only on a device on its list.** When the maker acts on another device's approval, that device is on the maker's list when it acts.
- **K4. An approval is carried out.** An approval made on a device that stays on the maker's list leads to an answer while the maker stays on the list and runs. One made on a device removed before the maker acts lapses (K3).
- **K5. Both sides agree.** Once mail settles with the maker running, every device of yours shows the person as a friend exactly when they were added, on the secret they hold.
- **K7. Each request is answered once.** A decision (approve or decline) names the link, the request and the asker's key; the maker carries out the first that counts and spends it, and a later one for the same request does nothing. Whoever asked hears one answer.
- **K8. Added only on their own approval.** An approval applies only to the request it names, never to another request through the same link.
- **K9. Every device shows the maker's answer.** Once mail settles with the maker running, every device shows each request as the maker answered it.

### Outbox

- **O1. A closed tab loses nothing.** Anything a device decided to send (a new replacement winner, a change to your data) is in its outbox before it's put, and put at its next start if the tab closed first. C1, W1 and P3 catch its loss.

## 4. How the model checks them

The model (`verification/models/device-sync/`) is TypeScript run by Node with no dependencies. Its README says how to run it. Its design under test, the one the design note recommends:

- Each device keeps a signed, append-only log of its own changes (`signed-logs`). An entry is `add` (a friendship and its incarnation), `tomb` (an incarnation ended), `pet`, `block`, or `relay`, signed by its device. Its stamp is later than the device's own clock and than every entry it holds about the same subject; no stamp is ever refused.
- Every device folds the entries it holds into what it shows. An `add` is live until a `tomb` names it, and nothing brings a tombstoned incarnation back. Of two live incarnations of one friend, the newer add shows. A register takes its highest-stamped entry. A block hides friendships added at or before it. Entries from a removed device stamped at or after its removal don't count.
- A mail check opens everything, merges every device log first, then takes the rest only from devices on the resulting list. Then it sends its other devices the entries any of them isn't known to hold, by the summary (highest number and digest per author) each last sent, with its pair-secret proposals, sealed to its list and put before the check ends. A newer letter replaces an older one still waiting on the same devices. A lost letter is put again, sealed again to the list as it is then.
- Pair-secret state is, per friendship, the signed proposals known: the first secret, made when pairing, and every replacement, each naming the secret it replaces. A device is on the secret the proposals settle on (P5); when that changes, it sends the friendship's proposals to the friend's devices too, as replacement rounds do. A friendship's state stays, unused, after its tombstone lands.

| Model                                       | Scenarios                                                                                                                                                                                                                                        | Invariants                               | Planted defects caught                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Your data (`data-*.ts`)                     | friends, repair (unfriended and paired with again), blocks, settings, skew (a clock a month ahead), with three devices and one away; removal, room, link (a hostile removed device); outbox (tabs closed mid-check); newer (an unreadable entry) | C1–C4, W1, T1, T2, T4, P1–P5, R1, R2, O1 | missing tombstone (T1); secret per friend, not per friendship (P3); last writer by arrival (W1); stamps refused when ahead (C1); sealed to every device ever known (P2); secret without the log (P4); secret by the highest round (P5); secret state dropped at a tombstone (P3); the friend not told (P3); removed device not discounted (R2); letters from a removed device taken (R1); summaries without a digest (C1); same sealed letter put again (P1); letters outside the outbox (P3); one unreadable entry refuses the letter (C1) |
| Chat history (`chat.ts`)                    | a friend learned through your data, with history said live before; letters expire; the friend met live                                                                                                                                           | H1–H4                                    | no history between your devices (H1); an entry taken twice (H2); shown in arrival order (H3)                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Invite links (`links.ts`, `links-model.ts`) | options (a), (b), (c) × the maker running, away, removed, replaced; (b) with two askers, a busy answer, two approvals and a decline at once, and an approving device removed; (b) and (c) against a hostile removed device                       | K1–K9                                    | answers taken from any device (K1); approvals counted by stamp (K3); approvals that name no request (K8); decisions not spent (K7); request and answer entries from anyone (K9)                                                                                                                                                                                                                                                                                                                                                             |
| Moving to pair secrets (`legacy.ts`)        | two devices on the lower-id side meeting the friend in the old room, alone or together                                                                                                                                                           | P3                                       | an ok that names no secret (P3); a named ok without device sync (P3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Every scenario also names what it must reach (a removal everyone heard of, a forged entry taken, a letter lost, a friend live on the device that was away), so it can't pass by never getting there.

## 5. Residuals the invariants leave

- **The window before a removal is heard.** Until a device hears of a removal, the removed device is on its list. A device that hasn't heard can seal it a secret it makes in that window, or take its entries. Both stop once the device merges the log, and nothing the removed device makes after every device has heard counts (R1). This is the same window TM describes for friends who haven't seen the newer log.
- **Backdated entries.** R3 above. A removed device's backdated tombstone ends a friendship until you pair again; a backdated value loses to any change made after its stamp.
- **A removed device's last changes.** What an honest device wrote just before its removal, and hadn't yet sent to a device still on the list, is dropped with it: a device that knows of the removal doesn't take its letters.
- **Clocks.** Stamps start from each device's wall clock, so of two changes made without seeing each other, the one from the device whose clock runs fast wins, as names do today. A stamp is never refused, so a clock far ahead costs nothing more than that.
- **A tombstone that stops counting.** A removed device's tombstone stamped after its removal ends a friendship on a device that hasn't heard yet. When the device hears, the tombstone stops counting and the friendship shows again, on the secret it was on: a friendship's pair-secret state is kept after its tombstone lands, never dropped, because every device may have taken that tombstone and none would hold the secret otherwise. Pairing again is what keeps a dead friendship's secret out of use: the new friendship has state of its own.
- **Two re-pairings at once.** If two of your devices pair again with the same friend at the same time, your devices show the newer add, while the friend keeps whichever pairing reached them last. The two can differ, and only pairing again settles it. That needs two devices re-pairing within the same mail check, and isn't modelled.
- **Size.** The log has no compaction. Each author's entries are capped at 10,000, of at most 1 KB each; past the cap a device refuses and doesn't pass on that author's entries. A person's own changes stay far below it. A device that floods within the window before its removal costs your devices at most that much, and nothing once all have heard.

## 6. Invite links on other devices

The options and their results are in the design note, `device-sync-design.md`, §5.

## 7. Known gaps

- **An older Pigeon on the list.** It is never sent `mail:sync`, so an unfriend or block made elsewhere doesn't reach it. The confirmation says so by name ("on all your devices except the laptop, which needs updating") rather than "on all your devices", and that device keeps what it had until it updates.
- **Lighthouse limits.** Your devices' self mail shares one tag a day, which one address may put 200 blobs under. Several of your devices behind one address, each sending history, could reach it and delay a tombstone or a secret letter by a day. So each check puts your-data and secret letters before history pages, history stops for the day at the first refusal, and one device sends at most 50 history letters a day. A refused letter waits in the outbox; nothing is lost.
- **Secrets in link entries.** A link's secret and claim key, and each request's reply secret, never go in an entry, which is kept for good. A link's secret travels beside the log like a pair secret and goes when the link ends. A request entry carries the asker's name, fingerprint and key, and the maker alone keeps the reply secret.
- **Incarnations from before the update.** A friend held from before the update gets an incarnation id derived from the friend's id alone, so every device derives the same one whatever `addedAt` it holds. The upgrade writes its blocks a stamp after its adds, so a blocked friend stays hidden.

## 8. Not modelled

- Recovery epochs. R2's removal time is defined from them above; the model has one removal.
- Rounds proposed by the friend's side, and rounds two or more deep: here the writer proposes after a removal, and a hostile removed device proposes one of its own.
- Friends' own device logs, sealing keys and Lighthouse lists, which ride with the friend's record. They change only through the friend's signed messages, as today.
- Sizes and pagination: a history page carries one entry, and a letter has no size.
- Wall clocks: each device's clock moves with its own actions, a clock can jump ahead once, and a hostile device stamps either as early as possible or at the newest time it has seen. Clocks don't move while mail settles.
- Entries from a key never on the device log (R4), size caps, link and reply secrets, history pages naming their friendship, and the update.
- Older Pigeons on some devices (design note §7).
