# 0040: Minor versions for bigger features

A minor version means something new and significant for the people using Pigeon; everything else, a bug or security fix that changes what's on screen included, is a patch.

- Status: accepted
- Date: 2026-11-26

## Context

release-please picks the version from Conventional Commit types: below 1.0, a `feat` raises the minor version and a `fix` the patch. Fixing a bug or closing a security gap often adds or changes something people see, such as a confirmation step or a warning, and calling that a `feat` would turn a fix release into a minor one. People read a new minor version as "something new to try", so it should mean that.

## Decision

- `feat` is for a new capability people would notice and want to hear about: a new app, a new way to reach friends, a new kind of content.
- A change made to fix a bug, or to add a protection that should have been there, is a `fix`, even when it adds or changes UI. So is a small polish to something that exists.
- Breaking changes (`type!:` or `BREAKING CHANGE:`) still raise the minor version below 1.0, since they make people redo something.
- When the commits still pick the wrong version, the pull request's description ends with `Release-As: x.y.z`.

The release-please configuration stays as it is; the rule lives in how commits are typed.

## Consequences

Security releases ship as patches, even when they add a step to a flow. The changelog still lists `fix` summaries, so a visible change made under `fix` is still announced. It takes judgement at review time to call something a `feat`; when in doubt, it's a `fix`.
