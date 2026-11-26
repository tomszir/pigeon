# Roadmap: verification

The verification track: independent checks of Pigeon's crypto and protocol, built in stages that run beside the product releases, with what each stage brings and the check that says it's done.

This is a companion to [roadmap.md](roadmap.md), which links to it. [verification.md](verification.md) is the map of what is checked today; this file is the plan for what comes next. Why the track works this way is [0054](decisions/0054-a-verification-track-beside-the-releases.md).

## Goal

Checks that fail when someone weakens a refusal. Pigeon's security rests on what it refuses: a signature in a second spelling, an entry from a device that isn't the writer, an envelope replayed into another room, mail whose commitment was changed. Today a reviewer reading the code is what notices when one of those refusals goes soft. The track makes it mechanical: for each trust boundary, a check written from an independent source of truth that goes red when the code stops refusing what the docs say it refuses.

The checks are plain Vitest tests, with fast-check for properties, kept in the packages they check and run by `mise run check`. There is no separate framework, command line tool or long-lived branch.

## How the track works

The track is downstream of the product releases. It never holds one up.

- **Its own queue.** Verification work is filed as issues with the `verification` label, in milestones named "Verify · ..." after the stages below. Each piece is an ordinary small PR into `main`, reviewed and merged like any other.
- **New boundaries come here.** When a release adds a signed format, a log or a parser, an issue is added to this track to verify it, in the stage it fits or a new one.
- **Results flow back.** A merged check joins `mise run check`, so from then on it gates every product PR. A nightly run on `main` runs the property tests with random seeds and bigger bounds; a seed that fails is committed to a corpus that `check` replays every time, and the bug it found is filed in the product milestones (or, if it can be exploited, as a private draft advisory, as [SECURITY.md](../SECURITY.md) says).

Two rules hold for product PRs, so the checks don't fall behind the code:

1. **Nothing gets weaker.** A PR may not delete or loosen an existing check (a test vector, a rule in a reference model, a planted defect) without saying why in its description.
2. **New boundaries are written down.** A PR that adds a trust boundary (a signed format, a log, a parser) adds a row for it to [verification.md](verification.md), marked not yet verified.

## How the checks check themselves

A test that passes against a broken implementation is worse than none, since it reads as cover. So every check needs a reason to believe it would fail.

- **Independent sources of truth.** Expected answers come from somewhere other than Pigeon's code: Wycheproof and RFC test vectors, vendored byte for byte with their hashes pinned so an edit to one shows; and reference models written from the docs alone, by someone who hasn't read the code they'll be checked against.
- **Planted defects.** Patches under `verification/defects/`, each one weakening one refusal and naming the test that must catch it. A script runs a clean control first, then applies them one at a time and requires the named test to fail by its assertion, not by a compile error. A patch that no longer applies fails the script loudly instead of being skipped, so a refactor can't quietly retire a defect.
- **Defects in the models too.** The reference models get planted defects of their own, so a model that agrees with everything is caught.
- **Generators that do something.** Property tests report statistics on what they generated (how many histories had a recovery, a removal, a stale epoch), and fail if the interesting cases are too rare, so a test can't pass by never reaching them.
- **Counted enumeration.** A bounded enumerator checks the number of histories it visited against the closed form for its bounds, so a pruning bug can't shrink it unseen.
- **Replayable failures.** Every property run prints its seed, and a failure replays from it.

What this can't show:

- That the docs are secure. It shows the code does what the docs say. Whether what they say is enough is the formal model's job (V4) and an outside review's (V5).
- Anything past its bounds. A bounded check is complete inside its bounds and says nothing beyond them.
- What each browser does. The tests run on Node's WebCrypto, which isn't Chrome's, Firefox's or Safari's; the end-to-end tests cover Chromium only.

## Stages

Each stage matches a "Verify · ..." milestone, and runs alongside the product release named with it.

### V1 · Map and crypto contracts

Alongside 0.8.2 · Standard building blocks.

[verification.md](verification.md), the map of every trust boundary and what checks it. A crypto contract suite that every implementation of `Crypto`, `SealCrypto` and `Sealer` runs, the web app's WebCrypto ones and the Lighthouses' (Node and Cloudflare Worker) alike, fed by vendored Wycheproof vectors for ECDSA P-256 (P1363 encoding), Ed25519, HMAC-SHA256, ECDH P-256, HKDF-SHA256 and AES-GCM, plus Pigeon's own rule that a high-S P-256 signature is refused. The planted-defect script, with its first defects against the contract suite. HPKE (#106) and Argon2id (#107) vectors join the suite when they land.

**Done when** every `Crypto`, `SealCrypto` and `Sealer` implementation passes the contract suite in `mise run check`, every Wycheproof vector file is hash-pinned, and the planted-defect script catches each of its defects after a clean control run.

### V2 · Device log

Alongside 0.8.3 · Seamless.

A reference model of the device log, written only from [protocol.md](protocol.md), [threat-model.md](threat-model.md) and the device-log decisions. A differential property test that runs random sequences of operations against the model and the real code and requires the same verdicts and the same lists. A check of every history up to a small bound (for example 3 devices, 2 recovery keys, depth 5), with its count checked against the closed form. Planted defects: an append by a device that isn't the writer, a recover from a stale epoch, a recover signed with a replaced recovery key, the kind dropped from the signed bytes, and signatures compared as text.

It follows #160 (typed signing), so the model has one set of signed bytes to describe, and becomes the test for #135 (ties between recoveries).

**Done when** the model and the code agree on every history inside the bound and on the nightly random runs, and each planted defect, in the code and in the model, is caught.

### V3 · Parsers

Alongside 0.9.0 · Groups.

Malformed-input fuzzing of everything Pigeon reads from someone else: envelopes, mail, Lighthouse frames, imported data files, and the PigeonHTML sanitizer, with its re-parse audit as the oracle. The group membership log gets V2's pattern (reference model, differential test, bounded check, planted defects) from the start, rather than after it ships.

**Done when** each parser has a fuzz target in `mise run check` with a committed corpus, none throws anything but its own refusal, and the group membership log's model and code agree inside its bound.

### V4 · Formal

Alongside 0.9.x · Hardening.

#112: the Tamarin or ProVerif model of pairing, linking and recovery, with its rules matched to V2's reference model so a counterexample found in one replays in the other. #135 changes the formal model, the docs and the code together.

**Done when** the formal model proves the properties [threat-model.md](threat-model.md) claims for pairing, linking and recovery, and a trace from it replays against V2's reference model.

### V5 · Outside review

Before Lighthouses for everyone.

An independent security review of the protocol and its code. Tests, vectors and formal models are all still Pigeon checking itself; only someone outside can change the README's note that Pigeon hasn't been independently audited.

**Done when** the review's report is published and every finding in it is fixed or answered in writing.

## Not planned

- **A verification framework or command line tool of Pigeon's own.** Vitest already discovers, runs, reports and gates tests; a framework beside it would be one more thing to keep working and to trust.
- **TLA+, for now.** The bounded check runs the production code itself, so there is no second model to drift from it; Tamarin or ProVerif covers the attacker.
- **Mutation testing across the repo.** It's slow and noisy. StrykerJS on a few files may come later, run nightly; planted defects cover the refusals that matter meanwhile.
