# 0015: Feature folders everywhere

Code is grouped into one folder per feature in every package and app, never one flat directory.

- Status: accepted
- Date: 2026-11-24

## Context

`@pigeon/core` started as a flat `src/` and is about to grow to twenty-odd files in M2 (encoding, identity, envelopes, chat logs, pairing, test fakes, beside the window manager). The web app already uses layer folders with one folder per component ([0010](0010-component-folders-and-css-modules.md)). The author wants the same shape everywhere.

## Decision

Each package's `src/` holds one folder per feature (`encoding/`, `identity/`, `chat/`, ...) with its files and tests beside them; `index.ts` stays at the root as the package's only barrel. Inside the web app the layer folders stay, and each layer splits by feature or component (`platform/crypto/`, `platform/storage/`, `ui/button/`). A feature folder may import another feature by relative path; there is no per-folder barrel.

## Consequences

A feature's code, tests and fakes are found together, and a new feature is a new folder rather than more files in a long list. Imports gain one `../<feature>/` hop. Deciding which folder a small helper belongs in is a judgement call; shared ones go to the lowest feature that needs them (`encoding/`, `result/`).
