# 0037: The Lighthouse and its mailbox

A Lighthouse is a peer with its own key that holds mail sealed to devices under daily tags, so any Lighthouse, yours, the maintainer's or a stranger's, can carry your mail without being able to read it, forge it or tie it to you.

- Status: accepted
- Date: 2026-11-25

## Context

Everything in Pigeon so far needs both ends online at once. A friend removed while offline is told only if you meet again; a device removed while another is offline hears of it only in the self room; an invite works only while the inviter's tab is open; a message waits in your own log until the friend comes back. The roadmap's M16, M7, M4, M8 and M14 all need the same thing underneath: somewhere that holds a sealed message until its recipient comes for it.

The maintainer wants Pigeon to be a federated internet: Lighthouses run by the maintainer, on a home server and as a Cloudflare Worker, and by anyone else, with people choosing whose to use. Nobody can check what code someone else's Lighthouse really runs, so the design has to make that not matter: a Lighthouse is trusted with nothing but keeping mail until it's fetched.

Three review rounds of a larger draft shaped this one. They found that a mailbox locked only by the pair and self secrets would let a removed device read, delete and forge mail (0024 lets it keep them), that clients in a public WebRTC room would publish their IP addresses, that hiding tags in shared buckets hides almost nothing once you fetch your own, and that proof of work costs honest phones more than attackers. The draft also had a mesh between Lighthouses, secrets replaced when a device is removed, introductions and a directory; those are split off (see Left for later) so M16 is a milestone that can be finished.

## Decision

### What a Lighthouse is

- **A peer with its own key.** A Lighthouse has an Ed25519 identity, a name its operator chooses and a fingerprint Pigeon shows. It signs every reply, and Pigeon checks it against the key in the Lighthouse's address, so whoever answers can't pretend to be it.
- **An address** is `{ id, name, url }`, `url` being a WebSocket (`wss://`), written as a link, `pigeon://lighthouse/<id>?url=...`, and a QR code. A personal Lighthouse can add a pass, a random value in the address without which it answers nothing.
- **Clients reach Lighthouses over WebSocket only.** One connection to one server: the Lighthouse sees the client's IP address, as any server would, but nobody else does, and clients never meet each other through it.
- **What a client says.** A connection opens with a Lighthouse `hello` carrying only `protocol` and a `nonce`, 32 random bytes chosen for that connection: no name, no identity, no `instance`. Clients sign nothing to the Lighthouse. Each reply is signed over the hash of the exact request frame it answers and the connection's nonce, so whoever relays a connection can't change a request and pass on the real answer, nor replay an answer on another connection. That holds while the client keeps its side: a fresh random nonce for every connection, request numbers that only go up within one, and each request taking one reply.
- **What a Lighthouse says about itself.** Its `hello` carries `protocol` and `software` (name, version and, for the maintainer's releases, the build's hash). Settings shows it as the Lighthouse's own claim, since a server can't prove what it runs. Nothing in Pigeon's safety depends on it.
- **One package, two runners.** `packages/lighthouse` holds the mailbox and its limits against a storage interface and no platform. `apps/lighthouse` runs it in Node with a WebSocket server and SQLite (`node:sqlite`), in Docker from one config file, for a home server and for anyone. A Cloudflare Worker runner (since removed) ran it with one Durable Object per Lighthouse and hibernating WebSockets, storing in its SQLite. Sharding by tag would need a cursor per shard, since `list` takes one cursor across many tags, and waits until one Durable Object is too small.
- **The official Lighthouses** are run by the maintainer: the Worker at `lighthouse.pigeon.tomszir.com` and a Node Lighthouse on a home server. That one is reached through Tailscale Funnel, which ends TLS on the machine itself, so the tunnel carries encrypted traffic without seeing requests, keeps the home IP address out of the address, and keeps the two official Lighthouses from both being in Cloudflare's view. Pigeon ships with both and uses them by default; Settings lists your Lighthouses and lets you add or remove any, the official ones included. The UI says which Lighthouse carried what, as the brief's "Honest P2P" asks.

### Mail is sealed to devices

- **Each device has a sealing key.** Every device makes an ECDH P-256 key now and binds it to itself: `{ device, key, sig }`, signed by the device's own signing key, sent in `hello` and kept beside the device log. A device is sealed to only while it's active on the log, so the binding works for the first device (which has no `add` entry), for devices added before this decision and for devices kept through a recovery.
- **Sealed once, opened by each device.** Mail is sealed with a random content key (AES-256-GCM), wrapped for each recipient device with ECDH from a fresh key of the sender's and HKDF (info `pigeon/mail/wrap`). One blob serves all of a friend's devices, and later a group (M8). Only the devices the sender believes are on the recipient's list can open it: a device you removed can still read mail from a friend who hasn't heard of the removal, and none once they have. An export file (0029) holds no device keys and opens nothing.
- **Tags come from the secrets, and only tags.** A tag is `HMAC-SHA256(secret, "pigeon/mail/v1/" + recipient identity + "/" + UTC date)`, from the pair secret between friends and the self secret between your own devices. Knowing a tag lets someone see that mail is waiting, never open it. In the last hour of a UTC day tomorrow's tags are fetched too, as 0026 does with rooms.
- **The envelope inside** is signed by the sending device as any envelope is, with `room` set to `mail:<kind>` (`mail:farewell`, `mail:self`, `mail:receipt`, and later `mail:letter`, `mail:invite`, `mail:group`), the recipient's identity, the tag's date, a random id and the sender's device-log head (epoch and sequence). A recipient drops mail it has seen by id, refuses mail dated more than a day off its tag, and never depends on the order mail arrives in.
- **Mail from a device counts only while it's on the sender's list.** A recipient whose copy of the sender's log is older than the head in the mail gets the newer log first (it's put beside the mail, and met in pair rooms) and gathers everything it fetched before acting on any of it.
- **Farewells hold only from a device that's still on the list.** A farewell from a device the newest log has removed isn't acted on, and one taken before the removal was known is undone: "removed you" clears and the pair rooms meet again; the chat was never deleted. Removing a friend is synced between your devices, so your remaining devices put the farewell again under their own keys, and a real removal still arrives while a forged one from a lost device doesn't stick. A removal made on a device that is itself removed before your other devices hear of it can't be told from a forgery, and is lost: make it again.

### The mailbox

- **Operations.** `put { tag, blob, expires, drops }` stores a blob of at most 64 KB and answers with its id and the expiry it's held until (a blob put again keeps its first). `list { tags, cursor }` returns, paged, the id, tag and size of each blob under those tags that reached this Lighthouse after the cursor. `get { id }` returns one blob, since one fills a frame. `drop { id, key }` uses one drop. The Lighthouse signs each reply, and answers `put` only once the blob is stored.
- **Exact tags, said plainly.** A client asks for its exact tags for the days since its cursor. A Lighthouse watching live sees which tags one connection asks for and gets mail on; daily tags protect what's stored, not what's watched.
- **A drop for each device.** `drops` holds one SHA-256 per recipient device, of a random value sealed inside the blob for that device alone. A device drops its copy by sending its value; the blob goes when every drop is used or it expires. Nobody else can drop it, the Lighthouse included.
- **Receipts, one per device.** Each recipient device that has taken in mail puts a signed `receipt` for the sender under the sender's tag, checked against the newest log like any mail. The sender stops putting the mail again for that device once its receipt comes, and puts it again every few days for devices that haven't answered, until they do or leave the list. That holds for your own devices, so a tablet away for longer than a blob lasts still catches up.
- **Expiry.** At most 30 days. A recipient who stays away longer misses what expired, and senders put it again until a receipt comes.
- **Where mail goes.** Each Pigeon has a list of its Lighthouses (the official ones unless changed), said in `hello` (`lighthouses`) and shared between your devices in the self mailbox. Mail is put at every Lighthouse on the recipient's list that answers, which is how mail survives one being down. For a friend whose list was never heard, it goes to the official ones. A Lighthouse you take off your list is still fetched from for 30 days, and your Pigeon leaves a note there for each friend naming your new list.

### Limits

- **Per address range.** Limits count per IPv4 address and per IPv6 /64: puts and bytes an hour, blobs per tag a day, and lists, gets and drops a minute. IPv4 limits are set high enough for carriers that put many people behind one address, and an IPv4 address mapped into IPv6 counts as itself. IP addresses are used for counting and never written to storage.
- **And everyone together.** IPv6 puts count against their /48 too, so many /64s from one block share a limit. A cap on all puts an hour, and on how many ranges are counted at once, keeps the store and the bill bounded; someone who trips either on purpose shuts everyone out until the window turns, which is the price of a Lighthouse that can't be filled. A blob counts against the store at what it costs to keep, its id, tag and drop hashes included, not only its bytes. A connection may have 16 requests waiting; more are refused rather than queued.
- **A full Lighthouse refuses** rather than drops; the sender keeps the mail and tries another, or again later. Mail isn't put while a tab closes: a farewell is kept and put when Pigeon next starts.
- **The Worker's bill** has the same guards as the TURN route (0022): a WAF rate limit, a usage alert, and switching it off leaves the home server Lighthouse working.

### What a Lighthouse can see

Said plainly on a privacy page in Read Me:

- It can't open mail, forge it, or tie a tag, a blob or a connection to anyone's name or key, unless a friend of yours tells its operator your tags.
- It sees each client's IP address, when it connects, how much it puts and fetches, and which tags it asks for.
- While it watches, it can see that the address that put mail under a tag and the address that fetched it are talking, that one connection's tags belong together, and that the same address comes back day after day.
- A Lighthouse can withhold or lose mail. Using two, and receipts, cover that.
- The home server Lighthouse's tunnel (Tailscale Funnel) sees that connections are made and their addresses, not what's in them, since TLS ends on the home server machine.

### The protocol version

- Every `hello`, a Lighthouse's included, carries `protocol`, a number that goes up when a change means older Pigeons can't follow. A Pigeon that meets a newer one says it needs an update instead of failing quietly; a Lighthouse refuses a protocol it no longer speaks, with a reply that says so.

### What uses it in M16

- **Farewells** owed to a friend who is offline.
- **Your own devices**: device log changes, your name (0036), your Lighthouse list, and friends added, removed or blocked (with their pair secrets), so a device that was offline catches up when it opens.
- Messages are left for M4, invites for M7.

### Left for later

- **Replacing secrets when a device is removed**, so a removed device can't even see that mail is waiting or put junk under your tags. It needs a round with every friend and care with a stolen first device (0024, 0027), and gets its own decision.
- **Lighthouses meshing**, mirroring mail to each other, with content-addressed ids and tombstones so a dropped blob can't come back. It's how Lighthouses federate, and comes with M6.
- **Introductions**, a friend introducing two friends who both agree, perhaps through private and third-party Lighthouses.
- **A verified app.** A Lighthouse that serves Pigeon itself (M6) can't be trusted to serve the real thing; its build is checked against the maintainer's signed release hash, which M6 decides.
- **M4**'s one-time prekeys, **M7**'s invite tags, **M8**'s group tags, and **M14**'s push, which must not undo what daily tags protect.

### The brief and earlier decisions

- "No server of ours in the middle" becomes: no server of ours can read what you say or tie it to you. The Worker Lighthouse is a server the maintainer runs, as the TURN route is (0022), holding only mail it can't open or attribute, one Lighthouse among several, and removable.
- This supersedes [0005](0005-cloudflare-at-pigeon-tomszir-com.md)'s "the Lighthouse is hosted separately": one official Lighthouse is a Worker on Cloudflare.

## Consequences

Removing a friend, removing a device, changing your name and changing your friends reach people and devices who are offline, and the later milestones have a mailbox to build on. Any Lighthouse can carry your mail, which is what makes a federation of Lighthouses run by strangers safe to join: the worst one can do is lose it.

The costs: Pigeon does ECDH for each device it sends to. A Lighthouse watching live can see which addresses exchange mail and which tags go together, and the privacy page says so rather than promising more. A removed device keeps seeing that mail is waiting, and can put mail nobody acts on, until secrets are replaced in a later milestone; it can read mail only from friends who haven't heard of the removal. Pair mail isn't forward secret until M4: a device key stolen later opens mail still held for it. Running the official Lighthouses costs money and upkeep, and Cloudflare sees what the Worker sees.

Ruled out: tags and sealing from the same secret (a removed device could read and delete mail), clients in a public WebRTC room (their addresses would be public), a Lighthouse that knows its users' identities (it would learn the social graph by name), shared tag buckets (fetching your own mail gives them away), proof of work (it costs phones more than attackers), one drop per blob (the first device would take mail from the rest), and checking what code a Lighthouse runs (no server can prove it, so nothing relies on it).

New dependency, asked for when M16's code starts: `ws`, for the Node WebSocket server.
