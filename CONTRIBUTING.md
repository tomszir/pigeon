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
  - `feat` is only for a new capability people would notice and want to hear about. A change that fixes a bug or adds a missing protection is a `fix`, even when it adds or changes UI, and so is polish to something that exists. When in doubt, it's a `fix`.
  - Mark breaking changes with `type!:` or a `BREAKING CHANGE:` footer, including anything that makes a visitor redo something, such as a change to the identity or log format that old data can't follow.
- **Lean messages:** add a body only when the reason isn't obvious from the summary.
- **Docs trailer:** a commit that changes nothing documented carries `Docs: none` ([AGENTS.md](AGENTS.md)).
- **One topic per PR.** PRs are squash-merged, so the **PR title becomes the commit**: make it a conventional commit. Keep the description to a line or two on what and why, plus how you tested it.
- **No AI attribution** lines (`Co-Authored-By` bots, "Generated with …") in commits or PRs.

The `commit-msg` git hook and the `pr-title` CI job enforce the format (`scripts/commit-message.ts`).

## Issues

Bugs and features are filed through the issue forms; security problems are reported privately, as [SECURITY.md](SECURITY.md) says.

- **Labels:** one kind (`bug`, `feature`, `security`, `docs`), one priority (`p1` before the next release, `p2` soon, `p3` some day) and, where one fits, an area (`core`, `lighthouse`, `web`). New issues start with `triage`, which comes off when a priority goes on. The forms add the kind, and a workflow adds the area the form names.
- **Milestones:** each planned release has one. A `p1` goes into the next release; a `p2` into the release it belongs with; a `p3` stays without a milestone until it's chosen for one.
- **Lean:** short bullets of fact, not paragraphs. Point at `path:line`, say who can do what, and don't restate the title.
- **Shape:** what's wrong, how it's reproduced (steps, a failing test or a command, or that it wasn't), and what "done" means: a check someone else could run.
- **Closing:** a PR that fixes an issue says `Fixes #N` in its description. Duplicates and ideas that won't happen are closed with GitHub's own reasons, not labels.

## Writing docs and comments

Pigeon is public, so write every doc and comment for someone who has never met the project or the people behind it.

- **Say what is so, and why.** A comment explains what the code does or why it does it that way, in its own words. "Kept to one tab, because two tabs would be the same device twice in every room" beats a bare pointer to a decision record.
- **No pointers to plans or records.** Docs and comments don't cite decision records, milestones or the roadmap, and don't say what's coming "later" or "for now". The decision records and the roadmap, that is roadmap.md and its companions roadmap-*.md, all in docs/, are where those live, and nothing else needs to link to them to make sense.
- **No dividers.** A comment speaks about the code beside it. It doesn't label or fence off a part of the file, as `// ===== Safety =====` or `// ---------- helpers ----------` do. A file that needs sections is several files.
- **Nothing personal.** Describe what anyone running Pigeon would do, not one person's machines, home network, accounts or other projects.

`scripts/check-docs` rejects decision and milestone citations outside those two places, and divider comments in code.

## Releases

[release-please](https://github.com/googleapis/release-please) reads the Conventional Commits on `main` and keeps a release PR open, `chore: release <version>`. Below 1.0, a `feat` or a breaking change raises the minor version and a `fix` the patch, which is why `feat` is kept for bigger features. The workflow drafts the release's section of Changelog.txt (`apps/web/src/apps/reader/changelog/changelog.txt`) on that PR from the `feat`, `fix` and `perf` summaries; the maintainer rewrites it in plain words for the people using Pigeon before merging. Merging that PR tags `v<version>`, writes the GitHub release from the commit summaries, and deploys the site. Merging it is the maintainer's call. A security fix merged from an advisory's private fork lands as "Merge commit from fork", which release-please doesn't read, so it's added to that release's notes by hand, as [AGENTS.md](AGENTS.md#security) describes.
