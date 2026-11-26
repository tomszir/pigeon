# Roadmap

What each release brought, what the next releases will bring, in build order, and the check that says each piece is done.

## Goal

Private groups first. The releases from 0.8.0 on build toward one test: a small group of friends (5 to 12) has its own place on Pigeon, and it works even when they're never online at the same time. The Lighthouse came first because invites, letters, device sync, groups and push all need the same thing from it: somewhere that holds sealed mail while people are away. Public places wait until their moderation is designed.

Verification of the crypto and protocol runs as a track of its own beside these releases, never holding one up: [roadmap-verification.md](roadmap-verification.md).

## How releases are named

Work that has shipped sits under the version it shipped in. Work that is scheduled gets a version only once it's among the next few releases, and it matches a GitHub milestone of the same name; work further off is listed by name alone. Reordering what's far off therefore never renames anything. Pieces of work used to have numbered milestone names, which older decision records cite; the table at the end says where each now lives.

## Released

What each release brought, with each piece's scope, its done check, and where it stands.

### 0.2.0 to 0.4.0

0.2.0 brought the desktop and the first chats, 0.3.0 the TURN relay that lets friends on different networks reach each other, and 0.4.0 the friend menu (profile, petname, fingerprint, mute, remove and block) and pairing that shows each step.

#### Desktop shell

Stage and scaling, window manager, taskbar, menu, tray and balloons, the UI kit from the canvas's Components board, Read Me window.

**Done when** the canvas's Desktop board works offline with no P2P at all.

**State:** built. The desktop boots offline with Read Me open; the Messenger shows the real, empty state; the Desktop board's sample conversation it once offered is gone, so everything on screen is real. Letters, Shared Files and Pigeon Explorer open an in-world "still being built" message. Window positions and settings live in memory only.

#### Two tabs talking

Identity, pairing by link and QR, pair rooms, Messenger with buzz and typing; adds Trystero and Playwright.

**Done when** two browsers on different networks chat.

**State:** built, pending its done check across two real networks. Each visitor gets a WebCrypto identity kept in IndexedDB; Add a Friend shares a one-use invite as a code to type, a short link and a QR code, and adds a friend only after showing who answered and their fingerprint; the Messenger lists real friends with presence, and conversations carry messages, buzzes and "is writing" (shown as the transcript's last line) over Trystero, note when the friend comes online or goes offline, and keep chats and catch them up between visits. `mise run e2e` pairs and chats two isolated browsers over the public relays. Shell settings and window positions still live in memory only. On phones Pigeon runs on the Kestrel Pocket ([0019](decisions/0019-the-kestrel-pocket-phone-layout.md)).

### 0.5.0

#### Avatars

A pixel pigeon for everyone, drawn from the hash of their id from parts drawn for Pigeon (plumage, markings, eyes, accessory, tile), the same on every Pigeon and never sent; shown in the buddy list, chats, profiles and pairing, beside the fingerprint, never instead of it.

**Done when** two Pigeons draw the same bird for Mika, and the pairing screen shows it next to her fingerprint.

**State:** built, pending its done check. Everyone has a pixel pigeon drawn from their id, frozen per version with the version said in `hello` ([design.md](design.md#avatars)), shown in the buddy list, conversations, profiles, Blocked People, the Pigeon menu, Add a Friend, Today on the Pocket and balloons.

#### What's new

Changelog.txt on the desktop: notes written in plain words for each release, newest first, saying what changed for the people using Pigeon (not commit subjects); a balloon after an update, "Pigeon was updated to 0.4.0. See what's new?", that opens it; none on a first visit.

**Done when**, after a release, a returning visitor is told once and reads what changed without knowing what a commit is.

**State:** built, pending its done check on a release. Changelog.txt sits on the desktop with notes for every release since 0.2.0, and the release-please workflow drafts each new release's section on the release PR for the maintainer to rewrite ([0025](decisions/0025-release-notes-for-people.md)). A returning visitor on a newer version gets a balloon, "Pigeon was updated to 0.5.0. See what's new?", once; a first visit gets none.

#### Private rooms

Pair rooms named and locked by a secret only the two friends hold, renamed every UTC day ([0026](decisions/0026-pair-rooms-from-a-shared-secret.md)); existing friends move over the next time they meet; the browser asked to keep Pigeon's storage, and iPhone users told to add it to the Home Screen; an "Always go through the relay" setting that hides your IP address from friends.

**Done when** someone who knows Toms's and Mika's ids can't tell from the relays when they're online, read their connection offers or join their room.

**State:** built, pending its done check on the live relays. Pairing sends a pair secret in `pair-accept`, and friends meet in a room named from it and the UTC date, locked with a password derived from it, with both days' rooms joined around midnight ([0026](decisions/0026-pair-rooms-from-a-shared-secret.md)). Friends from before it move the next time they meet in the old room, and then stop joining it. The browser is asked once to keep Pigeon's storage. On an iPhone or iPad in a Safari tab, a balloon (once) and Add to Home Screen.txt on the desktop say how to keep Pigeon, and a web app manifest makes the Home Screen icon open Pigeon as its own app, on iPhone and Android alike; Web Push and the rest of installing (an install prompt, offline start) come with 0.9.0 · Groups. Always Go Through the Relay is in the Messenger's File menu and in Settings, under Connection.

#### Your devices, first part: linking

Linking a phone, laptop or desktop in person, so friends see one friend across your devices. The rest of Your devices came in 0.6.0 to 0.7.1, where its full scope and state are.

### 0.6.0 to 0.7.1

#### Your devices

Each device keeps its own key, tied to one identity by a signed log of devices ([0024](decisions/0024-a-signed-list-of-devices.md)); linking a phone, laptop or desktop in person by QR code and a short code; removing a lost one from the first device, which alone manages the list; friends see one friend; the friends list comes along when linking, and chats catch up through pair rooms; a device list naming each one with its own fingerprint ("Laptop · Firefox · 3f9a 21c0"), never a browser fingerprint; a copied browser profile noticed (one device key seen in two places: "This Pigeon is also open somewhere else") and offered to link as a new device; your data (friends, petnames, chats, settings) exported to a file sealed with a passphrase and imported on a linked device, and "Save conversation as..." to a .txt; a recovery key made with the identity and kept once, printed or saved behind a passphrase, that can add a device when every device is gone. 0.7.0 added merging a Pigeon started separately on another device into the one you keep.

**Done when** Toms links his phone to his laptop, Mika sees one Toms, and a message sent from the phone shows on the laptop too; with both lost, the recovery key brings Toms back as Toms.

**State:** built, pending its done check on two real devices: linking, one friend across devices, removing, device fingerprints in the list, noticing a copied browser profile (with Pigeon kept to one tab, [0028](decisions/0028-one-tab-and-copied-profiles.md)), export and import ([0029](decisions/0029-your-data-in-a-file-for-your-own-devices.md)), Save conversation as, and the recovery key ([0027](decisions/0027-a-recovery-key-that-outranks-devices.md), [0030](decisions/0030-the-recovery-key-beside-the-chain.md)). Each device keeps its own key, tied to one identity by a signed device log ([0024](decisions/0024-a-signed-list-of-devices.md)). File, Link a Device shows a code and QR code; the new device opens the link or types the code in Link to My Other Device, both show the new device's fingerprint, and confirming on the old device hands over the name, friends (with their pair secrets), blocks and settings. Only the first device links and removes devices; My Devices lists them, each with its own fingerprint, with Remove there. A stolen second device can't touch the list. Friends see one friend with several devices, and messages from either device reach the other, through the friend or straight between your devices in the pair room. Your devices also meet in a self room, so removals reach them with no friend online. Friends on a Pigeon from before device logs hear only your first device until they update. Profiles are copied when linking, and afterwards your name and personal message stay in step through the self room ([0036](decisions/0036-your-name-on-all-your-devices.md)); the self space that Groups brings does the rest.

#### Explorer on this computer

PigeonHTML's allowlists, sanitizer and validator (parse5); Pigeon Explorer with its toolbar, address bar, status bar and the "page not hosted" screen; in-world Help at `pigeon://help`: "How Pigeon Works" for people, and "The Pigeon Protocol" generated from docs/ ([0032](decisions/0032-explorer-on-this-computer-first.md)). Built alongside the releases around it.

**Done when** Pigeon Explorer opens `pigeon://help`, follows its links, and shows "page not hosted" for anyone's page.

**State:** built, pending its done check on the live site ([0032](decisions/0032-explorer-on-this-computer-first.md)). Pigeon Explorer opens from the desktop's menu, on the Pocket too, at its start page `pigeon://home`, a hand-written page bundled with Pigeon that the status bar says came from "On this computer". It has Back, Forward, Stop, Refresh and Home, an address bar, and File, Edit, View, Favorites and Help menus; it follows a page's `pigeon://` links, drops every other kind, and shows "page not hosted" for every address it doesn't carry. Pages render through `sanitize` in a sandboxed frame with no scripts. Help in the Pigeon menu opens Explorer at `pigeon://help/`, in-world Help's contents (How Pigeon Works and The Pigeon Protocol), which the start page links to and Favorites lists. The sanitizer and `validate` keep every page to PigeonHTML, within its budget and node limit ([pigeonhtml.md](pigeonhtml.md)).

### 0.8.0

#### Lighthouse

Lighthouses as peers with their own keys ([0037](decisions/0037-the-lighthouse-and-its-mailbox.md)): `packages/lighthouse` run by `apps/lighthouse` (Node, WebSocket, SQLite, Docker and one config file) and `apps/lighthouse-worker` (a Cloudflare Worker and Durable Objects), reached by clients over WebSocket only; the official ones, the Worker and a home server, on by default and listed in Settings, where you add or remove any; a mailbox of blobs sealed to each recipient device's key, under tags rotated daily from the pair or self secret, with a drop and a receipt for each device, kept 30 days at most and put at every Lighthouse on the recipient's list, with limits per address range; farewells, device log changes, your name, your friends and your Lighthouse list through it, so they reach devices and friends who are offline; each device's sealing key in `hello`; what a Lighthouse sees (IP addresses, when they connect, which tags go together) said plainly on a privacy page in Read Me; a protocol version in every handshake, so Pigeons that don't match say so instead of failing quietly.

**Done when** a friend removed while offline is told when they next open Pigeon with only one of the two official Lighthouses up, and nothing either keeps says whom it was for.

**State:** released. A friend removed while offline is told the next time they open Pigeon, and a Network window lists the Lighthouses Pigeon uses and lets you add or remove them ([lighthouse.md](lighthouse.md)).

#### Async invites

Several open invite links at once, each lasting 1 hour to 30 days and for 1 to 25 people, every request approved by the inviter; links and QR codes leave a sealed card at the inviter's Lighthouses and pair through the Lighthouse mailbox; typed codes stay live, since they're too short to carry a secret.

**Done when** Mika opens Toms's link while Toms is offline, and they're friends once Toms opens Pigeon, without ever being online together.

**State:** released ([0038](decisions/0038-invite-links-through-lighthouses.md)).

#### Letters, first part: letters through Lighthouses

Messages written while a friend isn't connected go as letters through the Lighthouse mailbox, carrying the chat's own signed entries, with each message saying where it is and a tick once it's delivered ([0039](decisions/0039-messages-through-lighthouses.md)); sealed sync bundles between your own devices that are never online together. The rest of Letters is 0.10.0 · Forward secrecy.

**Done when** A → Lighthouse → B works with A and B never online together.

**State:** released.

### 0.8.1

A security release. Adding a friend got longer secrets in links and QR codes, typed codes like K7RT-VP2-BXQ, and approval of each person, with their name, fingerprint and bird, before they're added; linking a device shows its fingerprint on both screens; Pigeon checks that a friend's messages come straight from them; a removed device stays removed on every browser; and with "Always go through the relay" on, Pigeon only reaches a Lighthouse a friend names at a public address. The details are in Pigeon's security advisories.

## Scheduled

The next releases, in the order they'll be built. Each matches a GitHub milestone of the same name.

### 0.8.2 · Standard building blocks

Pigeon's own crypto compositions replaced with standard ones: mail sealed with HPKE (RFC 9180) instead of Pigeon's own wrap, and file passphrases stretched with Argon2id instead of PBKDF2; signed entries that say what kind they are in their signed bytes and are compared as bytes; imported data files checked before they're used; the device log's merge rules fuzzed against their invariants; the threat model and the pairing, linking and recovery state machines written down ([threat-model.md](threat-model.md), [state-machines.md](state-machines.md)); pair secrets made before 0.8.1, and other secrets that could have been exposed, replaced.

**Done when** nothing Pigeon seals, stretches or signs uses a construction of its own where a standard one fits, the merge-rule fuzzer runs in `mise run check`, and every friendship and device is on secrets made under the current rules.

### 0.8.3 · Seamless

What didn't hold up across devices and offline: friends, petnames and blocks kept in step across your devices, and a changed name or personal message that takes; mail looked for when you come back to Pigeon, Lighthouses telling a connection when its mail arrives, and Try Again and Check Now for mail; each message's way shown plainly, as an icon with details, with messages that came by letter grouped together.

**Done when** Toms adds a friend on his phone and the friend shows on his PC, and a message sent from the phone shows on the PC within seconds of opening it, without the two ever being open at the same time.

### 0.9.0 · Groups

Shared spaces (a room, a member list, a signed log and an ephemeral channel) that pair chats move onto; private groups of up to 12 with an owner-signed membership log; group invites and group mail through the Lighthouse mailbox, so a group works when its members are never online together; the decision between MLS (RFC 9420) and sender keys for group messages as Lighthouses carry them.

So groups feel alive, Pigeon on your phone comes with them: installable from the browser to the Home Screen; Web Push for every device through the Lighthouse, which holds the push subscriptions and sends nothing or a sealed line, so a closed Pigeon still says something arrived; opt-in per device, with what the push service learns (when, never what) said where you turn it on. On an iPhone, web push works only for Home Screen apps, so there it comes with installing.

**Done when** five friends use a group for a week without any two needing to be online at once, a member who was offline catches up, and a removed member gets nothing new; and Mika's phone, with Pigeon closed, shows that Toms wrote, and opening it shows the message.

### 0.9.x · Hardening

Security hardening after groups, with no known attack, so none of it holds up a release: a formal model of pairing, linking and recovery (in Tamarin or ProVerif), and a rule nobody can steer for settling two recoveries made for the same device log.

**Done when** the formal model shows pairing, linking and recovery keep the properties [threat-model.md](threat-model.md) claims for them.

### 0.10.0 · Forward secrecy

The rest of Letters: letters sealed with one-time prekeys and a ratchet from a maintained library, so a key stolen later can't open letters carriers still hold; online mutual friends as carriers beside the Lighthouse; Letters in Flight saying who carried each one.

**Done when** A → Lighthouse → B and A → C → B both work with A and B never online together, and B can see who carried each letter.

### 0.11.0 · Files

Content-addressed chunks (named by their hash, served by anyone who holds them), progress, accept and decline, resume, "Send when they come online", a picture chooser and your own picture (48×48, dithered, sent as a small file); files in groups, from the same chunks; pairing always shows the bird from Avatars. Lighthouses hold sealed file chunks, within quotas, as they hold mail, so "Send when they come online" works while the sender is offline, and files in groups work when members never overlap.

**Done when** a 50 MB file arrives intact.

### 0.12.0 · Pigeonweb

Resolver, page host and mirrors, page snapshots as lists of Files' chunks, page builder, widgets, webrings and a portal, on the Explorer from 0.6.0. Lighthouses mirror pages: a Lighthouse serves public page chunks and signed site manifests for its owner and their friends, on the chunk store from 0.11.0, and checks what it mirrors as the decision on chunk names and site manifests says.

**Done when** Mika's page loads from a mirror while Mika is offline.

## Further off

Work that will get a version when it's among the next few releases, in this order.

### Games

Pigeon Games: turn-based games as signed move logs on spaces, played live or a move at a time; commit-reveal dice; original and traditional games with nothing hidden; "Invite to a game" from a chat or group.

**Done when** two friends finish a game across separate visits, and it replays from its log.

### Desktop life

Desktop icons that can be selected with a rubber band, dragged, arranged and kept; a Desktop tab in Display Properties with several wallpapers, a solid colour, positions and your own picture kept in this browser; cursors drawn for Pigeon with a flapping-pigeon busy cursor; Coo the pigeon delivering balloons, now and then with a joke, never while you type, and easy to hide.

**Done when** a returning visitor finds their icons where they left them, and can send Coo away for good.

### Lighthouses for everyone

Lighthouses anyone can run on a Raspberry Pi, old laptop or server (Docker and the Lighthouse's config file), serving their owner and their friends unless the operator opens them wider, with quotas, a mirror list and a refusal list; you choose your Lighthouses (the official one and your friends' by default); Lighthouses mesh, mirroring sealed mail and pages to each other with content-addressed ids and tombstones, so a federation of them run by strangers carries mail and pages for everyone ([0037](decisions/0037-the-lighthouse-and-its-mailbox.md)); they relay signaling, so no server of ours is needed; a Lighthouse can serve Pigeon itself, from release builds checked against the maintainer's signed hash, and Pigeon says whether it is an official build; each address keeps its own identity, so moving to another Lighthouse's Pigeon is linking a device.

**Done when** someone who runs their own Lighthouse needs nothing of ours, and their friends open Pigeon from it.

## Decisions before code

- Private rooms (0.5.0) follow [0026](decisions/0026-pair-rooms-from-a-shared-secret.md), now accepted. They came first because the leak they close was live, and every friendship made before them had to move.
- Your devices (0.5.0 to 0.7.1) follow [0024](decisions/0024-a-signed-list-of-devices.md), now accepted, with only the first device managing the list, and the recovery key follows [0027](decisions/0027-a-recovery-key-that-outranks-devices.md) and [0030](decisions/0030-the-recovery-key-beside-the-chain.md), now accepted: it outranks every device, makes whichever device it's used on the writer, and only it can replace itself. Your devices came before Async invites so invites and letters are sealed to every device from the start; Groups adds the self space that syncs your own data between devices.
- Explorer on this computer (0.6.0) follows [0032](decisions/0032-explorer-on-this-computer-first.md): Explorer, PigeonHTML and in-world Help for pages that ship with Pigeon, built alongside the protocol work; Pigeonweb adds the peer net to it.
- The Lighthouse (0.8.0) follows [0037](decisions/0037-the-lighthouse-and-its-mailbox.md), now accepted: Lighthouses in Node and as a Cloudflare Worker, reached over WebSocket, with mail sealed to devices under daily tags, so any Lighthouse can carry anyone's mail. It rewords the brief's rule on servers, since the Worker Lighthouse is a server the maintainer runs that holds only mail it can't open or attribute, and supersedes 0005's "the Lighthouse is hosted separately". The mailbox that [0024](decisions/0024-a-signed-list-of-devices.md) and [0026](decisions/0026-pair-rooms-from-a-shared-secret.md) expect to come with async invites is this one.
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
