# Running a Lighthouse

How to run a Node Lighthouse—the peer that holds sealed mail for offline Pigeons—from a config file, in Docker, or at home through Tailscale Funnel.

A Lighthouse holds sealed mail it cannot open or attribute. The implementation lives in `packages/lighthouse` (protocol + SQL store) and `apps/lighthouse` (Node WebSocket server).

## What a Lighthouse stores and sees

- **Stored:** Blob id (content hash), daily tag, sealed blob, size/cost, expiry (rounded to an hour, max 30 days), recipient drop hashes, and claim hash (if claimed). Deleted once every recipient drops its copy or after 30 days. No names, identities, device keys, or IP addresses are written to SQLite.
- **In memory only:** Client IP addresses for rate/connection limits (`framesPerMinute`, `readsPerMinute`, `putsPerHour`, `bytesPerHour`, `blobsPerTagPerDay`), active connection `wait` tag prefixes (first 60 bits), and a daily per-(range, tag) keyed hash count. Cleared when the window rolls or the process stops.
- **Metadata visible while running:** Client IP addresses, connection timing, bandwidth, and queried tags. Calling `wait` reveals while the Pigeon is open (up to 128 tags already listed). Clients wait a random 0–2s before polling on a wake cue.
- **Security:** Every reply is signed by the Lighthouse's Ed25519 key over the request and a per-connection client nonce. Blobs are sealed to recipient device keys. Optional `pass` restricts access to friends who know it.
- **Key file:** `lighthouse.key` is the Lighthouse's identity. Keep it private and back it up with `lighthouse.sqlite`; replacing it gives the Lighthouse a new identity.

## Config file (`lighthouse.json`)

`name` and `url` are required; everything else has defaults:

```json
{
  "name": "My Lighthouse",
  "url": "wss://lighthouse.example.ts.net/",
  "port": 8787,
  "trustForwardedFor": false
}
```

| Field               | Default                                    | Purpose                                                                                                 |
| ------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `name`              | required                                   | Display name shown next to the Lighthouse's fingerprint.                                                |
| `url`               | required                                   | Public `wss://` URL advertised in its `pigeon://lighthouse/...` address.                                |
| `host` / `port`     | `0.0.0.0` / `8787`                         | Listen address and port.                                                                                |
| `keyFile`           | `lighthouse.key`                           | Ed25519 key file path (created on first run).                                                           |
| `database`          | `lighthouse.sqlite`                        | SQLite file path.                                                                                       |
| `pass`              | none                                       | Optional shared secret required for requests.                                                           |
| `trustForwardedFor` | `false`                                    | Read client IP from `X-Forwarded-For` (enable only behind a trusted local proxy like Tailscale Funnel). |
| `limits`            | `packages/lighthouse/src/limits/limits.ts` | Override rate/storage/connection caps.                                                                  |

On start it logs its `pigeon://lighthouse/<key>?url=...&name=...` address (also served on HTTP `GET /`).

## Limits

Defaults protect shared/public Lighthouses per IPv4 / IPv6 `/64` (and per IPv6 `/48` to prevent subnet-rotation abuse):

- **Frames & reads:** `framesPerMinute` (1200; /48: 4800), `readsPerMinute` (600; /48: 2400).
- **Puts & storage:** `putsPerHour` (2000; /48: 8000), `bytesPerHour` (64 MiB), `blobsPerTagPerDay` (200), `totalPutsPerHour` (200,000), `maxBytes` (1 GiB).
- **Connections & waits:** `connectionsPerRange` (128), `connectionsPer48` (512), `maxConnections` (10,000), `waitedTagsPerRange` (2048), `waitedTagsPer48` (8192), `maxWaitedTags` (200,000), `idleSeconds` (120).
- **Backpressure:** Drops clients leaving >1 MiB unread (8 MiB/range, 16 MiB `/48`, 64 MiB global).

## Running locally, in Docker, or with Tailscale Funnel

- **Local dev:** Copy `apps/lighthouse/lighthouse.example.json` to `apps/lighthouse/lighthouse.json` and run `mise run lighthouse` (Node runs TypeScript directly with `erasableSyntaxOnly`).
- **Docker:** `ghcr.io/tomszir/pigeon-lighthouse:latest` (built by `.github/workflows/lighthouse-image.yml` on release). Mount `/data` writable by `node` (uid 1000):

```sh
docker run -d --name lighthouse --restart unless-stopped \
  -v "$PWD/lighthouse:/data" -p 127.0.0.1:8787:8787 ghcr.io/tomszir/pigeon-lighthouse:latest
```

- **Build locally:** `docker build -f apps/lighthouse/Dockerfile -t pigeon-lighthouse .`
- **Tailscale Funnel:** Bind Docker to `127.0.0.1:8787`, run `tailscale funnel --bg 8787`, and set `url` to `wss://<machine>.<tailnet>.ts.net/` with `trustForwardedFor: true`.
