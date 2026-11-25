# 0032: Explorer on this computer first

Pigeon Explorer, PigeonHTML and in-world Help are built now as M17, for pages that ship with Pigeon, while hosting pages on the peer net stays in M5.

- Status: accepted
- Date: 2026-11-25

## Context

M5 bundles two kinds of work. One part is local: the PigeonHTML sanitizer, the Explorer window, and rendering a page safely. The other part needs the peer net: the resolver, hosting, mirrors, and snapshots built from M3's chunks. That second part waits behind M16, M7, M4, M8 and M3. The docs are also getting hard to follow as the protocol grows. The brief already promises Help files written in-world, and pages of the time explained things with numbered diagrams and RFC-style specs. The local half of M5 touches nothing the protocol work touches, so it can be built alongside it.

## Decision

- **M17, Explorer on this computer.** PigeonHTML's allowlists, `sanitize` and `validate`. The Explorer window: back, forward, stop, refresh, home, an address bar, a status bar that says where a page came from, and the "page not hosted" screen for every address it can't serve yet. In-world Help. M5 keeps the resolver, hosting, mirrors, the page builder, widgets, webrings and the portal.
- **Pages that ship with Pigeon.** Explorer serves `pigeon://help/...` and its start page from pages bundled with the app, and the status bar says "On this computer". Every other address gets "page not hosted" until M5. Bundled pages go through the same `sanitize` as anyone's page, so Help can never do more than a user's page can.
- **HTML parsed with parse5.** `@pigeon/pigeonhtml` parses with parse5, a spec-compliant HTML parser with one dependency (entities), in the browser and later on the Lighthouse. This replaces 0004's `DOMParser`, so a single parser decides what a page holds everywhere. It's spec-compliant, so it reads a page the way the browser that renders it will. The sanitizer walks the parsed tree against the allowlists and serializes what's left. Anything not on a list is dropped, never escaped and kept.
- **Rendered in a sandbox.** A sanitized page renders, with no doctype, in an iframe with `sandbox="allow-same-origin"` and never `allow-scripts`, under a CSP of `default-src 'none'; img-src` limited to the page's own images and `style-src 'unsafe-inline'`. Explorer reads link clicks from the frame's document and navigates itself. The sanitizer is the first wall and the sandbox is the second. Either alone keeps scripts out.
- **Help from docs/.** In-world Help has two parts. "How Pigeon Works" is hand-written PigeonHTML pages for people, with numbered step diagrams. "The Pigeon Protocol" is an RFC-style spec generated from `docs/protocol.md` and `docs/glossary.md` at build time, so it can't drift from docs/. Markdown becomes PigeonHTML with a small in-house converter for the subset the docs use (headings, paragraphs, lists, tables, links, inline code and fenced blocks), not a library.
- **Diagrams in ASCII.** PigeonHTML has no SVG and no scripts, so a diagram meant for Help is drawn in ASCII in a `text` fenced block in docs/, the way RFCs draw state machines, and shows as `<pre>`. Mermaid stays allowed in decision records, which Help doesn't show.

## Consequences

Explorer ships long before M5, and the docs get a second, in-world way in. M5 starts with a sanitizer and a browser that already work. parse5 is a new dependency of `@pigeon/pigeonhtml`, and it settles 0004's open question of a Node parser for the Lighthouse. A generated spec carries the real docs' words, including some that belong to 2026 (Trystero, Nostr), and that's accepted in a spec page. The stack, architecture and decision records stay out of the world. Diagrams in Help are monospaced text, never pictures.
