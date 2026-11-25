# Running a Lighthouse

How to run a Lighthouse, the peer that holds sealed mail for Pigeons that are offline: in Node from a config file, in Docker, at home through Tailscale Funnel, and as a Cloudflare Worker.

A Lighthouse holds mail it can't open or attribute, so running one for your friends, or for anyone, trusts you with keeping mail until it's fetched and nothing more. The code is `packages/lighthouse` (the mailbox and its SQL store) and two runners: `apps/lighthouse` (Node) and `apps/lighthouse-worker` (a Cloudflare Worker).

## What a Lighthouse stores, sees and can do

**What it stores.** One record per piece of mail, and nothing else: its id (a hash of its contents), its tag, the sealed blob, its size and what it costs to keep, when it expires, and a hash for each recipient device's drop, with the drops already used. Mail is deleted once every recipient device has dropped its copy, or after 30 days at most. The store holds no names, identities, device keys, IP addresses or logs of who asked for what.

**What it never has.** The blob is sealed to each recipient device's own key, so a Lighthouse can't open it. A tag is a keyed hash of a secret only the two ends hold, the recipient and the day, so it can't be traced back to anyone, and it changes every day. A client says nothing about itself when it connects: no name, no identity, no key of its own.

**What it sees while it runs.** Each client's IP address, when it connects, how much it puts and fetches, and which tags it asks for. Addresses are counted in memory for the limits (per IPv4 address or IPv6 /64, and per IPv6 /48, a minute, an hour or a day at a time) and never written down. While it watches, a Lighthouse can tell that the address that put mail under a tag and the address that fetched it are talking, and that the same address comes back day after day; it can't tell who they are, unless someone who knows the tags tells its operator.

**What's checked.** Every reply is signed with the Lighthouse's key over the exact request it answers and a nonce the client chose for the connection, so whoever relays the connection can't change a request and pass on the real answer, or replay one. Pigeon checks each reply against the key in the Lighthouse's address, so a Lighthouse can't be impersonated. Only a recipient device can drop its copy, since only it can open the drop value inside the blob. A personal Lighthouse can require a pass, part of its address, without which it answers only refusals.

**What it can do wrong.** The worst a Lighthouse can do is withhold or lose mail. That's why mail is left at every Lighthouse on the recipient's list, and senders put it again every few days until each device's receipt comes. What a Lighthouse says it runs (its name, version and build) is only its own word; nothing in Pigeon relies on it.

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
- `readsPerMinute` (600) and `readsPerMinutePer48` (2400): hellos, lists, gets and drops; past them each is refused with `limit`.
- `putsPerHour` (2000), `putsPerHourPer48` (8000), `bytesPerHour` (64 MiB) and `blobsPerTagPerDay` (200): puts, checked before a put is hashed or anything is read from the store. A sender's retry of mail already held isn't counted, though while its range is over a limit it's refused like any put, and tried again later.
- `totalPutsPerHour` (200,000): puts from everyone together; past it nobody can put until the hour turns.
- `maxBytes` (1 GiB): what the store may hold, each blob costing its bytes and its record. The store keeps a running total, so checking it reads nothing.
- `maxRanges` (50,000) and `maxTagCounts` (1,000,000): how many ranges, and range and tag pairs, are counted at once. Past them new ones are refused until the window turns. A pair is kept as a short keyed hash, so a million of them fit in a few tens of megabytes.
- `connectionsPerRange` (128), `connectionsPer48` (512) and `maxConnections` (10,000): connections open at once. One past them is refused (dropped at once in Node, HTTP 503 from the Worker).
- `idleSeconds` (120): a connection that sends nothing for this long is closed, freeing its place. Pigeon looks for mail every 10 minutes, or every 30 seconds while an invite waits, and opens a new connection when its last one was closed, so closing an idle one costs it only a new connection at its next check.

The Node Lighthouse also cuts off a client that leaves more than 1 MiB of replies unread, rather than keep them for it, an address range or /48 whose connections leave more than 8 MiB or 16 MiB unread between them, and, once all replies waiting to be sent add up to 64 MiB, any client asking for more while it still has replies unread; one that keeps up is still answered. It sums what it holds afresh at each start, since a crash between storing mail and noting its size could otherwise leave the total off for good.

Connections aren't checked for where they come from (their `Origin`): Pigeon can be served from more than one origin, a copy someone hosts or a dev server's port, clients outside a browser send none, and nothing a Lighthouse answers depends on who asks. The limits are what keep one client from taking more than its share.

## On this computer

`mise run lighthouse` runs it from `apps/lighthouse/lighthouse.json` (copy `lighthouse.example.json`). A `ws://localhost:...` URL works for a Lighthouse on the same computer as Pigeon; anywhere else needs `wss://`.

## In Docker

Each release publishes the image as `ghcr.io/tomszir/pigeon-lighthouse`, tagged with its version and `latest` (`.github/workflows/lighthouse-image.yml`, run by release-please; running it by hand tags `edge`). Run it with a folder holding `lighthouse.json`; its key and mail are kept in that folder too, and the folder must be writable by the container's `node` user (uid 1000).

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

The official Worker Lighthouse is `apps/lighthouse-worker`, at `lighthouse.pigeon.tomszir.com`. One Durable Object is the Lighthouse: it keeps the mail in its SQLite, through the same SQL store the Node Lighthouse uses, and holds every client's WebSocket. Sockets hibernate while idle, so an idle connection keeps nothing running; each keeps its client's address, whether it said hello, its nonce and when it last sent a frame attached to it, and is tagged with its address range and /48, so the runtime counts the connections from each for the limits, across hibernation. A sleeping socket costs nothing, so idle ones are closed only when a new connection finds no room, at most every 10 seconds, and on the alarm. The Worker in front passes the client's address from `CF-Connecting-IP` and drops any a client sends of its own. An hourly alarm sweeps expired mail and idle connections while there's mail or a client, and stops when there's neither.

Its name and URL are `vars` in `wrangler.jsonc`. Its key is the secret `LIGHTHOUSE_KEY`, made once and never replaced:

1. `pnpm --filter lighthouse-worker make-key` prints a new key and the address it gives. Keep a copy of the key somewhere safe.
2. `pnpm --filter lighthouse-worker exec wrangler secret put LIGHTHOUSE_KEY`, and paste it.
3. `pnpm --filter lighthouse-worker deploy`. Deploying is the maintainer's call, as the site's is.

`pnpm --filter lighthouse-worker dev` runs it locally with `wrangler dev`, reading the key from `apps/lighthouse-worker/.dev.vars` (`LIGHTHOUSE_KEY=...`, and `LIGHTHOUSE_URL=ws://localhost:8787/`), which git ignores. Its limits count in the Durable Object's memory, and a hibernating object is evicted after a few idle seconds, so on a quiet Lighthouse they start again often: someone can put up to the hourly limits, pause, and put again. Only the store's size limit and the connection limits last, since the store's total is kept with the mail and the runtime keeps the sockets. Keeping counts in storage would write addresses down, which a Lighthouse never does, so the guard that lasts is a WAF rate limit on the route: in the Cloudflare dashboard, Security, WAF, Rate limiting rules, for `lighthouse.pigeon.tomszir.com`, a few hundred requests a minute per IP address, with a usage alert as the TURN route has.
