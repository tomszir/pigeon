# 0001: pnpm monorepo from the start

The repo is a pnpm workspace with `apps/web`, `apps/lighthouse`, `packages/core` and `packages/pigeonhtml` from day one.

- Status: accepted
- Date: 2026-11-24

## Context

The browser app and the always-on Lighthouse peer (Node) must speak the same protocol and sanitize pages the same way. Starting as one app and splitting later would mean untangling browser APIs from protocol code after the fact.

## Decision

Use a pnpm workspace (`apps/*`, `packages/*`) like the maintainer's seams repo. Shared, pure code lives in `@pigeon/core` and `@pigeon/pigeonhtml`; packages are consumed as TypeScript source via `workspace:*`, with no build step of their own.

## Consequences

The pure/impure line is physical: packages cannot reach browser APIs or Solid, and Biome enforces it. The Lighthouse can reuse everything except `platform/`. Costs a little more config up front; turbo or nx are not used.
