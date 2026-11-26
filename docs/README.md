# Docs

Pigeon: a serverless peer-to-peer messenger and "Pigeonweb" inside an XP-era fake desktop, a small project that feels like an alternate-reality 2003 where P2P won and the cloud never happened.

## Run and check

- Setup: `mise install && mise run setup`. `mise install` brings Node, pnpm, lefthook and the Rust toolchain that builds `packages/crypto-wasm` to WebAssembly (Rust with its WebAssembly target, wasm-pack, wasm-bindgen); `setup` installs the pnpm dependencies and git hooks. The first build of the crate compiles its Rust dependencies; later ones take seconds.
- Run: `mise run dev` (the web app on Vite's dev server). The dev server gets TURN credentials from the live site's `/api/turn`, so peers on other networks can reach a dev tab; `PIGEON_TURN_FROM=off mise run dev` uses STUN alone. Each checkout (a worktree, a second clone) has its own dev and e2e ports, picked from its path (`apps/web/ports.ts`: dev 5200 to 5599, e2e 5600 to 5999), so several can run at once and the address, with the identity kept for it, stays the same; `PIGEON_PORT` and `PIGEON_E2E_PORT` override them, for example when two paths happen to land on the same port.
- Check: `mise run check` runs Biome, rustfmt and Clippy on the Rust crate, every package's typecheck and unit tests (`cargo test` included), the scripts' own tests (`node --test`), then `scripts/check-docs`. It must pass before work is done.
- End to end: `mise run e2e` runs Playwright (`apps/web/e2e/`): two isolated Chromium contexts that pair and chat over the real public Nostr relays, a second device linked to one of them whose message reaches both, the phone layout on an emulated touch phone, Pigeon Explorer's start page and "page not hosted" screen on both layouts, the browser's Back stepping back inside Pigeon, the desktop and the Messenger under the site's Content Security Policy with nothing refused, a SPAKE2 exchange between two browsers through the WebAssembly module, and a farewell left in an offline friend's mailbox at the official Lighthouses reaching them with nobody else online. It needs internet, so it isn't part of `check`; run it after touching pairing, the crypto crate, sessions, the transport, the Messenger, Explorer or what Back closes. Install the browser once with `pnpm --filter web exec playwright install chromium`.
- Release and deploy: release-please keeps a release PR open on `main`; the workflow drafts that release's notes in Changelog.txt on the PR, which the maintainer rewrites for people before merging; merging it tags the version, and Cloudflare Workers Builds deploys the `release` branch it moves (dashboard settings in [stack.md](stack.md#hosting)). release-please picks the version from the commits (a `feat` or a breaking change bumps the minor version, before 1.0, so `feat` is kept for bigger features and a user-visible fix is still a `fix`, as [CONTRIBUTING.md](../CONTRIBUTING.md#commits-and-prs) says); to choose it instead, put a `Release-As: 0.7.1` line at the end of a pull request's description, which the squash-merge keeps as the commit's footer. By hand: `mise run deploy` after `pnpm --filter web exec wrangler login`.
- Trying it by hand: open the dev server in two browser profiles (or a normal and a private window), choose a name in each, and type one's invite code (or paste its link) into the other.

## Index

- [brief.md](brief.md): what Pigeon is, the alternate-reality premise, and the rules it keeps.
- [architecture.md](architecture.md): the monorepo, the layers, and what may import what.
- [stack.md](stack.md): tools, libraries, versions and why each is there.
- [design.md](design.md): the XP-era design system, where the canvas lives, and the asset rules.
- [pigeonhtml.md](pigeonhtml.md): the 2000s-only HTML/CSS subset Pigeonweb pages are limited to.
- [protocol.md](protocol.md): identities, rooms, messages, letters and pigeon:// addresses.
- [flows.md](flows.md): the protocol's handshakes and state machines drawn in ASCII, which Help shows too.
- [state-machines.md](state-machines.md): pairing, invite links, linking and recovery as the states each side goes through, and what moves it on.
- [threat-model.md](threat-model.md): whom Pigeon defends against, what each can learn or do, what's out of scope, and every protocol message with the checks it gets.
- [verification.md](verification.md): each trust boundary, what checks it today and what isn't checked yet.
- [roadmap.md](roadmap.md): what each release brought and what the next ones will bring, in build order, and what "done" means for each piece.
- [roadmap-pigeonweb.md](roadmap-pigeonweb.md): unscheduled ideas for a living Pigeonweb (homepages, guestbooks, boards, journals, finding things), with options for what the design doesn't cover yet.
- [roadmap-verification.md](roadmap-verification.md): the verification track, independent checks of the crypto and protocol built in stages beside the releases, and how the checks check themselves.
- [lighthouse.md](lighthouse.md): running a Lighthouse: its config file, Docker, reaching one at home through Tailscale Funnel, and the Cloudflare Worker one.
- [glossary.md](glossary.md): the project's own words.
- [../vendor/VENDOR.md](../vendor/VENDOR.md): where the vendored fonts, icons and wallpapers come from and how to update them.
- [../CONTRIBUTING.md](../CONTRIBUTING.md): commit, pull request and issue conventions, the first two enforced by the `commit-msg` hook and the `pr-title` CI job.
- [../SECURITY.md](../SECURITY.md): how to report a security problem privately.
- [decisions/](decisions/): why things are the way they are. Start a new one from 0000-template.md, numbered after the last.
