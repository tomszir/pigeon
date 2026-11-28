# 0021: Releases with release-please

The site carries a version number, set by release-please from the Conventional Commits on main, and Cloudflare deploys only released commits, through a `release` branch.

- Status: accepted; its "no changelog file" is superseded by 0025
- Date: 2026-11-24

## Context

[0017](0017-deploy-from-cloudflare-workers-builds.md) deployed every push to main, and the version in About and Read Me was a hand-typed "0.1". The maintainer wants each release to show as a new version on the site, and main to be a place work lands before it ships. Commits already follow Conventional Commits, checked by the commit hook and the PR-title job, which is what release-please reads. Workers Builds builds branches, not tags.

## Decision

- The root `package.json` holds the version (0.1.0 to start). `vite.config.ts` reads it into `__PIGEON_VERSION__`, and the build's commit (`WORKERS_CI_COMMIT_SHA`) into `__PIGEON_COMMIT__`; About shows both, Read Me the major.minor.
- `.github/workflows/release-please.yml` runs release-please on each push to main. It keeps one release PR open, `chore: release <version>`, bumping the version as the commits since the last release say: below 1.0 a `feat` raises the minor, a `fix` the patch, a breaking change the minor. Merging it tags `v<version>` and writes a GitHub release with the notes. There is no changelog file: git history and the releases are the change log (AGENTS.md).
- The same workflow then force-moves a `release` branch to the released commit. The `pigeon` Worker's production branch in Workers Builds is `release`, so only releases deploy; other branches, main included, can get preview builds.
- The release PR only touches the version, so the docs check skips release-please's branches. A `RELEASE_PLEASE_TOKEN` secret (the maintainer's fine-grained token) lets CI run on the release PR; without it the PR is still made, but GitHub runs no checks on it.

This supersedes 0017's "a push to main deploys"; the rest of 0017 stands.

## Consequences

Shipping is a merge of the release PR, which the maintainer does; agents never do. Main can hold work that isn't released yet, and what's live is always a tagged version whose number the site shows. A release is only as well described as its commit summaries, which CONTRIBUTING already asks to be written for users. The `release` branch is owned by the workflow and is never pushed by hand, except to roll back.
