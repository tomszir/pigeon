# 0004: Pages limited to 2000s HTML/CSS

Pigeonweb pages are written in PigeonHTML: HTML 4.01 Transitional and CSS 2.1, sanitized by allowlist, with no scripts.

- Status: accepted
- Date: 2026-11-24

## Context

Pages are made by users and served by other users, so they must be safe to render. They should also look like 2003, which is the whole point of the alternate-reality premise.

## Decision

Enforce the subset in [pigeonhtml.md](../pigeonhtml.md) with allowlist tables in `@pigeon/pigeonhtml`, parsed with the browser's `DOMParser` (and an equivalent in Node for the Lighthouse). Interactivity comes only from host-drawn widgets declared as SSI comments. Render without a doctype in a sandboxed, script-free iframe with a strict CSP and a 100 KB budget.

## Consequences

One mechanism gives safety and authenticity. Users cannot use modern layout or scripts, by design. Exact IE6 rendering bugs are out of reach; quirks mode is the accepted approximation. The Lighthouse needs a DOM parser in Node, chosen at M5 (asked first, as a dependency).
