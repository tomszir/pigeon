# Working in this repo

Start with [docs/README.md](docs/README.md) for setup, run, and check commands.

## Style and docs

- Write short bullets and tables, never semicolon-chained paragraphs. Use standard engineering terms (`poll`, `ACK`, `cursor`, `sync`, `epoch`).
- Update docs only when a wire format, protocol flow, or architecture boundary changes. Direct references like `ADR-0050` or [docs/protocol.md](docs/protocol.md) are encouraged instead of repeating context.
- Reserve decision records (`docs/decisions/NNNN-title.md` from `0000-template.md`) for wire formats, crypto primitives, or storage schemas—not UI, refactoring, or lint tweaks.

## Workflow

- **Commits:** Use Conventional Commits with no AI attribution (`commit-msg` hook and `pr-title` CI check enforce this for `release-please`).
- **PRs:** One feature = one PR (multi-commit PRs are fine and squash-merged under the PR title). Avoid stacked PRs. Small fixes and chores can go straight to `main`.
- **No `Docs: none` trailer:** Docs are updated when relevant, not gated per commit.

## Pre-1.0 and security

- **No legacy migrations:** Breaking wire or storage changes are allowed pre-1.0. Do not add dual-format parsers, compatibility shims, or upgrade conflict UIs for older releases.
- **Self-found bugs:** Fix security bugs directly in normal commits or PRs. Do not spin up private GHSA forks before 1.0; keep [SECURITY.md](SECURITY.md) for external reports.
- **Reviews:** Cap crypto and protocol reviews at one focused pass scoped to a 5–12 friend threat model. Do not file speculative edge-case or backlog dumps.

## Engineering invariants

- **Crypto:** Use standard constructions and maintained libraries before writing custom crypto. Keep long-lived keys non-extractable in WebCrypto.
- **Rust crate (`packages/crypto-wasm`):** Wrap maintained Rust crates only behind `@pigeon/core` interfaces. Must pass `pnpm --filter @pigeon/crypto-wasm lint` (`rustfmt` + Clippy `-D warnings`) and `cargo test`. Keep `wasm-bindgen` versions aligned with `mise.toml`.
- **Canonical checks:** One accepted encoding per signed, hashed, or compared value. Compare decoded bytes, not text. Include purpose/context/room in signed bytes, and bind live handshakes to their channel to prevent replay.
- **Done means:** `mise run check` passes (and `mise run defects` / `mise run e2e` when touching crypto, signing, or networking). Stay inside the task scope.
- **Ask first:** Before deleting user data, changing a public interface, adding a dependency, or touching auth/secrets/crypto boundaries.
