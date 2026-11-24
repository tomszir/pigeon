# 0022: TURN from Cloudflare, with credentials from a Worker route

When two peers can't reach each other directly, WebRTC relays through Cloudflare's TURN, using short-lived credentials that one route on the site's Worker hands out.

- Status: accepted; supersedes the "no Worker code" part of [0005](0005-cloudflare-at-pigeon-tomszir-com.md)
- Date: 2026-11-24

## Context

With only STUN, a phone on mobile data and a computer on home Wi-Fi never connected: carrier NAT hides the phone behind an address no one can dial, so the invite handshake found no path and Add a Friend waited forever. Two devices on the same Wi-Fi worked. Real friends are on different networks most of the time, so this breaks M2's done check ("two browsers on different networks chat").

TURN fixes it by relaying the packets. Cloudflare Realtime's TURN is free up to 1,000 GB a month, and the site is already a Cloudflare Worker. Its credentials come from an API call that needs a secret token, which can't ship in a static page; long-lived credentials in the page would let anyone spend the quota. Running coturn ourselves needs a public address, open UDP ports and upkeep.

## Decision

- The `pigeon` Worker gets code: `apps/web/worker/`. `GET /api/turn` asks Cloudflare for ICE servers with `TURN_KEY_ID` (a plain variable in `wrangler.jsonc`: it only names the key) and `TURN_KEY_API_TOKEN` (a Worker secret set in the dashboard) for 4 hours, tags them with the visitor's country and a keyed hash of their address (`customIdentifier`, for TURN analytics; retried untagged if Cloudflare refuses the tag), drops the port 53 addresses browsers stall on, and answers `{ iceServers }`. It only answers same-origin requests. Every other path is the static assets, as before.
- The browser fetches `/api/turn` before joining a room, reuses the answer for 50 minutes, and passes it to Trystero as `turnConfig`, next to the default STUN servers. If the route is missing, slow (3 seconds) or not configured, the room is joined with STUN alone. The dev server forwards `/api/turn` to the live site, so a dev tab gets real TURN without holding the token; `PIGEON_TURN_FROM=off` turns that off, and another URL points it elsewhere.
- ICE still tries direct paths first and only falls back to the relay when they fail.

## Consequences

Peers on different networks can pair and chat. The relay sees encrypted DTLS packets and both ends' IP addresses, never what is said; the Worker sees nothing but a request for credentials. This bends the brief's "no server of ours in the middle": the relay is a last resort, not where anything lives.

Anyone can fetch credentials from the site the way a page does, so someone determined could spend the free 1,000 GB a month and run up charges beyond it; Cloudflare has no hard cap. The guards: credentials last 4 hours, so a leaked one is soon useless; the tag shows in TURN analytics which visitor is using the relay, without keeping their address; a WAF rate limit on `/api/turn` and a usage alert in the dashboard; and deleting the secret or the TURN key turns TURN off, leaving STUN alone.

The short life has a cost: a room joined more than 4 hours ago keeps its expired credential, so a peer it meets after that, or a relayed connection that drops, can only connect directly until the tab reloads.
