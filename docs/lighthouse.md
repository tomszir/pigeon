# Running a Lighthouse

How to run a Lighthouse, the peer that holds sealed mail for Pigeons that are offline: its config file, Docker, and reaching one in a homelab through Tailscale Funnel.

A Lighthouse holds mail it can't open or attribute ([0037](decisions/0037-the-lighthouse-and-its-mailbox.md)), so running one for your friends, or for anyone, trusts you with keeping mail until it's fetched and nothing more. The code is `packages/lighthouse` (the mailbox) and `apps/lighthouse` (the Node runner).

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

Build from the repository root, and run it with a folder holding `lighthouse.json`; its key and mail are kept in that folder too.

```sh
docker build -f apps/lighthouse/Dockerfile -t pigeon-lighthouse .
docker run -d --name lighthouse --restart unless-stopped \
  -v "$PWD/lighthouse:/data" -p 127.0.0.1:8787:8787 pigeon-lighthouse
```

## In a homelab, through Tailscale Funnel

The official homelab Lighthouse is reached this way (0037): Funnel gives it a public `https://<machine>.<tailnet>.ts.net` name, ends TLS on the machine itself, so Tailscale carries encrypted traffic without seeing requests, and keeps the home's IP address out of the Lighthouse's address. Nothing on the router is opened.

1. On the machine, with Tailscale signed in and Funnel allowed for the tailnet, run the container with its port on localhost only, as above.
2. `tailscale funnel --bg 8787` puts it on the machine's `ts.net` name, port 443.
3. Set `url` to `wss://<machine>.<tailnet>.ts.net/` and `trustForwardedFor` to `true`, and restart it.
4. Visit `https://<machine>.<tailnet>.ts.net/`: it shows the address to add in Pigeon.

Funnel's proxy sets `X-Forwarded-For` to the visitor's address; with `trustForwardedFor` off, every visitor would count as `127.0.0.1`.
