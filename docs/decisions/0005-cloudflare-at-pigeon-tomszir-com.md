# 0005: Cloudflare static hosting at pigeon.tomszir.com

The web app is a static build served by Cloudflare Workers static assets on the `pigeon.tomszir.com` subdomain.

- Status: accepted; the manual deploy step is superseded by [0017](0017-deploy-from-cloudflare-workers-builds.md)
- Date: 2026-11-24

## Context

Pigeon needs no backend, only static files. The author already hosts tomszir.com on Cloudflare Workers static assets, and this is a pet project.

## Decision

Deploy `apps/web/dist` with wrangler as a Workers static-assets project routed to `pigeon.tomszir.com`, following tomszir.com's setup. Deploying is the author's call, never an agent's. The Lighthouse is hosted separately (a small always-on machine) and is not part of this.

## Consequences

Free, fast, and familiar. Nothing on Cloudflare sees user data: all of it travels peer to peer. A wrangler config and a deploy task are added when there is something to ship (end of M1).
