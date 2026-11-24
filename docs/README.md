# Docs

Pigeon: a serverless peer-to-peer messenger and "Pigeonweb" inside an XP-era fake desktop, a portfolio pet project that feels like an alternate-reality 2003 where P2P won and the cloud never happened.

## Run and check

- Setup: `mise install && mise run setup` (installs pnpm deps and git hooks).
- Run: `mise run dev` (the web app on Vite's dev server). Add `?demo` to the address to see the Messenger's sample conversation.
- Check: `mise run check` runs Biome, every package's typecheck and unit tests, the scripts' own tests (`node --test`), then `scripts/check-docs`. It must pass before work is done.
- End to end: `mise run e2e` runs Playwright (`apps/web/e2e/`): two isolated Chromium contexts that pair and chat over the real public Nostr relays, and the phone layout on an emulated touch phone. It needs internet, so it isn't part of `check`; run it after touching pairing, sessions, the transport or the Messenger. Install the browser once with `pnpm --filter web exec playwright install chromium`.
- Release and deploy: release-please keeps a release PR open on `main`; merging it tags the version, and Cloudflare Workers Builds deploys the `release` branch it moves ([0021](decisions/0021-releases-with-release-please.md); dashboard settings in [stack.md](stack.md#hosting)). By hand: `mise run deploy` after `pnpm --filter web exec wrangler login`.
- Trying it by hand: open the dev server in two browser profiles (or a normal and a private window), choose a name in each, and type one's invite code (or paste its link) into the other.

## Index

- [brief.md](brief.md): what Pigeon is, the alternate-reality premise, and the rules it keeps.
- [architecture.md](architecture.md): the monorepo, the layers, and what may import what.
- [stack.md](stack.md): tools, libraries, versions and why each is there.
- [design.md](design.md): the XP-era design system, where the canvas lives, and the asset rules.
- [pigeonhtml.md](pigeonhtml.md): the 2000s-only HTML/CSS subset Pigeonweb pages are limited to.
- [protocol.md](protocol.md): identities, rooms, messages, letters and pigeon:// addresses.
- [roadmap.md](roadmap.md): the milestones and what "done" means for each.
- [glossary.md](glossary.md): the project's own words.
- [../vendor/VENDOR.md](../vendor/VENDOR.md): where the vendored fonts, icons and wallpapers come from and how to update them.
- [../CONTRIBUTING.md](../CONTRIBUTING.md): commit and pull request conventions, enforced by the `commit-msg` hook and the `pr-title` CI job.
- [decisions/](decisions/): why things are the way they are. Start a new one from 0000-template.md, numbered after the last.
