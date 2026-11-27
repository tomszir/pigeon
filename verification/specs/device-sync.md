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
- **W1. The newest change wins.** Once mail settles, each value a person can change (a petname, a block, a setting) is the one from the change with the highest stamp: the stamp a device gives a change is later than anything it has seen (`self-room`), so a change made after seeing another beats it. A device back from days away never brings an older value back. Of two changes made without seeing each other, the higher stamp wins, then the device, then the entry's number, the same everywhere.
- **C2. Nothing unreadable stops the rest.** An entry a device can't read (from a newer Pigeon) doesn't stop it taking the rest of the same letter or later letters, and it is kept, so the device acts on it once it updates.

### Tombstones

- **T1. An ended friendship stays ended.** Once mail settles, a friendship ended on a device on the list (by unfriending or blocking) shows on no device of the list. Only pairing again brings that friend back, as a new friendship.
- **T2. A tombstone held is never undone.** A device that holds a tombstone written by a device on the list never shows that friendship again, whatever arrives later, from a device that was away or from a removed one.
- **T3. A removal stays.** A device removed from the list is never put back by any device's data, which can't carry or change the device log (`signed-device-list`; checked by the device log's own tests, not this model).

### Pair secrets

- **P1. Sealed to the list.** Every letter a device on the list puts, or puts again, is sealed to exactly the devices on its own list at that moment: not to a device removed since, and not without a device linked since.
- **P2. No new secret to a removed device.** A removed device never reads a pair secret made by a device that already knew of its removal: neither the replacement the removal began (`replace-after-removal`) nor any friend's secret made after.
- **P3. One pair secret per friend.** Once mail settles, every device of yours on the list and the friend are on the same pair secret.
- **P4. Secret holders know the removal.** A device holding a pair secret made after a removal has merged the device log that removed it, so it never seals that secret to the removed device. That holds if every letter carrying a secret carries the sender's device log, and logs are merged before anything else is acted on.

A secret made by a device that hadn't yet heard of a removal can reach the removed device; see §5.

### The removed device

- **R1. Nothing once all know.** Nothing a removed device makes after every device on the list knows of its removal reaches any of them, directly or passed on by another device.
- **R2. Discounted from its removal.** On a device that knows of a removal, nothing the removed device stamped at or after its removal counts, wherever the entry came from.
- **R3. What it sent before.** What it stamped before its removal counts, as a chat entry from before a removal does (TM, Removed devices). Its stamps are its own word, so it can stamp a new entry before its removal. Such an entry counts only if it reaches a device on the list that hasn't yet heard of the removal (R1), and it only wins over values nobody has changed since its stamp (W1). A tombstone stamped that way ends a friendship; pairing again is the remedy, as it is for a stolen device's unfriending while still on the list. A device that knows of the removal doesn't take letters from it at all.

### Chat history

- **H1. No message lost.** Once mail settles, with no two devices online at the same time, every device that has the friend holds every message anyone wrote in that chat, including what was said in the pair room before it heard of the friend, and what came by letter before it did.
- **H2. No message twice.** No device holds an entry twice, however many times it arrives (letter, copy, history page, put again, `log-sync`).
- **H3. Stable order.** Every device shows the chat in the order of (Lamport time, author, sequence) (P, Logs), so two messages never swap places when another arrives.
- **H4. Same chat.** Once mail settles, every device that has the friend shows the same chat.

Pigeon has no message deletion: a chat entry holds text only, and unfriending deletes the whole chat on the device that does it. With your data kept in step, an unfriend deletes it on every device. Pairing again brings back whatever the friend's devices send in their catch-up, as on one device today.

### Invite links on other devices

- **K1. Only the maker adds.** Whoever asks through a link is added only by an `added` from the device the link names, under every option (`maker-bound-links`).
- **K2. No removed device holds a new friend's secret.** A friend added through a link, on a secret made by a device that knew of a removal, is on a secret the removed device doesn't hold.
- **K3. The maker acts only on a device on its list.** When the maker acts on another device's approval, that device is on the maker's list when it acts.
- **K4. An approval is carried out.** An approval made on a device on the list leads to an `added` while the maker stays on the list and runs.
- **K5. Both sides agree.** Once mail settles with the maker running, every device of yours shows the person as a friend exactly when they were added, on the secret they hold.

### Outbox

- **O1. A closed tab loses nothing.** Anything a device decided to send (a new replacement winner, a change to your data) is in its outbox before it's put, and put at its next start if the tab closed first. P3 catches its loss.

## 4. How the model checks them

The model (`verification/models/device-sync/`) is TypeScript run by Node with no dependencies. Its README says how to run it. Its design under test, the one the design note recommends:

- Each device keeps a signed, append-only log of its own changes (`signed-logs`). An entry is `add` (a friendship, its incarnation, its pair secret), `tomb` (an incarnation ended), `pet`, `block`, or `relay`, signed by its device with a stamp later than anything that device had seen.
- Every device folds the entries it holds into what it shows. An `add` is live until a `tomb` names it, and nothing brings a tombstoned incarnation back. A register takes its highest-stamped entry. A block hides friendships added before it. Entries from a removed device stamped at or after its removal don't count.
- A mail check opens everything, merges every device log first, then takes the rest only from devices on the resulting list, then sends its other devices its log and its pair secrets, sealed to its list. A newer letter replaces an older one still waiting on the same devices. A lost letter is put again, sealed again to the list as it is then.
- Pair secrets move only forward, by replacement round. A device adopts a sibling's secret only when it is a later round.

| Model                                | Scenarios                                                                                                                                               | Invariants                        | Planted defects caught                                                                                                                                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Your data (`data-*.ts`)              | friends, blocks, settings (three devices, one away); removal, room, link (a hostile removed device); outbox (a tab closed); newer (an unreadable entry) | C1, C2, W1, T1, T2, P1–P4, R1, R2 | missing tombstone (T1); last writer by arrival (W1); sealed to every device ever known (P2); secret without the log (P4); removed device not discounted (R2); letters from a removed device taken (R1); same sealed letter put again (P1); replacement outside the outbox (P3); one unreadable entry refuses the letter (C1) |
| Chat history (`chat.ts`)             | a friend learned through your data, with history said live before; letters expire; the friend met live                                                  | H1–H4                             | no history between your devices (H1); an entry taken twice (H2); shown in arrival order (H3)                                                                                                                                                                                                                                 |
| Invite links (`links.ts`)            | options (a), (b), (c) × the maker running, away, removed, replaced; (b) and (c) against a hostile removed device                                        | K1–K5                             | answers taken from any device (K1); approvals counted by stamp (K3)                                                                                                                                                                                                                                                          |
| Moving to pair secrets (`legacy.ts`) | two devices on the lower-id side meeting the friend in the old room, alone or together                                                                  | P3                                | an ok that names no secret (P3); a named ok without device sync (P3)                                                                                                                                                                                                                                                         |

Every scenario also names what it must reach (a removal everyone heard of, a forged entry taken, a letter lost, a friend live on the device that was away), so it can't pass by never getting there.

## 5. Residuals the invariants leave

- **The window before a removal is heard.** Until a device hears of a removal, the removed device is on its list. A device that hasn't heard can seal it a secret it makes in that window, or take its entries. Both stop once the device merges the log, and nothing the removed device makes after every device has heard counts (R1). This is the same window TM describes for friends who haven't seen the newer log.
- **Backdated entries.** R3 above. A removed device's backdated tombstone ends a friendship until you pair again; a backdated value loses to any change made after its stamp.
- **A removed device's last changes.** What an honest device wrote just before its removal, and hadn't yet sent to a device still on the list, is dropped with it: a device that knows of the removal doesn't take its letters.
- **Clocks.** Stamps follow wall clocks with the `self-room` rule (later than anything seen, refused when more than a day ahead), so a device whose clock runs fast wins close races, as names do today.

## 6. Invite links on other devices

The options and their results are in the design note, `device-sync-design.md`, §5.

## 7. Not modelled

- Recovery epochs, and the replacement rounds' own rules under a hostile removed device: the replacement model on its own covers those. Here a replacement round is honest, made by the writer.
- Friends' own device logs, sealing keys and Lighthouse lists, which ride with the friend's record. They change only through the friend's signed messages, as today.
- Sizes and pagination: a history page carries one entry, and a letter has no size.
- Wall clocks: stamps are Lamport times, and a hostile device stamps either as early as possible or at the newest time it has seen.
- Older Pigeons on some devices (design note §7).
