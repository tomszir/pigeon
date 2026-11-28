# Roadmap: a living Pigeonweb

Ideas for turning Pigeonweb into a small retro internet that feels alive, worked out far enough to show each can be built on Pigeon's design, with options for what that design doesn't cover yet. None of it is scheduled.

This is a companion to [roadmap.md](roadmap.md), linked from its "Later, not yet scheduled" list. When a piece here is scheduled, it moves into roadmap.md as a release or part of one, and the choices marked **To decide** become decision records first. Where a choice has a leaning, it's a starting point for that decision, not the decision.

## The goal

Pigeonweb should feel like the web of 2003 on a busy evening: pages to find, signs that other people were here, and things that changed while you were away. It has to feel that way with very few people, and it has to keep working when a page's owner is offline.

A test for the whole thing: someone with no friends on Pigeon yet opens Explorer, finds twenty pages worth reading, signs a guestbook and joins a board; the next day, with the guestbook's owner never having been online at the same time, they find a reply.

## What everything is built from

Every kind of site below is made of the same five parts. Most of them exist or are planned already.

1. **Pages.** A page is a PigeonHTML snapshot: content-addressed chunks (named by their hash, so anyone can serve them and anyone can check them) and a small manifest signed by the owner with a version number. The newest validly signed version wins. Pages stay static, with no scripts, as [pigeonhtml.md](pigeonhtml.md) requires (the roadmap's Pigeonweb and Files, [0004](decisions/0004-pages-limited-to-2000s-html-css.md)).
2. **Widgets.** Interactive bits are server-side-include comments that Explorer draws (`<!--#include widget="guestbook" -->`). A widget's content is shown inside the page's frame as sanitized, static PigeonHTML. Anything you type into one opens a Pigeon dialog outside the page, so a page can't fake, prefill or read a post (see gap 11).
3. **Public logs.** Guestbooks, threads, comments and votes are signed append-only logs, the same mechanism chats use ([0003](decisions/0003-signed-append-only-logs-not-yjs.md)). Each log has an id like `log:<owner id>/<name>`. Each entry is signed by its author together with the log's id. Next to every public log sits a **moderation log**, written only by the owner and the moderators the owner names. It hides entries and bans keys. Readers and hosts apply it; hidden entries show as "removed by a moderator".
4. **Hosts.** Copies of pages and logs live in four places: the owner's tab, friends' tabs that mirror them, Lighthouses that host public content (pages for their owner and their friends come with Pigeonweb; more is gap 1), and, for friends only, the tabs of visitors who have the page open. The status bar always says which one served what: "Hosted by Mika", "Mirrored by 3 friends", "Carried by Lighthouse Harbor".
5. **Live channels.** Things that happen now (a shoutbox, a chat room, "3 reading this page") go through a Lighthouse that pushes new entries to whoever is watching, never through public WebRTC rooms (gap 3).

The rest of this document is kinds of sites made from those parts, then ways to make it feel alive with few people, then the gaps and the options for each, then an order to build in.

## Kinds of sites

Each entry says what it is, how it's built, and what it needs that doesn't exist yet. "Friends" means it can work among friends before anything public exists.

### Personal homepages

The GeoCities page: a background tile, a marquee, an "Under construction" GIF, a hit counter, "Last updated November 25, 2026", a wall of 88×31 buttons, a webring at the bottom and "Sign my guestbook!".

- **Built from** pages and widgets: `counter`, `guestbook`, `webring`, `last-updated` (from the manifest's signed date, so it can't lie about being fresh).
- **Hit counters** can't be counted honestly without a centre, so each host counts what it served and the counter says so. Options: each hosting Lighthouse counts manifest fetches per day and signs its count, and the widget adds the counts it can get (leaning, and "counted by 2 Lighthouses" in its tooltip); or visitors sign a visit entry (spammy and leaks who visited); or count only guestbook signatures. Counters were never accurate in 2003 either.
- **Needs**: page hosting (Pigeonweb), and a public store for anyone beyond friends (gap 1).

### Guestbooks

The first interactive thing most people put on a page, and the easiest to build.

- **Built from** a public log per page. Signing it opens a Pigeon dialog with your name (your bird beside it), a homepage address and a message of at most 1000 characters, text only.
- **When the owner is offline**, the entry goes to the page's mirrors and its hosting Lighthouses, and the owner's Pigeon picks it up later. The owner's moderation log hides entries; new entries can be held for approval if the owner chooses.
- **Limits**: 500 shown entries per guestbook, older ones paged; a host may cap entries per signer per day.
- **Friends first**: a guestbook that only friends can sign needs no spam defence at all.

### Webrings

"This Pigeon Fan Ring site is owned by Mika. [Prev] [Random] [Next] [List sites]."

- **Built from** a ring log owned by the ring's keeper: members joining and leaving, in order. The `webring` widget reads it to find the neighbours.
- **Joining** is a letter to the keeper (`mail:ring-join`), approved when they're next online; the ring keeps working while the keeper is away because its log is mirrored like any page.
- **A dead member** (no host answers for a week) is skipped by Next and shown greyed in the list, so a ring doesn't break when one page goes down.
- **Friends first**: a ring among friends works as soon as pages are hosted.

### Message boards

The phpBB and UBB boards of the time: forums, threads ordered by the latest reply ("bump"), stickies, signatures, post counts with ranks (Fledgling, Homing Pigeon, Carrier, Pigeon Elder), your bird as your avatar, moderators, and "Your account is awaiting approval by an administrator".

- **Built from** a board manifest signed by the owner (forums, rules, moderators, who may post), a log per thread, and an index log per forum of thread starts. Bump order is worked out by readers from each thread's newest post.
- **Time**: authors' timestamps can be forged to pin a thread to the top, so public boards order by the time the board's home Lighthouse received each post, which it signs (gap 6).
- **Size**: threads show 25 posts a page; a thread log holds at most 2000 posts, then continues as "Part 2". Moderators sign checkpoints so new readers fetch a checkpoint and the posts after it, not the whole history (gap 7).
- **Who may post** is the board's policy, set by its owner: approval by a moderator (the default, and authentic), vouching, invitation only, or open with posting tokens (gap 4).
- **Text only**, with no image uploads, so a board never hosts pictures someone shouldn't. Pseudonymous, never anonymous: you post as a public persona (gap 10).
- **Friends first**: a private board for a group of friends is a group space (from Groups) with threads, and needs none of the public machinery.

### Online journals

LiveJournal's shape: entries with a mood and "now listening", comments, and posts set to public, friends-only or a custom group. The **Friends page** gathers your friends' newest entries in one list.

- **Built from** a journal log of entries. Public entries are plain signed entries. Friends-only entries are encrypted under a **friends key** that your Pigeon sends to each friend in sealed mail; removing a friend starts a new friends key for later entries. Old entries stay readable to whoever had the key then, and Pigeon says so where you remove a friend (gap 8).
- **Comments** are a log per entry; a comment on a friends-only entry is encrypted under the same key.
- **The Friends page** is built by your own Pigeon, which fetches your friends' journal heads from their hosts; nobody else learns whose journals you read beyond the hosts you fetch from.
- **Friends first**, and the strongest early feature: it fits private groups and shows activity from the people you care about.

### Finding things: the portal, search and What's New

- **A directory** in the Yahoo style, with categories ("Arts > Pixel Art > Pigeons"), kept by editors who sign their category lists. "Suggest a site" is a letter to the editors. "Random page" picks from it.
- **What's New on Pigeonweb**: Lighthouses that host public pages publish a signed list of pages published or updated today, only for pages whose owners ticked "List my page in What's New". Explorer's start page shows it.
- **Search ("PigeonSeek")**: Lighthouses that opt in crawl the public pages they host or that are listed in the directory, and answer queries. The Lighthouse you search through sees your query, and the search page says so. Later, an index split by word hash across Lighthouses (gap 2) lets a Pigeon fetch the few index pieces for its words instead of asking one server.
- **Top sites, awards and Site of the Week** are editorial: a list someone keeps and signs. Vote buttons count signed votes, one per persona per day, and say "unscientific poll" on the results, which is honest and authentic.

### Small widgets

- **Polls**: votes are entries in the poll's log, one per persona. Open polls are easy to stuff, so their results say "unscientific"; friends-only polls count friends.
- **Quizzes** ("Which pigeon are you?"): the questions and results are in the page itself and the widget works them out on your computer. Nothing goes over the network, and you can post your result to your journal. Buildable with nothing new.
- **Shoutbox (tag board)**: a short log of the last 50 lines, shown live through a live channel.
- **E-cards**: a letter with a card design picked from cards drawn for Pigeon.
- **Adoptables**: a site hands out pixel pigeons, each with a certificate signed by the site (picture, name, who adopted it). The `adopted` widget checks the signature and links back to the site it came from. Cheap, original and very 2003.

### Group places

- **Fan sites and shrines** are ordinary pages; the 100 KB budget per page turns a big site into many pages, as dial-up did.
- **Cliques** are webrings without the navigation: a signed member list and a button for your page.
- **Galleries** of pixel and ASCII art, a page per few pictures.
- **A trading post** for in-world things (adopted pigeons, buttons, badges), no money.
- **High scores** come from Pigeon Games' signed move logs, so a score can be checked by replaying it.
- **Text adventures**: single-player ones run in your own tab, like quizzes, from a game file on the page. A multiplayer MUD needs something always on to run it, a Lighthouse that offers it or Coo in the host's tab, and waits.
- **Zines and newsletters** are journals with issues; "subscribe" adds them to your Friends page, which shows a "New issue" badge.

### Wikis

The hardest kind, because one page edited by many people is what Pigeon's logs deliberately don't do ([0003](decisions/0003-signed-append-only-logs-not-yjs.md)). One shape that fits: a wiki has an owner and a list of editors; each page's versions are signed entries in its own log; the newest version by an editor wins, and two versions made from the same parent show as "Edit conflict" with both kept until an editor picks. Visitors who aren't editors suggest changes by letter. **To decide**, and last.

## Making it feel alive with few people

The biggest risk is an empty Pigeonweb. These help even with a handful of users, and most of them need nothing new.

- **In-world sites that ship with Pigeon**, served "On this computer" like Help: _The Pigeon Times_ (news about Pigeon's own releases, written in-world), the directory with starter sites, "Make Your First Homepage" tutorials, and a few homepages by made-up people in a made-up town, labelled as part of Pigeon. All original, never imitating a real company or person ([0007](decisions/0007-original-and-openly-licensed-assets-only.md)).
- **Signs of your friends**: "Mika updated her homepage" in the buddy list and a balloon, the Friends page, "Toms signed your guestbook". Among friends, activity is real and easy.
- **Signs of strangers**, once there are public hosts: the What's New list, guestbook counts, "3 reading this page" from a live channel, a counter that moves.
- **Coo**, the bot in your tab, labelled as a bot: he can show you around Pigeonweb and point at today's What's New. He never posts as if he were a person.
- **Things that change on their own**: seasonal themes on the bundled pages, a Site of the Week, a counter passing a round number.

## Lighthouses as the backbone

Public sites need always-on hosts, and with many people, many Lighthouses. These ideas come from the same brainstorm and underlie gaps 1 to 3.

- **Lighthouses talking to each other.** Mail can already be mirrored safely: it's sealed, content-addressed and can't be tied to anyone, and a drop value proves itself to any Lighthouse that holds its hash, so tombstones can be gossiped without trust (Lighthouses for everyone, [0037](decisions/0037-the-lighthouse-and-its-mailbox.md)). Mirrors must carry a blob's original expiry, and traffic between Lighthouses needs its own limits. Public content mirrors the same way, and is simpler, since anyone can check a signature.
- **Supernodes, the way 2003 did it.** Browsers can't take incoming connections, so the mesh is between Lighthouses only, and a client talks to the one or few it chose. Kazaa and early Skype worked this way.
- **Public Lighthouses added for you.** Nothing can prove what code a server runs, so checking a Lighthouse means checking what it does and making fakes costly: test blobs put and fetched later from elsewhere build a record of whether it keeps what it's given; vouches signed by operators you trust (your friends', the official ones), time in the directory and a domain it can prove make a thousand fake Lighthouses expensive. Defaults trust in that order: friends' Lighthouses, then vouched ones, then the rest. Strangers' Lighthouses hold public content and pointers, never all of your mail. **To decide** with the decision on Lighthouses run by others that Lighthouses for everyone needs.
- **Sharding where it helps.** Mail already has its shard: the recipient's own Lighthouse list, as email has MX records. Spreading mail by tag across strangers' Lighthouses would show your address and tags to more operators for little gain. Public things are where sharding pays: owner ids, page hashes and search words spread evenly, so `H(key)` to the nearest _k_ Lighthouses (Kademlia-style) is a natural index once there are too many Lighthouses to gossip everything (gap 2).

## Gaps and options

What Pigeon's design doesn't cover yet, with options and a leaning for each. Each becomes a decision record before its code.

### 1. Public storage on Lighthouses

The mailbox holds sealed blobs under tags for at most 30 days, deleted by drops. Public sites need things that last: chunks, the newest manifest per owner, and logs that grow.

Part of this is scheduled: Files gives Lighthouses a store of sealed file chunks, within quotas, and Pigeonweb has a Lighthouse serve public page chunks and signed site manifests for its owner and their friends on that store, with decisions on chunk names, site manifests and what an operator can refuse. What's left here is opening that store to anyone, and logs.

- **A. Reuse the mailbox** with public tags (`H(log id)`), owners and mirrors putting again before expiry. Nothing new on the Lighthouse, but nothing outlives its 30 days without someone online to put it again.
- **B. A public store beside the mailbox**: `chunk put/get` (content-addressed), `head put/get` (an owner-signed manifest; the highest version is kept), and `log append/since` (signed entries, checked by the Lighthouse, which can read them since they're public). Kept for as long as the operator's policy says.
- **Leaning B.** Operators choose what they host: their own pages, their friends', pages listed in the directory, or open to anyone with quotas per owner. Owners say which Lighthouses host their site the way they say where their mail goes. Unlike mail, operators can see what they host, so a refusal list and a report path come with it (gap 5).

### 2. Finding a site when nobody who has it is online

Today an address is resolved by joining the owner's page room, which needs a live peer.

- **A. The owner's `hello`** lists their Lighthouses. Works for friends only.
- **B. A signed pointer**: "my site is hosted at these Lighthouses", signed by the owner, kept in the Lighthouse directory and gossiped between Lighthouses that mesh.
- **C. A DHT over Lighthouses**: the pointer kept by the _k_ Lighthouses nearest `H(owner id)`.
- **Leaning A, then B, then C.** Pointers are a few hundred bytes, so gossiping all of them stays cheap well past a million sites; a DHT waits until it doesn't.

### 3. Live features without showing visitors' IP addresses

A public WebRTC room shows every visitor's IP address to every other visitor, which the mailbox design ruled out for good reason. Live public features (shoutboxes, chat rooms, "who's here") and strangers fetching chunks from each other's tabs both run into it.

- **A. TURN only for public rooms.** Hides addresses from other visitors, but every public byte goes through a paid relay, and the signaling relays still see who joins which public room.
- **B. A `watch` operation on Lighthouses**: subscribe to a log or channel and have new entries pushed, plus `say` for ephemeral lines that aren't stored. Visitors see each other's personas, never addresses. Hibernating WebSockets suit it.
- **Leaning B**, with per-channel rate limits. Strangers fetch chunks from Lighthouses; only friends serve each other from their tabs.

### 4. Spam, when keys cost nothing

Anyone can make a thousand identities. The roadmap's boards item plans proof of work per post, but the mailbox design rejected proof of work because it costs phones more than attackers; that disagreement is settled here.

- **Approval** by a moderator for new posters. Authentic and strong; slow when moderators are away.
- **Vouching**: a member vouches for a newcomer, a few times a week, and loses the right if they vouch for a spammer.
- **Account age**: a persona must have been first seen by the board's Lighthouse some days before it can post, which costs an attacker time, not money.
- **Posting tokens** from Lighthouses: a Lighthouse hands each address range a few anonymous tokens a day (blind signatures, as Privacy Pass does), and a post spends one. Limits posting by address without tying a post to an address. Strong, and the most work.
- **Proof of work**: small, and only alongside one of the others.
- **Leaning** a per-board policy chosen by its owner from approval (default), vouching and invitation only, with account age as an add-on; posting tokens later, for open boards. Proof of work dropped.

### 5. Moderating public content

- **On a site**: the owner's and moderators' moderation log, applied by readers and hosts.
- **Across Pigeonweb**: Lighthouses and friends publish signed labels and block lists, and you choose whose to follow (already in the roadmap's public places item). A report button sends a letter to the site's owner and to the operators of the Lighthouses hosting it.
- **On a Lighthouse**: the operator can see public content and removes what breaks their policy; it's their store. The official Lighthouses publish a written policy before they host anything public.
- **To decide** before any public feature, as the roadmap already requires.

### 6. Time and order

Authors' timestamps are their own claim. Among friends that's fine; on a public board a post dated next year stays on top.

- **A. Clamp**: hosts refuse entries dated more than a few minutes ahead of their own clock.
- **B. Host stamps**: the board's home Lighthouse signs the time it received each entry, and readers order by it.
- **Leaning A for everything and B for public boards**, which is honest: it's the host's view of when things arrived.

### 7. Logs that grow

A busy guestbook or thread grows without end, and a new reader shouldn't fetch years of it.

- Separate logs per thread, page or entry, as above, with caps.
- **Checkpoints**: the owner or a moderator signs "everything up to here hashes to H", so a new reader fetches the checkpoint and the entries after it. Hosts may then forget hidden entries from before it.

### 8. Friends-only content that lasts

Mail expires after 30 days, so it can't hold a journal.

- **A. Seal each entry** to every friend's devices, as mail is. Simple, but costs a wrap per device per entry, and a new friend can't read old entries.
- **B. A friends key** sent to friends in mail and used to encrypt entries kept in the public store; a new key after a removal.
- **Leaning B**, and designed with group keys (from Groups), which have the same shape: a key for a member list, replaced when someone leaves. If groups take up MLS, friends-only content could be a group of your friends.

### 9. Counting visitors

Covered under homepages: **leaning** counts signed by each hosting Lighthouse, added up by the widget, and labelled with who counted.

### 10. Who you are on public sites

Posting everywhere with your Messenger identity would let anyone tie your public life to the id your friends know, and track it.

- **A public persona** per Pigeon, a separate key with its own name and bird, used on boards, guestbooks of strangers and public polls. Linking it to your Messenger identity is a choice, made with a signature both keys give, and can be shown only to friends.
- **One persona per board**, for people who want their boards kept apart.
- **Leaning** one public persona by default, more if you want them, and the Messenger identity never used in public unless you link it. Pseudonymous, never anonymous: a persona is a key that signs everything it posts.

### 11. Widgets that a page can't abuse

A widget is drawn by Explorer, but it sits in a page someone else wrote.

- A widget's content is rendered as sanitized static PigeonHTML inside the page's sandboxed frame, so it can show entries but do nothing.
- Every action (sign, post, vote, adopt) opens a Pigeon dialog outside the page, saying whose page and which persona, so a page can't prefill text, fake a button or post without you seeing it.
- A page chooses a widget's colours from a short list of attributes, never its layout or its text.

## An order to build in

Each step is useful by itself, and the later ones need the decisions above.

1. **On this computer**, with nothing new on the network: the quiz and single-player text adventure widgets, the in-world sites that ship with Pigeon, and widgets drawn as static HTML with their dialogs (gap 11).
2. **Among friends**, after pages are hosted, with Lighthouses mirroring them for their owner and friends (Pigeonweb), and Groups: guestbooks, webrings and cliques among friends, journals with friends-only entries and the Friends page (gap 8), private boards as group spaces, "Mika updated her homepage".
3. **Public hosting**, after Lighthouses mesh (Lighthouses for everyone): the public store (gap 1), signed pointers (gap 2), What's New, the directory, counters (gap 9), personas (gap 10).
4. **Public and interactive**, after moderation (gap 5) and spam (gap 4) are decided: public boards (gaps 6 and 7), polls, shoutboxes and chat rooms over live channels (gap 3), awards and top sites.
5. **At scale**: search across Lighthouses, an index split across Lighthouses, posting tokens, wikis.
