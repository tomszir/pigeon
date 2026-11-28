# Docs

Pigeon is an alternate-reality 2003 serverless P2P messenger and "Pigeonweb" inside an XP-era desktop.

## Run and check

- **Setup:** `mise install && mise run setup` installs Node, pnpm, lefthook, Rust (`wasm32-unknown-unknown`, `wasm-pack`, `wasm-bindgen`), JS dependencies, and git hooks.
- **Dev server:** `mise run dev` starts Vite on a checkout-specific port (`apps/web/ports.ts`: 5200–5599 dev, 5600–5999 e2e) and proxies `/api/turn` from the live site (`PIGEON_TURN_FROM=off mise run dev` for STUN only). Override ports with `PIGEON_PORT` / `PIGEON_E2E_PORT`.
- **Checks:** `mise run check` runs Biome (including `biome-plugins/solid-stale-accessor.grit`), `crypto-wasm` lint (`rustfmt`, Clippy), package typechecks, Vitest + `cargo test`, and `node --test scripts/*.test.ts`.
- **Planted defects:** `mise run defects` applies each patch in `verification/defects/` to committed code, typechecks, and verifies the target test fails. Run after touching crypto, signing, or core invite/Lighthouse rules.
- **E2E tests:** `mise run e2e` runs Playwright (`apps/web/e2e/`) over live public Nostr relays and Lighthouses (requires internet; install browser once via `pnpm --filter web exec playwright install chromium`).
- **Release & deploy:** `release-please` maintains the release PR on `main` and updates `Changelog.txt`; merging it tags the release and updates the `release` branch deployed by Cloudflare. Add `Release-As: x.y.z` in a PR footer to pin a version. Manual deploy: `mise run deploy`.
- **Manual test:** Open the dev server in two browser profiles (or normal + incognito), pick names, and pair via invite code or link.

## Index

- [brief.md](brief.md): alternate-reality premise and core product goals.
- [architecture.md](architecture.md): monorepo layout, layer boundaries, and patterns.
- [stack.md](stack.md): tools, libraries, versions, and rationale.
- [design.md](design.md): XP-era design system, canvas, and asset rules.
- [pigeonhtml.md](pigeonhtml.md): 2000s-only HTML/CSS subset for Pigeonweb pages.
- [protocol.md](protocol.md): identities, rooms, messages, letters, and `pigeon://` addresses.
- [flows.md](flows.md): ASCII handshakes and state machines (also rendered in Help).
- [state-machines.md](state-machines.md): pairing, invite links, linking, and recovery states.
- [threat-model.md](threat-model.md): defender assumptions, out-of-scope threats, and message checks.
- [verification.md](verification.md): trust boundaries and what checks each today.
- [roadmap.md](roadmap.md): shipped releases, upcoming milestones, and done criteria.
- [roadmap-pigeonweb.md](roadmap-pigeonweb.md): unscheduled ideas for Pigeonweb.
- [roadmap-verification.md](roadmap-verification.md): verification roadmap and stage goals.
- [lighthouse.md](lighthouse.md): running a Node Lighthouse (config, Docker, Tailscale Funnel).
- [glossary.md](glossary.md): project terminology.
- [../vendor/VENDOR.md](../vendor/VENDOR.md): vendored fonts, icons, wallpapers, and test vectors.
- [../CONTRIBUTING.md](../CONTRIBUTING.md): commits, PRs, issues, and release workflow.
- [../SECURITY.md](../SECURITY.md): private vulnerability reporting.
- [decisions/](decisions/): architecture decision records (start from `0000-template.md`).
