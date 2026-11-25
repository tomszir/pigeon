# Running a Lighthouse

How to run a Lighthouse, the peer that holds sealed mail for Pigeons that are offline: in Node from a config file, in Docker, in a homelab through Tailscale Funnel, and as a Cloudflare Worker.

A Lighthouse holds mail it can't open or attribute ([0037](decisions/0037-the-lighthouse-and-its-mailbox.md)), so running one for your friends, or for anyone, trusts you with keeping mail until it's fetched and nothing more. The code is `packages/lighthouse` (the mailbox and its SQL store) and two runners: `apps/lighthouse` (Node) and `apps/lighthouse-worker` (a Cloudflare Worker).

## The config file

One JSON file. `name` and `url` are needed; everything else has a default.

```json
{
  "name": "Toms's Lighthouse",
  "url": "wss://lighthouse.example.ts.net/",
  "port": 8787,
  "trustForwardedFor": true
}
```

- `name`: shown in Pigeon beside the Lighthouse's fingerprint.
- `url`: the `wss://` address people reach it at. It goes into the Lighthouse's address; the server doesn't check it.
- `host` and `port`: where it listens, `0.0.0.0` and `8787` unless set.
- `keyFile`: its key, `lighthouse.key` beside the config unless set. It's made on first start, readable only by its owner, and never replaced, since it is the Lighthouse's identity. Back it up with the mail; lose it and the Lighthouse becomes a new one that friends must add again.
- `database`: the SQLite file mail is kept in, `lighthouse.sqlite` unless set.
- `pass`: for a personal Lighthouse, a pass without which it answers only refusals. It's part of the address you hand out.
- `trustForwardedFor`: take each client's address from `X-Forwarded-For`, which limits are counted by. Only behind a proxy that sets it, as Tailscale Funnel does; otherwise anyone could claim any address, and without it every client behind the proxy shares one address's limits.
- `limits`: any of `putsPerHour`, `bytesPerHour`, `blobsPerTagPerDay` and `readsPerMinute` (per address range, an IPv4 address or an IPv6 /64), `totalPutsPerHour`, `maxRanges` and `maxBytes` (everyone together). The defaults are in `packages/lighthouse/src/limits/limits.ts`.

On start it prints its address, `pigeon://lighthouse/<key>?url=...&name=...`, which is what you give Pigeon. A plain visit to its URL over HTTP shows the same.

## On this computer

`mise run lighthouse` runs it from `apps/lighthouse/lighthouse.json` (copy `lighthouse.example.json`). A `ws://localhost:...` URL works for a Lighthouse on the same computer as Pigeon; anywhere else needs `wss://`.

## In Docker

Each release publishes the image as `ghcr.io/tomszir/pigeon-lighthouse`, tagged with its version and `latest` (`.github/workflows/lighthouse-image.yml`, run by release-please; running it by hand tags `edge`). Run it with a folder holding `lighthouse.json`; its key and mail are kept in that folder too, and the folder must be writable by the container's `node` user (uid 1000).

```sh
docker run -d --name lighthouse --restart unless-stopped \
  -v "$PWD/lighthouse:/data" -p 127.0.0.1:8787:8787 ghcr.io/tomszir/pigeon-lighthouse:latest
```

To build it yourself, from the repository root: `docker build -f apps/lighthouse/Dockerfile -t pigeon-lighthouse .`. The Lighthouse says its version, and the commit it was built from, in its `hello`.

## In a homelab, through Tailscale Funnel

The official homelab Lighthouse is reached this way (0037): Funnel gives it a public `https://<machine>.<tailnet>.ts.net` name, ends TLS on the machine itself, so Tailscale carries encrypted traffic without seeing requests, and keeps the home's IP address out of the Lighthouse's address. Nothing on the router is opened.

1. On the machine, with Tailscale signed in and Funnel allowed for the tailnet, run the container with its port on localhost only, as above.
2. `tailscale funnel --bg 8787` puts it on the machine's `ts.net` name, port 443.
3. Set `url` to `wss://<machine>.<tailnet>.ts.net/` and `trustForwardedFor` to `true`, and restart it.
4. Visit `https://<machine>.<tailnet>.ts.net/`: it shows the address to add in Pigeon.

Funnel's proxy sets `X-Forwarded-For` to the visitor's address; with `trustForwardedFor` off, every visitor would count as `127.0.0.1`.

## As a Cloudflare Worker

The official Worker Lighthouse is `apps/lighthouse-worker`, at `lighthouse.pigeon.tomszir.com` (0037). One Durable Object is the Lighthouse: it keeps the mail in its SQLite, through the same SQL store the Node Lighthouse uses, and holds every client's WebSocket. Sockets hibernate while idle, so an idle connection keeps nothing running; each keeps its client's address, whether it said hello, and its nonce attached to it. The Worker in front passes the client's address from `CF-Connecting-IP` and drops any a client sends of its own. An hourly alarm sweeps expired mail while there's mail or a client, and stops when there's neither.

Its name and URL are `vars` in `wrangler.jsonc`. Its key is the secret `LIGHTHOUSE_KEY`, made once and never replaced:

1. `pnpm --filter lighthouse-worker make-key` prints a new key and the address it gives. Keep a copy of the key somewhere safe.
2. `pnpm --filter lighthouse-worker exec wrangler secret put LIGHTHOUSE_KEY`, and paste it.
3. `pnpm --filter lighthouse-worker deploy`. Deploying is the author's call, as the site's is.

`pnpm --filter lighthouse-worker dev` runs it locally with `wrangler dev`, reading the key from `apps/lighthouse-worker/.dev.vars` (`LIGHTHOUSE_KEY=...`, and `LIGHTHOUSE_URL=ws://localhost:8787/`), which git ignores. Its limits count in the Durable Object's memory, and a hibernating object is evicted after a few idle seconds, so on a quiet Lighthouse they start again often: someone can put up to the hourly limits, pause, and put again. Only the store's size limit lasts, since it's counted from what's stored. Keeping counts in storage would write addresses down, which 0037 rules out, so the guard that lasts is a WAF rate limit on the route: in the Cloudflare dashboard, Security, WAF, Rate limiting rules, for `lighthouse.pigeon.tomszir.com`, a few hundred requests a minute per IP address, with a usage alert as the TURN route has (0022).
