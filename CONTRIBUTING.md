# Contributing

Setup, commit conventions, and release workflow for Pigeon.

## Setup and checks

Install [mise](https://mise.jdx.dev), then:

```sh
mise install && mise run setup   # tools, dependencies, git hooks, CSS module types
mise run dev                     # web app dev server
mise run check                   # lint, Rust lint/test, typecheck, unit tests, script tests
mise run build                   # production web build
```

See [docs/README.md](docs/README.md) for `mise run defects` and `mise run e2e`.

## Commits and PRs

- **Conventional Commits:** `type(scope): summary` (e.g. `fix(shell): keep menu open when moving to All Programs`).
  - Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`.
  - Imperative lowercase summary, at most 72 characters, no trailing period.
  - Keep `feat` for notable user-facing features; use `fix` for bug fixes, hardening, and polish.
- **PR shape:** One feature per PR. Multiple commits inside a PR are fine; PRs are squash-merged under the PR title, which must follow Conventional Commits.
- **No AI attribution:** Do not add `Co-Authored-By` bot lines or "Generated with ..." trailers (`scripts/commit-message.ts` rejects them).

## Docs and issues

- Write docs and comments for a stranger in plain, concise English (short bullets and tables over long prose). Reference `docs/decisions/` or `docs/protocol.md` directly where helpful.
- Keep issues short and factual: what happened, how to reproduce it, and what "done" means. Reference `Fixes #N` in PR descriptions when closing an issue.
- Report external vulnerabilities privately via [SECURITY.md](SECURITY.md).

## Releases

[release-please](https://github.com/googleapis/release-please) maintains a `chore: release <version>` PR on `main` and drafts `Changelog.txt` (`apps/web/src/apps/reader/changelog/changelog.txt`). Merging that PR tags the version, updates the `release` branch for Cloudflare deployment, and publishes the Lighthouse Docker image. Add `Release-As: x.y.z` at the end of a PR description to override the next version.
