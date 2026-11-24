# 0006: Solid and the house toolchain

The web app uses Solid, Vite, strict TypeScript, Biome, Vitest and mise, the same as the author's other web projects.

- Status: accepted
- Date: 2026-11-24

## Context

The original design spec on the canvas assumed React. The author's own web projects (boot-web, aloft, seams) consistently use Solid with Vite, plain CSS tokens, Biome and mise, and use React only where a tool forces it.

## Decision

Solid for UI; Vite to build; TypeScript strict per `tsconfig.base.json`; Biome for format and lint; Vitest with happy-dom and Solid Testing Library; Playwright for e2e; plain CSS with `tokens.css`; mise for tools and tasks, `mise run check` as the gate. This supersedes the canvas spec's React choice.

## Consequences

Familiar patterns and configs can be copied from seams and aloft. Fine-grained signals suit a window manager with many small updates. Some React-only libraries are out, which matches the small-dependency goal anyway.
