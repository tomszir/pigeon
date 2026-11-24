# Contributing

How commits and pull requests are written here, so the history stays readable.

## Setup

Install [mise](https://mise.jdx.dev), then:

```sh
mise run setup   # dependencies, git hooks, CSS module types
mise run dev     # the web app on Vite's dev server
```

Before opening a PR, run `mise run check` and `mise run build`. [docs/README.md](docs/README.md) says what the check covers.

## Commits and PRs

- **Conventional Commits:** `type(scope): summary`, for example `fix(shell): keep the menu open while moving to All Programs`.
  - Types: `feat` `fix` `perf` `refactor` `docs` `test` `build` `ci` `chore` `revert`.
  - The summary is imperative, lowercase, at most 72 characters, with no trailing period.
  - Write `feat`, `fix` and `perf` summaries for users: what they'll notice, not how it was done. Scope them by area when one fits: `shell`, `ui`, `monitor`, `messenger`, `letters`, `files`, `explorer`, `builder`, `core`, `pigeonhtml`, `lighthouse`.
  - Mark breaking changes with `type!:` or a `BREAKING CHANGE:` footer, including anything that makes a visitor redo something, such as a change to the identity or log format that old data can't follow.
- **Lean messages:** add a body only when the reason isn't obvious from the summary.
- **Docs trailer:** a commit that changes nothing documented carries `Docs: none` ([AGENTS.md](AGENTS.md)).
- **One topic per PR.** PRs are squash-merged, so the **PR title becomes the commit**: make it a conventional commit. Keep the description to a line or two on what and why, plus how you tested it.
- **No AI attribution** lines (`Co-Authored-By` bots, "Generated with …") in commits or PRs.

The `commit-msg` git hook and the `pr-title` CI job enforce the format (`scripts/commit-message.ts`).

## Releases

[release-please](https://github.com/googleapis/release-please) reads the Conventional Commits on `main` and keeps a release PR open, `chore: release <version>`. Below 1.0, a `feat` raises the minor version and a `fix` the patch. Merging that PR tags `v<version>`, writes the GitHub release from the commit summaries, and deploys the site ([decision 0021](docs/decisions/0021-releases-with-release-please.md)). Merging it is the maintainer's call.
