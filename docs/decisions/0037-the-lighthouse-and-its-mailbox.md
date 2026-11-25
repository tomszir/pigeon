# 0037: The Lighthouse and its mailbox

A Lighthouse is a peer with its own key that holds sealed mail for devices under tags only the two ends can work out, mirrors that mail to the Lighthouses it meshes with, and is what every later "while you were away" feature is built on.

- Status: proposed
- Date: 2026-11-25

## Context

Everything in Pigeon so far needs both ends online at once. A friend removed while offline is told only if you meet again; a device removed while another is offline hears of it only in the self room; an invite works only while the inviter's tab is open; a message waits in your own log until the friend comes back. The roadmap's M16, M7, M4, M8 and M14 all need the same thing underneath: somewhere that holds a sealed message until its recipient comes for it, without being able to read it or tie it to anyone's name.

The brief allows "the optional Lighthouse peer, which runs the same protocol as everyone else". M6 says anyone can run one on a Raspberry Pi or a server. The author has a homelab of three machines and the site already runs on Cloudflare, and wants a Lighthouse in both places, talking to each other, so nothing is lost when one machine is down.

A review of the first draft found that a mailbox locked only by the pair and self secrets would let a removed device read, delete and forge mail, since 0024 lets a removed device keep those secrets; that a public WebRTC room would hand every client's IP address to anyone watching the relays; and that a Lighthouse can link far more than "nothing". This version answers each.

This is the foundation. M7 (async invites), M4 (letters), M8 (group mail), M14 (push) and 0038 (finding people) each add a kind of mail on top of it, and only what they need from it is decided here.

## Decision

### What a Lighthouse is

- **A peer with its own key.** A Lighthouse has an Ed25519 identity, a name its operator chooses and a fingerprint Pigeon shows. It signs every reply, and Pigeon checks it against the key in the Lighthouse's address, so whoever answers can't pretend to be it.
- **An address** is `{ id, name, url }`, `url` being a WebSocket (`wss://`). It's written as a link, `pigeon://lighthouse/<id>?url=...`, and a QR code.
- **Clients reach Lighthouses over WebSocket only.** One connection to one server: the Lighthouse sees the client's IP address, as any server would, but nobody else does, and clients never meet each other through it. A public WebRTC room would give every client's address to anyone on the relays and connect clients to each other, so it isn't used for clients.
- **Lighthouses reach each other over WebSocket or WebRTC.** The mesh (below) can use a Trystero room locked with a password from a secret the meshed Lighthouses share, so two homelab machines behind NAT still find each other.
- **What a client says.** A connection opens with a Lighthouse `hello` carrying only `protocol` and nothing about the client: no name, no identity, no `instance`. Clients sign nothing to the Lighthouse with their own keys; requests are plain, and the client checks the Lighthouse's signed replies.
- **One package, two runners.** `packages/lighthouse` holds the logic (mailbox, mesh, limits) against a storage interface and no platform. `apps/lighthouse` runs it in Node with a WebSocket server and SQLite (`node:sqlite`), in Docker from one config file, for the homelab now and anyone in M6. `apps/lighthouse-worker` runs it as a Cloudflare Worker, with Durable Objects sharded by tag prefix and hibernating WebSockets, storing in their SQLite.
- **The official Lighthouses** are run by the author: the Worker at `lighthouse.pigeon.tomszir.com`, and Node Lighthouses in the homelab reached through a tunnel. They mesh with each other. Pigeon ships with their addresses and uses them by default; Settings lists your Lighthouses and lets you add or remove any. The UI says which Lighthouse carried what, as the brief's "Honest P2P" asks.

### Mail is for devices, not secrets

- **Sealed to each device.** Every device makes an ECDH P-256 key now and binds it to itself: `{ device, key, sig }`, signed by the device's own signing key, sent in `hello` and kept beside the device log. A device is trusted to seal to only while it's active on the log, and the binding is its own word, so it works for the first device (which has no `add` entry), for devices added before this decision, and for devices kept through a recovery. A piece of mail is sealed once with a random content key (AES-256-GCM), and the content key is wrapped for each recipient device with ECDH from a fresh key of the sender's and HKDF (info `pigeon/mail/wrap`). Only the devices the sender believes are on the recipient's list can open it, so a removed device can still read mail from a friend who hasn't heard of the removal yet, and no longer once they have. Nobody holding an export file (0029) can, since it has no device keys.
- **Tags come from the secrets, and only tags.** A tag is `HMAC-SHA256(secret, "pigeon/mail/v1/" + recipient identity + "/" + UTC date)`, from the pair secret for mail between friends and from the self secret for mail between your own devices. A tag is only where to look: knowing it lets someone see that mail is waiting, never open it.
- **The envelope inside** is signed by the sending device as any envelope is, with `room` set to `mail:<kind>` (`mail:farewell`, `mail:self`, and later `mail:letter`, `mail:invite`, `mail:group`), the recipient's identity, the tag's date, a random id and the sender's device-log head (epoch and sequence). A recipient drops mail it has seen by id, refuses mail whose date is more than a day off the tag's, and never depends on the order mail arrives in.
- **Mail from a device is only taken while that device is on the sender's list.** A recipient whose copy of the sender's log is older than the head in the mail asks for it first (it's put in the mailbox beside the mail, and met in pair rooms), and gathers everything it fetched before acting on any of it.
- **Farewells hold only from a device that's still on the list.** A `farewell` by mail from a device the newest log has removed isn't acted on; a farewell taken before the removal was known is undone once it is. Undoing one clears "removed you" and lets the pair rooms meet again; the chat was never deleted. Since removing a friend is synced between your devices (below), your remaining devices put the farewell again under their own keys, so a real removal still arrives, and a forged one from a lost device doesn't stick. A removal made on a device that is itself removed before your other devices hear of it can't be told from a forgery, and is lost: make it again.
- **Several recipients, one blob.** The format wraps the content key for any number of devices, so one blob serves all of a friend's devices, and later a whole group (M8).

### Removing a device replaces the secrets

- When the writer removes a device (0024), it makes a new self secret and gives it to the remaining devices sealed to each, and replaces each pair secret with each friend: a new `pair-secret` sealed to the friend's devices, by mailbox if they're offline, confirmed with `pair-secret-ok` as friends from before 0026 were moved. A friend takes a new pair secret only from the writer of your newest epoch, with a log head that shows the removal, and only if it was sealed for the friend's own newest list; if it wasn't, the friend answers with that list and the secret is replaced again. If both sides replace the secret at once, the one from the lower identity wins, as in 0026, under the same rule. Old and new tags are both fetched until the new one is confirmed.
- **Until then the removed device can still see that mail is waiting**, when and how much, and put mail of its own under your tags (which nobody acts on, since it's no longer on your list), but not read anything sent after the friend learns of the removal. A friend who stays offline keeps that window open.
- **After a recovery** (0027), the recovered writer has no secrets to replace: friends come back by pairing again, as 0027 says, and pass their new secrets then. Replacing secrets also makes an export file (0029) out of date: importing an older one brings back pair secrets that no longer work, and those friends pair again.
- This amends 0024, under which a removed device kept every secret it was given.

### The mailbox

- **Operations.** `put { tag, blob, expires, drops, work }` stores a blob of at most 64 KB. `list { tags, cursor }` returns, paged, the id and size of each blob under those tags that reached this Lighthouse after the cursor. `get { ids }` returns blobs. `drop { id, key }` uses one drop. The Lighthouse signs each reply, and answers `put` only once the blob is stored at least on itself.
- **Exact tags, said plainly.** A client asks for its exact tags for the days since its cursor. Hiding them in shared buckets was tried in review and gave little: fetching what's yours out of a bucket shows which it was. So a Lighthouse watching live sees which tags one connection asks for and gets mail on, and the privacy page says so; what daily tags protect is what's stored.
- **A drop for each device.** `drops` holds one SHA-256 per recipient device, each of a random value sealed inside the blob for that device alone. A device drops its copy by sending its value. The blob is deleted when every drop is used or it expires, so the first device to fetch it never takes it from the others. Nobody else can drop it: not the Lighthouse, and not another device.
- **Receipts, one per device.** Each recipient device that has taken in mail puts a sealed, signed `receipt` for the sender under the sender's tag, checked against the newest log like any mail. The sender stops putting the mail again for that device once its receipt comes, and keeps putting it every few days for devices that haven't answered, until they do or leave the list. That holds for your own devices too, so a tablet away for longer than a blob lasts still gets the new self secret.
- **Expiry.** A blob is kept until every drop is used or `expires` passes, at most 30 days. A recipient who stays away longer misses what expired; their friends' Pigeons still hold what they sent until a receipt comes, and put it again.
- **Where mail goes.** Each Pigeon has a list of its mailbox Lighthouses (the official ones unless changed), said in `hello` (`lighthouses`) and shared between your devices in the self mailbox. Mail is put at every Lighthouse on the recipient's list that answers. For a friend whose list was never heard, it goes to the official Lighthouses. A Lighthouse you take off your list is still fetched from for 30 days, and your Pigeon leaves a note there, under your pair tags, naming your new list.

### The mesh

- **Lighthouses mirror each other's mail.** A Lighthouse's config lists its peers, other Lighthouses it meshes with. Each blob it stores goes to its peers, and peers catch up on connecting by comparing summaries of blob ids per day.
- **Ids are the content.** A blob's id is the SHA-256 of its tag, blob and drops, so every Lighthouse in a mesh gives it the same id and copies never multiply.
- **Drops are kept as tombstones.** A used drop's value is kept beside the blob's id until the blob would have expired, and passed along the mesh; each Lighthouse checks the value against the stored hash. A peer that missed a drop can't bring the blob back.
- **Cursors are local.** `list`'s cursor counts the order blobs reached this Lighthouse, not when they were first put, so a blob mirrored late is still fetched.
- **Each peer has its own budget.** Mail from a peer counts against that peer's intake, not its senders' limits, so junk that fills one Lighthouse can't flood the rest. A Lighthouse takes mail only from peers on its list. Opening the mesh to Lighthouses the operator doesn't run waits for M6.

### Limits and cost

- **Per address range.** Limits count per IPv4 address and per IPv6 /64: how many puts an hour, how many blobs one tag holds, and how many bytes in total. IP addresses are used for counting and never written to storage.
- **Work to put, as a second line.** `put` carries a small proof of work over the blob's id and a challenge the Lighthouse gave that hour, so it can't be worked out ahead of time. It costs a phone a fraction of a second; it's no match for a determined attacker with fast hardware, so the limits do most of the work. Mail isn't put while a tab closes: a farewell is kept and put when Pigeon next starts.
- **Per address, not per tag.** How many blobs a tag may hold is counted per address range, so nobody who learns a tag can fill it and block the mail meant for it. Limits per IPv4 address are set high enough for carriers that put many people behind one address.
- **A full Lighthouse refuses** rather than drops; the sender keeps the mail and tries another, or again later.
- **The Worker's bill** has the same guards as the TURN route (0022): a WAF rate limit, a usage alert, and switching it off leaves the homelab Lighthouses working.

### What a Lighthouse can see

Said plainly on a privacy page in Read Me:

- It can't open mail, or tie a tag, a blob or a connection to anyone's name or key, except through a friend who tells it your tags.
- It sees each client's IP address, when it connects, how much it puts and fetches, and which tags it asks for.
- While it watches, it can see that the address that put mail under a tag and the address that fetched it are talking, that one connection's tags belong together, and that the same address comes back day after day. Daily tags protect what's stored, so a Lighthouse that's seized or leaks shows nothing that ties mail to people; they don't hide who talks to whom from a Lighthouse that's watching live.
- A friend who tells the operator your pair tags lets them see when you get mail from that friend.
- The official homelab Lighthouses are reached through a tunnel, and whoever runs the tunnel sees what the Lighthouse sees.

### The protocol version

- Every `hello`, a Lighthouse's included, carries `protocol`, a number that goes up when a change means older Pigeons can't follow. A Pigeon that meets a newer one says it needs an update instead of failing quietly; a Lighthouse refuses a protocol it no longer speaks, with a reply that says so.

### What uses it in M16

- **Farewells** owed to a friend who is offline.
- **Your own devices**: device log changes, the new self secret after a removal, your name (0036), your Lighthouse list, and friends added, removed or blocked (with their pair secrets), so a device that was offline catches up when it opens.
- **New pair secrets** after a device is removed.
- Messages are left for M4's letters, invites for M7, introductions and the directory for 0038.

### Left for later decisions

- **Introductions** (0038) pair two people who share no secret yet, under tags from ECDH between each pair of their devices' sealing keys.
- **M4** adds one-time prekeys for forward secrecy, which need a publish-and-take operation of their own, and must stop someone using up a person's prekeys.
- **M7** adds invite tags from an invite secret, before any pair secret exists.
- **M8** puts group mail under a group tag, one blob for all members with a drop each.
- **M14**'s push needs a decision on how a Lighthouse knows whom to wake without linking a person's tags; it must not undo what daily tags protect.

### The brief and earlier decisions

- "No server of ours in the middle" becomes: no server of ours can read what you say or tie it to you. The Worker Lighthouse is a server the author runs, as the TURN route is (0022). It holds only mail it can't open or attribute, it's one Lighthouse among several, and you can remove it.
- This supersedes [0005](0005-cloudflare-at-pigeon-tomszir-com.md)'s "the Lighthouse is hosted separately": the official Lighthouses include a Worker on Cloudflare. What 0005 promised still holds for the site itself.
- It amends 0024: removing a device replaces the self and pair secrets, and mail is sealed to devices.

## Consequences

Removing a friend, removing a device, changing your name and changing your friends reach people and devices who are offline, and the later milestones have a mailbox to build on. Mail survives a Lighthouse going down while one in its mesh is up. A device you've removed can't delete your mail, can't make a farewell stick, and stops being able to read mail from each friend as soon as that friend learns of the removal.

The costs: Pigeon now does ECDH for each device it sends to, and replacing pair secrets after a removal is a round with every friend, a put at each of their Lighthouses, which takes a while on an old phone with many friends. A Lighthouse watching live can see which addresses exchange mail and which tags belong together, and the privacy page says so rather than promising more. Pair mail isn't forward secret until M4's prekeys: a device key stolen later opens mail still held for it. Proof of work makes putting slower on old phones. Running the official Lighthouses costs money and upkeep, and Cloudflare, which runs the Worker and the tunnel, sees what they see. Thirty days is still a limit, though receipts mean senders put again.

Ruled out: tags and sealing from the same secret (a removed device could read and delete mail), clients in a public WebRTC room (their addresses would be public), a Lighthouse that knows its users' identities (it would learn the social graph by name), one drop per blob (the first device would take mail from the rest), and a single Lighthouse (one machine down would lose mail).

New dependencies, each asked for when M16's code starts: `ws` for the Node WebSocket server, and `node-datachannel` if the mesh uses WebRTC between homelab Lighthouses.
