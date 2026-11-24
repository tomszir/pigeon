# 0017: Deploy with Cloudflare Workers Builds

Cloudflare's Git integration builds and deploys main to pigeon.tomszir.com; merging to main is the author's decision to ship.

- Status: accepted; deploying on every push to main is superseded by [0021](0021-releases-with-release-please.md)
- Date: 2026-11-24

## Context

[0005](0005-cloudflare-at-pigeon-tomszir-com.md) had the author run wrangler by hand. Testing M2 needs the real site on two networks after every change, and a hand deploy from a laptop ships whatever is in the working tree, committed or not. A GitHub Actions deploy would need a Cloudflare API token stored in GitHub; Workers Builds keeps the credentials inside Cloudflare.

## Decision

The `pigeon` Worker is connected to the GitHub repo in the Cloudflare dashboard (Workers Builds). On a push to `main` Cloudflare checks out the commit, runs the build command and then `wrangler deploy` with `apps/web/wrangler.jsonc`. The settings live in the dashboard, so they are written down in [stack.md](../stack.md) ("Hosting"). This replaces 0005's manual deploy step; the rest of 0005 (static assets only, the subdomain, the Lighthouse elsewhere) stands. `mise run deploy` stays for a deploy from the author's own machine.

## Consequences

What's live is always a commit on main, testing on real networks is a merge away, and no deploy secret exists outside Cloudflare. Merging to main now ships, so it stays the author's call: agents open PRs, they don't merge or push to main. Cloudflare doesn't wait for GitHub CI, so a commit that fails `mise run check` can still deploy if it builds; PRs are checked before they merge, which is what keeps main green. The build settings are dashboard state, not code, so a change to them updates stack.md by hand.
