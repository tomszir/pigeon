# 0025: Release notes for people

Each release ships with notes written for the people using Pigeon, in `Changelog.txt` on the desktop; git history stays the developers' change log.

- Status: accepted
- Date: 2026-11-24

## Context

M12 (roadmap) tells a returning visitor that Pigeon changed and shows them what changed. [0021](0021-releases-with-release-please.md) and AGENTS.md said there is no changelog file: git history and the GitHub releases are the change log. Those are written for developers. Even a well-written commit summary names an area (`messenger:`), and a release also carries `ci`, `docs` and dev-server changes nobody using Pigeon would notice. The era's programs shipped a readme and a "what's new" text file next to them, written for their users.

## Decision

- `apps/web/src/apps/reader/changelog/changelog.txt` holds the notes: plain text in the Read Me's 46 columns, one section per release, newest first, each headed `<version>, <day month year>`. It's bundled into the app and opened as Changelog.txt in Pigeon Reader, the same window as Read Me. A release with nothing for people to notice can be left out.
- The notes are drafted when release-please opens or updates the release PR. The release-please workflow runs `scripts/release-notes.ts`, which adds a section for the new version made from the `feat`, `fix` and `perf` summaries since the last tag (scope and PR number dropped, written as sentences), and pushes it to the release PR's branch. The maintainer rewrites it in plain words before merging, which stays the maintainer's call (0021).
- release-please rebuilds its branch whenever main moves. The workflow notes the branch's previous head first, and the script keeps the section from there and only adds lines for commits since, so edits on the release PR survive. The heading's date is set to the day of the latest draft.
- A unit test holds the newest section to the root `package.json` version, so a release PR without notes fails CI.
- On load, Pigeon compares the version with the last one this browser saw (`seenVersion` in the Store). A visit that has nothing stored, not even an identity, is a first visit: it saves the version and says nothing. Otherwise, if the version is newer, it shows a balloon, "Pigeon was updated to 0.4.0. See what's new?", that opens Changelog.txt when clicked, and saves the version. A visit that opened an invite link holds the balloon back for the next visit.
- release-please still writes no changelog file (`skip-changelog`), and the GitHub release keeps its commit-subject notes for developers.

This supersedes 0021's "There is no changelog file"; the rest of 0021 stands.

## Consequences

People get told once, in their words, and the maintainer writes each release's notes as part of shipping it, starting from a draft rather than a blank file. A draft merged unedited still reads like commit summaries, so the edit is the maintainer's job. The workflow now pushes to the release PR's branch, with the same `RELEASE_PLEASE_TOKEN` so CI runs on it. A visitor whose browser can't store anything is always on a first visit, so never sees the balloon. Notes before 0.2.0 aren't kept separately: 0.2.0's section covers what Pigeon could do by then.
