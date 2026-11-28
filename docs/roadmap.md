# Roadmap

What each release brought, what the next releases will bring, in build order, and the check that says each piece is done.

## Goal

Private groups first. The releases from 0.8.0 on build toward one test:

- A small group of friends (5 to 12) has its own place on Pigeon.
- It works even when they're never online at the same time.
- The Lighthouse came first because invites, letters, device sync, groups and push all need the same thing: somewhere that holds sealed mail while people are away.
- Public places wait until their moderation is designed.

## How releases are named

- Shipped work sits under the version it shipped in.
- Scheduled work gets a version only once it's among the next few releases, matching a GitHub milestone of the same name.
- Work further off is listed by name alone, so reordering it never renames anything.
- Older decision records cite numbered milestone names. The table at the end maps each to where it lives now.

## Released

| Release        | Brought                                                                                                                                                                                                                               | Key decisions                                                                                                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.2.0 to 0.4.0 | Desktop shell (stage, windows, taskbar, menu, tray, balloons, Read Me). Two tabs talking: identity, pairing by link and QR, pair rooms, buzz and typing. TURN relay. Friend menu (profile, petname, fingerprint, mute, remove, block) | [0016](decisions/0016-pairing-through-one-use-invite-rooms.md), [0022](decisions/0022-turn-from-a-worker-route.md), [0023](decisions/0023-removing-a-friend-tells-them.md)                                                                                                                          |
| 0.5.0          | Avatars (a pixel pigeon from each id). What's new (Changelog.txt and an update balloon). Private rooms named and locked by a pair secret. Linking a device in person                                                                  | [0025](decisions/0025-release-notes-for-people.md), [0026](decisions/0026-pair-rooms-from-a-shared-secret.md)                                                                                                                                                                                       |
| 0.6.0 to 0.7.1 | Your devices: a signed device log, linking, removing, copied-profile detection, the recovery key. Explorer on this computer: PigeonHTML, Explorer, in-world Help                                                                      | [0024](decisions/0024-a-signed-list-of-devices.md), [0027](decisions/0027-a-recovery-key-that-outranks-devices.md), [0030](decisions/0030-the-recovery-key-beside-the-chain.md), [0032](decisions/0032-explorer-on-this-computer-first.md)                                                          |
| 0.8.0          | Lighthouses and the sealed mailbox. Async invite links through Lighthouses. Letters through Lighthouses                                                                                                                               | [0037](decisions/0037-the-lighthouse-and-its-mailbox.md), [0038](decisions/0038-invite-links-through-lighthouses.md), [0039](decisions/0039-messages-through-lighthouses.md)                                                                                                                        |
| 0.8.1          | Security release: longer link secrets, typed codes like K7RT-VP2-BXQ, approval of each request, device fingerprints on both screens, channel-bound hellos, removals that stick, public-only Lighthouses under relay-only              | [0043](decisions/0043-hellos-bound-to-their-channel.md), [0045](decisions/0045-lighthouses-someone-else-names.md), [0046](decisions/0046-codes-through-spake2.md)                                                                                                                                   |
| 0.8.2          | Standard building blocks: HPKE mail, Argon2id passphrases, typed signed entries compared as bytes, checked imports, a fuzzed device-log merge, the threat model, replaced pre-0.8.1 secrets                                           | [0048](decisions/0048-log-signatures-compared-as-bytes.md), [0049](decisions/0049-log-entries-that-say-what-they-are.md), [0050](decisions/0050-mail-sealed-with-hpke.md), [0051](decisions/0051-replacing-secrets-after-a-removal.md), [0052](decisions/0052-file-passphrases-through-argon2id.md) |
| 0.8.3          | Seamless: names that take across devices, mail looked for on return, Lighthouse waits, Try Again and Check Now, each message's way shown, letters grouped, links bound to their maker for a week                                      | [0055](decisions/0055-waiting-for-mail-at-a-lighthouse.md), [0056](decisions/0056-letters-that-arrive-together-sit-in-one-section.md), [0060](decisions/0060-invite-links-bound-to-their-maker-for-a-week.md), [0061](decisions/0061-the-chat-in-panels-with-received-on-their-word.md)             |

Details of each release are in Changelog.txt and Pigeon's security advisories.

## Scheduled

The next releases, in build order. Each matches a GitHub milestone of the same name.

### 0.8.4 · Seamless, continued

- Device sync: friends, blocks, petnames, mutes and settings kept in sync through your shared log ([0062](decisions/0062-your-devices-in-step-through-a-shared-log.md)).
- Chats and invite links in sync across linked devices.
- Lighthouse push.
- Typed signing for device-log and chat entries.
- Invite answers bound to the request they answer.

**Done when** Toms adds a friend on his phone and the friend shows on his PC, and a message sent from the phone shows on the PC within seconds of opening it, without the two ever being open at the same time.

### 0.9.0 · Groups

- Shared spaces (a room, a member list, a signed log, an ephemeral channel) that pair chats move onto.
- Private groups of up to 12 with an owner-signed membership log.
- Group invites and group mail through the Lighthouse mailbox.
- A decision between MLS (RFC 9420) and sender keys for group messages.
- Group chat format: each member's name and colour above their panels, one mark per message with who has it, one envelope naming everyone who left letters, join and leave lines, "Ren and Sam are typing". Fixed once the protocol work is.
- Pigeon on your phone:
  - installable to the Home Screen
  - Web Push through the Lighthouse, which holds subscriptions and sends nothing or a sealed line
  - opt-in per device, saying what the push service learns (when, never what)
  - on iPhone, web push works only for Home Screen apps

**Done when** five friends use a group for a week without any two needing to be online at once, a member who was offline catches up, and a removed member gets nothing new; and Mika's phone, with Pigeon closed, shows that Toms wrote, and opening it shows the message.

### 0.9.x · Hardening

- Security hardening with no known attack, so none of it holds up a release.
- A rule nobody can steer for settling two recoveries made for the same device log.

### 0.10.0 · Forward secrecy

- Letters sealed with one-time prekeys and a ratchet from a maintained library, so a key stolen later can't open letters carriers still hold.
- Online mutual friends as carriers beside the Lighthouse.
- Letters in Flight, saying who carried each one.

**Done when** A → Lighthouse → B and A → C → B both work with A and B never online together, and B can see who carried each letter.

### 0.11.0 · Files

- Content-addressed chunks (named by hash, served by anyone who holds them).
- Progress, accept and decline, resume, "Send when they come online".
- A picture chooser and your own picture (48×48, dithered, sent as a small file).
- Files in groups, from the same chunks.
- Lighthouses hold sealed file chunks within quotas, so a file arrives while its sender is offline.

**Done when** a 50 MB file arrives intact.

### 0.12.0 · Pigeonweb

- Resolver, page host and mirrors, on the Explorer from 0.6.0.
- Page snapshots as lists of Files' chunks.
- Page builder, widgets, webrings and a portal.
- Lighthouses mirror public page chunks and signed site manifests for their owner and friends, checked as the chunk-naming decision says.

**Done when** Mika's page loads from a mirror while Mika is offline.

## Further off

Work that gets a version once it's among the next few releases, in this order.

### Games

- Turn-based games as signed move logs on spaces, played live or a move at a time.
- Commit-reveal dice. Original and traditional games with nothing hidden.
- "Invite to a game" from a chat or group.

**Done when** two friends finish a game across separate visits, and it replays from its log.

### Desktop life

- Desktop icons: rubber-band select, drag, arrange, kept.
- A Desktop tab in Display Properties: several wallpapers, a solid colour, positions, your own picture kept in this browser.
- Cursors drawn for Pigeon, with a flapping-pigeon busy cursor.
- Coo the pigeon delivering balloons, now and then with a joke, never while you type, easy to hide.

**Done when** a returning visitor finds their icons where they left them, and can send Coo away for good.

### Lighthouses for everyone

- Lighthouses anyone can run (Raspberry Pi, old laptop, server; Docker and one config file), serving their owner and friends unless opened wider.
- Quotas, a mirror list and a refusal list.
- You choose your Lighthouses (the official one and your friends' by default).
- Lighthouses mesh, mirroring sealed mail and pages with content-addressed ids and tombstones ([0037](decisions/0037-the-lighthouse-and-its-mailbox.md)).
- They relay signaling, so no server of ours is needed.
- A Lighthouse can serve Pigeon itself from release builds checked against the maintainer's signed hash. Pigeon says whether it's an official build.
- Each address keeps its own identity, so moving to another Lighthouse's Pigeon is linking a device.

**Done when** someone who runs their own Lighthouse needs nothing of ours, and their friends open Pigeon from it.

## Decisions before code

- Private rooms (0.5.0) follow [0026](decisions/0026-pair-rooms-from-a-shared-secret.md), now accepted. They came first because the leak they close was live, and every friendship made before them had to move.
- Your devices (0.5.0 to 0.7.1) follow [0024](decisions/0024-a-signed-list-of-devices.md), now accepted, with only the first device managing the list, and the recovery key follows [0027](decisions/0027-a-recovery-key-that-outranks-devices.md) and [0030](decisions/0030-the-recovery-key-beside-the-chain.md), now accepted: it outranks every device, makes whichever device it's used on the writer, and only it can replace itself. Your devices came before Async invites so invites and letters are sealed to every device from the start; Groups adds the self space that syncs your own data between devices.
- Explorer on this computer (0.6.0) follows [0032](decisions/0032-explorer-on-this-computer-first.md): Explorer, PigeonHTML and in-world Help for pages that ship with Pigeon, built alongside the protocol work; Pigeonweb adds the peer net to it.
- The Lighthouse (0.8.0) follows [0037](decisions/0037-the-lighthouse-and-its-mailbox.md), now accepted: Lighthouses reached over WebSocket, with mail sealed to devices under daily tags, so any Lighthouse can carry anyone's mail. It rewords the brief's rule on servers, since an official Lighthouse is a server the maintainer runs that holds only mail it can't open or attribute, and supersedes 0005's "the Lighthouse is hosted separately". The mailbox that [0024](decisions/0024-a-signed-list-of-devices.md) and [0026](decisions/0026-pair-rooms-from-a-shared-secret.md) expect to come with async invites is this one.
- Async invites (0.8.0) follow [0038](decisions/0038-invite-links-through-lighthouses.md), now accepted: invite links with their own time and number of uses, a card signed with the inviter's newest device log, requests sealed to the inviter's devices and answers under a reply secret only the asker knows. It drops the "Live invites only" setting, since codes are the live way.
- Letters' first part (0.8.0) follows [0039](decisions/0039-messages-through-lighthouses.md), now accepted: messages written while a friend isn't connected go as letters through the Lighthouses, carrying the chat's own signed entries, with each message saying where it is. One-time prekeys for forward secrecy, mutual friends as carriers and rotating tags come in 0.10.0 · Forward secrecy, with a decision of their own.
- Groups (0.9.0) need a decision on shared spaces, written with MLS in mind, that chooses between per-device sessions with MLS and sender keys for groups and forward secrecy alike; and one on push subscriptions, since the Lighthouse would hold them.
- Files (0.11.0) needs a decision on Lighthouses holding sealed file chunks before its code, since it changes the Lighthouse's limits and quotas.
- Pigeonweb (0.12.0) needs a decision on how chunks are named and what a site's manifest holds, which also says what a mirror checks; and one on what a Lighthouse operator can refuse to serve, and how, since it's the first time a Lighthouse serves content to anyone who asks.
- Lighthouses for everyone needs a decision on Lighthouses run by others: trust defaults, what an operator sees, and signed release builds for a Lighthouse that serves Pigeon.
- What's new's release notes are [0025](decisions/0025-release-notes-for-people.md), which supersedes the "no changelog file" part of [0021](decisions/0021-releases-with-release-please.md).
- The birds from Avatars, the cursors from Desktop life and Coo are drawn for Pigeon, never copied ([0007](decisions/0007-original-and-openly-licensed-assets-only.md)).

## Later, not yet scheduled

- Public places, after Lighthouses for everyone: a lobby, public groups, starter pages and Coo as a bot (Desktop life gives him his body), with moderation designed first. Moderation stacks: Lighthouses and friends publish signed labels and block lists, and you choose whose to follow; a report button and a written policy come before any public feature, and a decision on how labels stack before any code.
- Message boards on the peer net, after Pigeonweb and public places: public spaces with threads ordered by bump, an owner's moderation log and proof-of-work per post; pseudonymous, never anonymous, and text only, with no image uploads.
- A living Pigeonweb, worked out in [roadmap-pigeonweb.md](roadmap-pigeonweb.md): homepages with guestbooks, counters and webrings, message boards, online journals with friends-only entries, a directory, What's New and search, small widgets and in-world sites that ship with Pigeon, with options for public storage on Lighthouses, finding a site whose hosts are offline, live channels that hide visitors' addresses, spam, personas and moderation. It settles the boards item's proof of work, which the mailbox design rejected for phones.
- "Pocket keeps watch": a native Android mode that turns a spare phone left on power and Wi-Fi into a small Lighthouse for you and your friends, like Briar Mailbox.
- Introductions: a friend introduces two of their friends, nothing happening unless both agree, perhaps through private and third-party Lighthouses.
- Letting more than one device manage the list. It needs its own decision: [0024](decisions/0024-a-signed-list-of-devices.md) keeps the list to one writer because three reviews broke every way of letting several devices change it at once. Handing the writer's role to another device is done with the recovery key ([0027](decisions/0027-a-recovery-key-that-outranks-devices.md)).
- A transparency log of device lists, kept and cross-checked by Lighthouses, so a fake device slipped into someone's list gets noticed.
- Handles verified by a domain (`toms.dev` publishing `pigeon=<PeerId>`), optional and beside petnames.
- Real-time games, games made by other people (sandboxed, ask first), and hidden-hand card games.

Not planned: a blockchain. Nothing in Pigeon needs strangers to agree on one global order; signatures, petnames and the transparency log cover what it would.

## Former milestone names

Decision records written before releases took over cite pieces of work by these numbers. This table says which release, or which named piece further off, holds that work now.

| Former name                     | Now                                                                         |
| ------------------------------- | --------------------------------------------------------------------------- |
| M1 · Desktop shell              | 0.2.0 to 0.4.0                                                              |
| M2 · Two tabs talking           | 0.2.0 to 0.4.0                                                              |
| M3 · Files                      | 0.11.0 · Files                                                              |
| M4 · Letters                    | 0.8.0 (letters through Lighthouses) and 0.10.0 · Forward secrecy (the rest) |
| M5 · Pigeon Explorer            | 0.12.0 · Pigeonweb                                                          |
| M6 · Lighthouses for everyone   | Lighthouses for everyone, further off                                       |
| M7 · Async invites              | 0.8.0                                                                       |
| M8 · Groups                     | 0.9.0 · Groups                                                              |
| M9 · Games                      | Games, further off                                                          |
| M10 · Avatars                   | 0.5.0                                                                       |
| M11 · Desktop life              | Desktop life, further off                                                   |
| M12 · What's new                | 0.5.0                                                                       |
| M13 · Your devices              | 0.5.0 (linking) and 0.6.0 to 0.7.1 (the rest)                               |
| M14 · Pigeon on your phone      | 0.9.0 · Groups                                                              |
| M15 · Private rooms             | 0.5.0                                                                       |
| M16 · Lighthouse                | 0.8.0                                                                       |
| M17 · Explorer on this computer | 0.6.0 to 0.7.1                                                              |
