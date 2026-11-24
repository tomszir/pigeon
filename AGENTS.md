# Working in this repo

Start with docs/README.md. It indexes the docs and says how to run and check the project.

## Docs

- docs/ describes the project as it is now. A change to behaviour, setup, an interface
  or a convention updates the doc that covers it, in the same commit. If no doc covers
  it, add one and list it in docs/README.md.
- A choice someone might later question goes in docs/decisions/NNNN-title.md, copied
  from 0000-template.md. Don't reverse an accepted decision without saying so and
  writing a new one that supersedes it.
- Every doc opens with a `# Heading` and then a one-line summary.
- Git history is the developers' change log. Don't keep one in docs/. Release notes for people
  are Changelog.txt, written on each release PR (decision 0025).
- A commit with nothing to document carries the trailer `Docs: none`.
- `scripts/check-docs` checks all of this. It runs when you finish and in CI.

## Commits

- Conventional Commits with no AI attribution, as [CONTRIBUTING.md](CONTRIBUTING.md) describes. The `commit-msg` hook and the `pr-title` CI job reject anything else.
- One task, one commit; PRs are squash-merged under their title.

## Done means

- The checks in docs/README.md pass, and you have shown their output.
- `scripts/check-docs` passes.
- The change stays inside the task. Mention anything else you noticed instead of fixing it.

## Ask first

Deleting data, changing a public interface, adding a dependency, and anything that
touches auth, secrets or security.
