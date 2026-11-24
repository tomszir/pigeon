# Docs

Pigeon: a serverless peer-to-peer messenger and "Pigeonweb" inside an XP-era fake desktop, a portfolio pet project that feels like an alternate-reality 2003 where P2P won and the cloud never happened.

## Run and check

- Setup: `mise install && mise run setup` (installs pnpm deps and git hooks).
- Run: `mise run dev` (the web app on Vite's dev server). Add `?demo` to the address to see the Messenger's sample conversation.
- Check: `mise run check` runs Biome, every package's typecheck and unit tests, the scripts' own tests (`node --test`), then `scripts/check-docs`. It must pass before work is done.

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
