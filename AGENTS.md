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
- Write docs and code comments for a stranger, as [CONTRIBUTING.md](CONTRIBUTING.md#writing-docs-and-comments)
  says: what is so and, where it isn't obvious, why, in the text itself. No citing decision
  records, milestone numbers or the roadmap, and nothing about the maintainer's own machines,
  accounts or plans. The decision records and the roadmap, that is roadmap.md and roadmap-*.md, all in docs/, are the only places
  those live.
- Git history is the developers' change log. Don't keep one in docs/. Release notes for people
  are Changelog.txt, written on each release PR.
- A commit with nothing to document carries the trailer `Docs: none`.
- `scripts/check-docs` checks all of this, citations included. It runs when you finish and in CI.

## Commits

- Conventional Commits with no AI attribution, as [CONTRIBUTING.md](CONTRIBUTING.md) describes. The `commit-msg` hook and the `pr-title` CI job reject anything else.
- One task, one commit; PRs are squash-merged under their title.
- `feat` only for a significant new feature. A user-visible change made to fix a bug or add a missing protection is a `fix`, so it ships as a patch.

## Security

- A security problem goes in a private draft advisory on GitHub, as [SECURITY.md](SECURITY.md) says, never in an issue, a public PR or a commit message before its release is live. Its fix is made in the advisory's temporary private fork, and the advisory is published once the release is out. Public issues can carry the parts of a fix that reveal nothing unfixed.
- Each advisory has its own private fork. Worktrees share one git config, so name each fork's remote after its advisory (`ghsa-<id>`), never one shared `ghsa`, and check `git remote get-url` before pushing. CI doesn't run in those forks: run `mise run check`, `mise run build` and `mise run e2e` yourself and put the output in the PR.
- An advisory's fix reaches `main` as "Merge commit from fork", which release-please skips. So its release's notes are added by hand: a plain line in the release PR's Changelog.txt section that doesn't say how to attack it, and a Security section in the GitHub release that links the advisory. Set each advisory's patched version when publishing it.
- Use a standard construction or a maintained, reviewed library before writing Pigeon's own. A new construction needs a decision record that says why no standard fits.
- Long-lived keys (identity, device, sealing) stay non-extractable in WebCrypto. Don't move them into JavaScript or WebAssembly memory; libraries there get short-lived or session secrets only.
- `packages/crypto-wasm` is the one Rust crate: protocols from maintained Rust libraries only, never Pigeon's own logic, behind an interface core declares. A Rust change passes `pnpm --filter @pigeon/crypto-wasm lint` (rustfmt, Clippy with warnings as errors) and `test`, which `mise run check` runs; bumping the `wasm-bindgen` crate means bumping the wasm-bindgen CLI in `mise.toml` to the same version.
- Anything signed, hashed or compared has exactly one accepted encoding. Compare decoded bytes, never the text of a signature or key.
- Every signature says what it's for (its room or kind is in the signed bytes), so it can't be reused as something else.
- A signature proves who wrote a message, not who is sending it now. A message that counts only when its sender is there (a hello, a handshake, anything a session acts on) is bound to the channel it arrives on and refused when replayed.
- A change to crypto, pairing, linking, device logs, recovery, sessions or Lighthouse limits gets review rounds before it's merged: a fresh reviewer each round, given the diff, the decision records and the findings already fixed, asked for proven scenarios. The maintainer approves the merge.

## Issues and decisions

- Issues follow the forms in `.github/ISSUE_TEMPLATE/` and [CONTRIBUTING.md](CONTRIBUTING.md#issues). Filed from the command line, the body uses the form's headings (`### What happened`, `### Why`, `### Done when`, ...) and the labels the form would add, with `triage` swapped for a priority once one is known.
- A new decision record takes the number after the highest in docs/decisions/; check no other record has it.
- To choose a release's version rather than let release-please pick it, end a pull request's description with `Release-As: x.y.z`.

## Done means

- The checks in docs/README.md pass, and you have shown their output.
- `scripts/check-docs` passes.
- The change stays inside the task. Mention anything else you noticed instead of fixing it.

## Ask first

Deleting data, changing a public interface, adding a dependency, and anything that
touches auth, secrets or security.
