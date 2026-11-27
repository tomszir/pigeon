# Running a Lighthouse

How to run a Lighthouse, the peer that holds sealed mail for Pigeons that are offline: in Node from a config file, in Docker, at home through Tailscale Funnel, and as a Cloudflare Worker.

A Lighthouse holds mail it can't open or attribute, so running one for your friends, or for anyone, trusts you with keeping mail until it's fetched and nothing more. The code is `packages/lighthouse` (the mailbox and its SQL store) and two runners: `apps/lighthouse` (Node) and `apps/lighthouse-worker` (a Cloudflare Worker).

## What a Lighthouse stores, sees and can do

**What it stores.** One record per piece of mail, and nothing else: its id (a hash of its contents), its tag, the sealed blob, its size and what it costs to keep, when it expires, and a hash for each recipient device's drop, with the drops already used, and for a claimed blob the hash of its claim. The expiry is rounded up to a whole hour, or down for mail asked to live close to the full 30 days so it never stays longer, so it doesn't say to the millisecond when the mail was put. How many drops a blob has says how many devices it was sealed to. Mail is deleted once every recipient device has dropped its copy, or after 30 days at most. The store holds no names, identities, device keys, IP addresses or logs of who asked for what.

**What it never has.** The blob is sealed to each recipient device's own key, so a Lighthouse can't open it. A tag is a keyed hash of a secret only the two ends hold, the recipient and the day, so it can't be traced back to anyone, and it changes every day. An invite link never reaches a Lighthouse: it holds the link's card, sealed under the link's secret, until the card expires, which is when the link ends, a week at most, and the requests left under the link's ask tags, so it can see that end and count the requests, but not the link, its secret, the inviter, the device that made it, or who asked. A card is claimed with a value made for that Lighthouse alone, never the link's claim key. A closed card is put only when its maker cancels the link or it's used up. A client says nothing about itself when it connects: no name, no identity, no key of its own.

**What it sees while it runs.** Each client's IP address, when it connects, how much it puts and fetches, and which tags it asks for. Addresses are counted in memory for the limits (per IPv4 address or IPv6 /64, and per IPv6 /48, a minute, an hour or a day at a time) and never written down. While it watches, a Lighthouse can tell that the address that put mail under a tag and the address that fetched it are talking, and that the same address comes back day after day; it can't tell who they are, unless someone who knows the tags tells its operator.

**What a wait tells it.** A connected Pigeon may leave one `wait` standing on its connection, naming up to 128 of the tags it just listed, to hear the moment mail is put under one of them. While it waits, a Lighthouse knows that Pigeon is open, to the second; which tags that connection waits on, and for how long; and that mail put under them is fetched moments later. It names no tag the Pigeon's last look didn't. The answer says only `mail` or `lease`, nothing a list wouldn't. Someone watching the network, an internet provider or Cloudflare for the Worker, can line up a frame into the Lighthouse with one out to another person a moment later; Pigeon waits a random 0 to 2 seconds before it looks, which blurs that and doesn't hide it. Hear About Mail at Once, in Network, turns waiting off. Anyone who knows one of your tags can already list it as often as the limits allow; a wait makes watching it cheap, and a put fetched within seconds tells them you're open now.

**What it holds in memory.** While a connection is open: the client's IP address, beside what that connection asks for, and its standing wait, if any: the first 60 bits of each of its tags (enough that a put under another tag wakes nobody short of 2^60 tries), the cursor and when its lease ends. Waits are never written to storage; the Worker keeps each with its socket, and rebuilds its index of them from there when it wakes. It writes down one number, the highest seq below which every put's wakes have been sent, which only goes up, so a reset between storing mail and sending its wakes is caught up on. For the limits, per address range (and per IPv6 /48, except for bytes): the frames and reads it made this minute, and the puts it made and bytes it put this hour; and one count of everyone's puts this hour. For the current day, how many blobs each range put under each tag, kept not as the range and tag but as a 30-bit keyed hash of them, under a random key made when the Lighthouse (or, on Cloudflare, its Durable Object) starts and never written down. A list of those counts doesn't name which range put to which tag, but someone holding a copy of the memory has the key too, and can check whether a range they guess put mail today under a tag they know. Each count is forgotten when its minute, hour or day is over, and all of it when the process stops.

**What's checked.** Every reply is signed with the Lighthouse's key over the exact request it answers and a nonce the client chose for the connection, so whoever relays the connection can't change a request and pass on the real answer, or replay one. Pigeon checks each reply against the key in the Lighthouse's address, so a Lighthouse can't be impersonated. Only a recipient device can drop its copy, since only it can open the drop value inside the blob. A personal Lighthouse can require a pass, part of its address, without which it answers only refusals.

**What it can do wrong.** A Lighthouse can withhold or lose mail. That's why mail is left at every Lighthouse on the recipient's list, and senders put it again every few days until each device's receipt comes. It can also make the Pigeons that fetch from it spend time and data. It sees the tags a client asks for and can list as many blobs under them as it likes, made up or put by anyone. A client gets each one listed under its own and its friends' tags, at most 64 KB, and tries each of its wraps, at most 64, with its sealing key: one ECDH and a few HKDFs a wrap, about 20 ms for a 64-wrap blob meant for none of its keys. So a hostile Lighthouse can keep a client fetching and trying for as long as it keeps answering, until it's taken off the list. Invite requests are capped: at most 200 for a link each fetch, of at most 16 KB each. A friend who knows the tag can put such blobs too, as far as the Lighthouse's own limits let them. What a Lighthouse says it runs (its name, version and build) is only its own word; nothing in Pigeon relies on it.

**Claimed blobs.** A put can carry a claim, and a tag's claimed blobs come only from whoever claimed it first, for as long as any of them is held; `list-claimed` lists them apart from the rest. Invite cards are put that way, since everyone holding a link knows its card tag and the limits alone can't stop them burying the card: one IPv6 /48 may put 8000 blobs an hour, all under one tag. A claim doesn't stop anyone putting ordinary blobs under the tag, so nobody who learns a tag can shut others out of it by claiming it. A database from before claims gets the column for them the first time a newer Lighthouse opens it. What a Lighthouse says it runs (its name, version and build) is only its own word; nothing in Pigeon relies on it.

**The key file.** `lighthouse.key` (or the Worker's `LIGHTHOUSE_KEY` secret) is the Lighthouse's identity. Whoever has it can answer as that Lighthouse, though still not open anyone's mail. Keep it readable only by the Lighthouse, back it up with the mail, and never replace it: a new key is a new Lighthouse that everyone must add again.

## The config file

One JSON file. `name` and `url` are needed; everything else has a default.

```json
{
  "name": "My Lighthouse",
  "url": "wss://lighthouse.example.ts.net/",
  "port": 8787,
  "trustForwardedFor": false
}
```

- `name`: shown in Pigeon beside the Lighthouse's fingerprint.
- `url`: the `wss://` address people reach it at. It goes into the Lighthouse's address; the server doesn't check it.
- `host` and `port`: where it listens, `0.0.0.0` and `8787` unless set.
- `keyFile`: its key, `lighthouse.key` beside the config unless set. It's made on first start, readable only by its owner, and never replaced, since it is the Lighthouse's identity. Back it up with the mail; lose it and the Lighthouse becomes a new one that friends must add again.
- `database`: the SQLite file mail is kept in, `lighthouse.sqlite` unless set.
- `pass`: for a personal Lighthouse, a pass without which it answers only refusals. It's part of the address you hand out.
- `trustForwardedFor`: take each client's address from `X-Forwarded-For`, which limits are counted by. Off unless set. Turn it on only behind a proxy that sets it, as Tailscale Funnel does, and with the port reachable from that proxy alone; otherwise anyone could claim any address, and without it every client behind the proxy shares one address's limits.
- `limits`: any of the limits below, each a whole number. The defaults, in brackets, are in `packages/lighthouse/src/limits/limits.ts`.

On start it prints its address, `pigeon://lighthouse/<key>?url=...&name=...`, which is what you give Pigeon. A plain visit to its URL over HTTP shows the same.

### Limits

Limits are counted per address range, an IPv4 address or an IPv6 /64, since whoever has one IPv6 address has the 2^64 around it. The caps per IPv6 /48 keep someone with a block of /64s from getting round them, and from filling the ranges tracked with fresh ones. The cost: mobile carriers often hand each phone a /64 from one shared /48, so a few abusive phones on the same carrier can use up a /48's frames and reads for everyone on it until the minute turns.

- `framesPerMinute` (1200) and `framesPerMinutePer48` (4800): frames of any kind, counted before a frame is read, hashed or answered, so not even a refusal is signed past them. A connection whose range goes over is closed unanswered (WebSocket code 1008).
- `readsPerMinute` (600) and `readsPerMinutePer48` (2400): hellos, lists (claimed ones too), gets, drops and waits; past them each is refused with `limit`. The Worker counts these in memory, which it loses when it sleeps.
- `putsPerHour` (2000), `putsPerHourPer48` (8000), `bytesPerHour` (64 MiB) and `blobsPerTagPerDay` (200): puts, checked before a put is hashed or anything is read from the store. A sender's retry of mail already held isn't counted, though while its range is over a limit it's refused like any put, and tried again later.
- `totalPutsPerHour` (200,000): puts from everyone together; past it nobody can put until the hour turns.
- `maxBytes` (1 GiB): what the store may hold, each blob costing its bytes and its record. The store keeps a running total, so checking it reads nothing.
- `maxRanges` (50,000) and `maxTagCounts` (1,000,000): how many ranges, and range and tag pairs, are counted at once. Past them new ones are refused until the window turns. A pair is kept as a short keyed hash, so a million of them fit in a few tens of megabytes.
- `connectionsPerRange` (128), `connectionsPer48` (512) and `maxConnections` (10,000; 30,000 on the Worker, under the 32,768 a Durable Object takes, since a sleeping socket costs it nothing and each open Pigeon keeps one to wait on): connections open at once. A new connection that finds no room closes idle ones first, then the connection whose wait has stood longest among those counted against every limit that's full (WebSocket code 1013, reason `room`); only if none can be closed is it refused (dropped at once in Node, HTTP 503 from the Worker).
- `waitedTagsPerRange` (2048), `waitedTagsPer48` (8192) and `maxWaitedTags` (200,000): the tags in all standing waits from one range, one /48, and everyone, the last bounding the index of waits in memory. Waits are counted by their tags rather than their connections, so the many small Pigeons behind one carrier address can all wait. Past them a wait is refused with `limit`, and its Pigeon looks on its schedule. Only waits whose connections were heard from within `idleSeconds` count; one gone quiet is closed when the count is needed.
- `idleSeconds` (120): a connection that sends nothing for this long, not even a keepalive, is closed, freeing its place. Pigeon looks for mail every 10 minutes, or every 30 seconds while an invite waits, and also when you come back to it or send a message (never within 5 seconds of its last look), and opens a new connection when its last one was closed, so closing an idle one costs it only a new connection at its next check.

The Node Lighthouse also cuts off a client that leaves more than 1 MiB of replies unread, rather than keep them for it, an address range or /48 whose connections leave more than 8 MiB or 16 MiB unread between them, and, once all replies waiting to be sent add up to 64 MiB, any client asking for more while it still has replies unread; one that keeps up is still answered. It sums what it holds afresh at each start, since a crash between storing mail and noting its size could otherwise leave the total off for good.

Connections aren't checked for where they come from (their `Origin`): Pigeon can be served from more than one origin, a copy someone hosts or a dev server's port, clients outside a browser send none, and nothing a Lighthouse answers depends on who asks. The limits are what keep one client from taking more than its share.

## On this computer

`mise run lighthouse` runs it from `apps/lighthouse/lighthouse.json` (copy `lighthouse.example.json`). A `ws://localhost:...` URL works for a Lighthouse on the same computer as Pigeon; anywhere else needs `wss://`. A Lighthouse at such an address, or a private one at home, works for the Pigeon that has it on its list, and for friends who add it to theirs: friends who only hear of it from you won't connect to it, since Pigeon reaches a Lighthouse someone else names only at a public `wss://` address ([protocol.md](protocol.md#lighthouses-you-didnt-choose)).

Node runs the Lighthouse's TypeScript as it is, stripping the types, with no build step. So the Lighthouse and the packages it uses (`@pigeon/core`, `@pigeon/lighthouse`) only use syntax that can be erased: no parameter properties, enums or namespaces. Their `tsconfig.json` sets `erasableSyntaxOnly` so the typecheck refuses the rest, and a test starts the Lighthouse under plain Node.

## In Docker

Each release publishes the image as `ghcr.io/tomszir/pigeon-lighthouse`, tagged with its version and `latest` (`.github/workflows/lighthouse-image.yml`, run by release-please; running it by hand tags `edge`). Follow `latest` to get each release, for example with Watchtower; `edge` changes only when someone runs the workflow by hand. Run it with a folder holding `lighthouse.json`; its key and mail are kept in that folder too, and the folder must be writable by the container's `node` user (uid 1000).

```sh
docker run -d --name lighthouse --restart unless-stopped \
  -v "$PWD/lighthouse:/data" -p 127.0.0.1:8787:8787 ghcr.io/tomszir/pigeon-lighthouse:latest
```

To build it yourself, from the repository root: `docker build -f apps/lighthouse/Dockerfile -t pigeon-lighthouse .`. The Lighthouse says its version, and the commit it was built from, in its `hello`.

## At home, through Tailscale Funnel

A Lighthouse on a machine at home can be reached this way: Funnel gives it a public `https://<machine>.<tailnet>.ts.net` name, ends TLS on the machine itself, so Tailscale carries encrypted traffic without seeing requests, and keeps the home's IP address out of the Lighthouse's address. Nothing on the router is opened.

1. On the machine, with Tailscale signed in and Funnel allowed for the tailnet, run the container with its port on localhost only, as above.
2. `tailscale funnel --bg 8787` puts it on the machine's `ts.net` name, port 443.
3. Set `url` to `wss://<machine>.<tailnet>.ts.net/` and `trustForwardedFor` to `true`, and restart it.
4. Visit `https://<machine>.<tailnet>.ts.net/`: it shows the address to add in Pigeon.

Funnel's proxy sets `X-Forwarded-For` to the visitor's address; with `trustForwardedFor` off, every visitor would count as `127.0.0.1`.

## As a Cloudflare Worker

The official Worker Lighthouse is `apps/lighthouse-worker`, at `lighthouse.pigeon.tomszir.com`. One Durable Object is the Lighthouse: it keeps the mail in its SQLite, through the same SQL store the Node Lighthouse uses, and holds every client's WebSocket. Sockets hibernate while idle, so an idle connection keeps nothing running; each keeps its client's address, whether it said hello, its nonce, its standing wait and when it last sent a frame attached to it, and is tagged with its address range and /48, so the runtime counts the connections from each for the limits, across hibernation. A socket keeps at most 2,048 bytes; a wait of 128 tags' prints fits in about 1,600, and a connection whose attachment can't be written is closed rather than left to lose its wait at the next sleep. When something wakes the object it picks every socket's connection up from that, so its index of waits is whole before anything else happens, and keeps when each was last heard from in memory, so looking for idle connections reads no attachments. Keepalives (`ping`) are answered `pong` by the runtime itself, without waking the object or billing it; the runtime's note of when it last did counts as hearing from the connection. It has no timers, which would keep it awake: a lease that has ended is answered, and a connection gone quiet closed, when something next wakes it, a frame, a connection, a close or the alarm. A sleeping socket costs nothing, so idle ones are closed only when a new connection finds no room, and on the alarm. The Worker in front passes the client's address from `CF-Connecting-IP` and drops any a client sends of its own. An hourly alarm sweeps expired mail and idle connections while there's mail or a client, and stops when there's neither.

Its name and URL are `vars` in `wrangler.jsonc`. Its key is the secret `LIGHTHOUSE_KEY`, made once and never replaced:

1. `pnpm --filter lighthouse-worker make-key` prints a new key and the address it gives. Keep a copy of the key somewhere safe.
2. `pnpm --filter lighthouse-worker exec wrangler secret put LIGHTHOUSE_KEY`, and paste it.
3. `pnpm --filter lighthouse-worker deploy`. Deploying is the maintainer's call, as the site's is.

`pnpm --filter lighthouse-worker dev` runs it locally with `wrangler dev`, reading the key from `apps/lighthouse-worker/.dev.vars` (`LIGHTHOUSE_KEY=...`, and `LIGHTHOUSE_URL=ws://localhost:8787/`), which git ignores. Its limits count in the Durable Object's memory, and a hibernating object is evicted after a few idle seconds, so on a quiet Lighthouse they start again often: someone can put up to the hourly limits, pause, and put again. Only the store's size limit and the connection limits last, since the store's total is kept with the mail and the runtime keeps the sockets. Keeping counts in storage would write addresses down, which a Lighthouse never does, so the guard that lasts is a WAF rate limit on the route: in the Cloudflare dashboard, Security, WAF, Rate limiting rules, for `lighthouse.pigeon.tomszir.com`, a few hundred requests a minute per IP address, with a usage alert as the TURN route has.
