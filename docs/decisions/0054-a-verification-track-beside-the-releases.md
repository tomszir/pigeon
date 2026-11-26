# 0054: A verification track beside the releases

Pigeon's crypto and protocol get independent checks, built as plain Vitest tests in the repo, planned as a track of their own that runs beside the product releases and never blocks one.

- Status: accepted
- Date: 2026-11-26

## Context

Pigeon's security rests on what it refuses: a second spelling of a signature, an entry from a device that isn't the writer, a recover signed with a replaced key, an envelope replayed into another room. Several of the fixes in 0.8.1 and since were refusals that had gone missing or soft, found by people reviewing code. Nothing mechanical goes red when a refusal is weakened, unless a test happened to cover that exact case.

The existing tests are written by whoever wrote the code, from the same understanding. A test like that confirms the code does what its author meant, not what the docs say; where the two disagree, both are wrong the same way. What's missing is checks with their own source of truth (published test vectors, a model written from the docs) and a way to show those checks would actually fail.

That work is large and has no release of its own to ship in. Tied to the product releases, it would either hold them up or be dropped from them.

## Decision

- **In the repo, as plain tests.** Verification checks are Vitest tests, with fast-check for properties, in the packages they check, run by `mise run check`. No separate package, engine or command line tool.
- **Independent oracles.** Expected answers come from outside Pigeon's code: Wycheproof and RFC vectors, vendored byte for byte and hash-pinned, and reference models written from the docs by someone who hasn't read the code. The checks check themselves with planted defects (patches that must make a named test fail), defects in the models too, generator statistics, enumerator counts checked against their closed form, and printed seeds.
- **Its own queue.** Verification work has a `verification` label and milestones named "Verify · ...", planned in [roadmap-verification.md](../roadmap-verification.md). Each piece is an ordinary small PR into `main`. It never blocks a release; a release that adds a new signed format, log or parser adds an issue to the track instead.
- **Results flow back.** A merged check joins `mise run check`. A nightly run on `main` with random seeds and bigger bounds commits any failing seed to a corpus `check` replays, and files the bug in the product milestones, or as a private advisory if it can be exploited.
- **Two rules for product PRs.** Nothing gets weaker: a PR may not delete or loosen an existing check (a vector, a model rule, a planted defect) without saying why in its description. New boundaries are written down: a PR that adds a trust boundary adds a row to [verification.md](../verification.md), marked not yet verified.
- **No TLA+ for now.** The bounded check runs the production code, so there's no second model to drift; the Tamarin or ProVerif model of pairing, linking and recovery covers the attacker.

Ruled out:

- **A `packages/verify` framework**, with its own engines, an evidence store and a command line tool. Vitest already discovers, runs, reports and gates tests. A framework beside it is more code to trust and to keep working, and its results would live somewhere `check` doesn't look.
- **A long-lived verification branch.** It would check code that's already stale, wouldn't gate anything merged to `main`, would conflict with every product change to the files it tests, and releases come from `main`, so nothing it found would stop one.
- **TLA+ and TLC now.** A TLA+ spec is a second description of the device log, written by hand, that can drift from the code without anything noticing. The bounded check over the real code and the reference model gives the same coverage of histories without that gap, and the attacker is the formal model's job.
- **Verification blocking releases.** The track would become the critical path, and the pressure to ship would fall on the checks, which is where weakening them would start.

## Consequences

Weakening a refusal that a check covers turns `mise run check` red, and a check that can't fail shows up as a planted defect it misses. Which boundaries are covered, and which aren't yet, is written down in one place.

The Wycheproof vectors become a vendored test-data dependency (Apache-2.0), kept byte for byte and updated deliberately, as the other vendored files are.

Checks lag product work: a new boundary ships before its verification does. The two rules limit that lag to what's written down as not yet verified, and keep existing checks from eroding while the track catches up.

The checks show the code matches the docs, not that the docs are secure. That stays the formal model's job and an outside review's.
