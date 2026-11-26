# 0058: PigeonHTML pages written as typed JSX

Help's pages are written as JSX that a small runtime in `@pigeon/pigeonhtml` turns into text, with element and attribute types derived from the sanitizer's own allowlists. The start page stays a plain `.html` file, which the one test over every bundled page still checks.

- Status: accepted
- Date: 2026-11-26

## Context

Help's pages were TypeScript template strings. Escaping was done by hand with `escapeHtml`, and a piece of HTML was put into another with `${}`, so nothing said which strings were already markup. A disallowed element or attribute showed up only when a test ran `sanitize` over the page and found it taken out, and the start page had no such test at all. [0032](0032-explorer-on-this-computer-first.md) put Help in the app as pages made from strings; [0004](0004-pages-limited-to-2000s-html-css.md) made the allowlists the definition of what a page may hold.

What any answer has to live with:

- **A page is text.** Explorer hands a page's source to `sanitize`, so whatever writes a page must produce a string, and the sanitizer stays the one authority on what is kept.
- **No new dependency**, and nothing that runs in the page: the output is the same 2003-style HTML, not a component tree.
- **Solid owns `.tsx`.** The web app's Solid plugin compiles every `.tsx` file to DOM code, so any JSX for pages has to be kept away from it.
- **Diagrams are exact.** Help's ASCII diagrams are byte-for-byte part of the page.

## Decision

- **Typed JSX.** `@pigeon/pigeonhtml/jsx-runtime` (and `jsx-dev-runtime`) is a JSX runtime that writes text. Its types come from `allowlists.ts`, whose tables are now literal (`as const`) and from which the sanitizer's Maps and Sets are built, so the two can't disagree: `<section>`, `<td onclick>` and `<img name>` don't compile, and `noshade` takes a boolean.
- **Escaping is the runtime's, not the author's.** Every string or number child and every attribute value is escaped. A JSX expression makes an opaque `Html` value, which is what a child may be besides text; a string never counts as markup. `raw()` is the one explicit way to put markup in unescaped, used where a converter that escapes what it reads (the Markdown behind the protocol spec) has already made it.
- **Pages are `*.pigeon.tsx`** and start with `/** @jsxImportSource @pigeon/pigeonhtml */`. A Vite plugin refuses a `.tsx` file whose name and pragma disagree, since either way round it would be compiled by the wrong one. The web app's Solid plugin excludes the name, and Vite is told to lower any JSX Solid left to the automatic runtime, since it would otherwise follow `jsx: preserve` from the tsconfig Solid needs and leave raw JSX in the file. Both are checked in dev and in the build.
- **`<Pre text={...}>` keeps whitespace.** JSX collapses the whitespace of text written between tags, and Biome reflows it, so a diagram goes in as a string in a prop, which neither touches.
- **One test over every bundled page.** The types can't see a `data-` attribute (TypeScript exempts hyphenated names from its excess-attribute check) or anything spread in, so a single test runs `validate`, `sanitize`, the budget and the link check over every page Explorer serves, the start page included.
- **The sanitizer is still the gate.** The runtime writes text and enforces nothing about the allowlists at run time. It refuses only what would break its own output: an element or attribute name that isn't a name, children in a void element, a value that isn't text, a `<style>` holding a `<` or anything but a string, and a child or component result that isn't `Html`. The types stop a component that may return `null` before then.

## Consequences

A page that uses something PigeonHTML lacks fails in the editor and in `tsc`, and markup built from text can't be made to carry it, which hand-escaped strings could. Output changes only in whitespace between elements and in what is written as a character rather than an entity, which a browser doesn't show; every converted diagram is byte-identical.

It costs a public export, one more way a `.tsx` file can be compiled in the web app (the name says which), and a Vite option that applies to all of it. Pages are built when the app loads, so a runtime refusal in one is an error at load, found by any test that imports it.

Ruled out:

- **A tagged template.** It can escape what is interpolated, but the literal around it is still an unchecked string, so a bad element or attribute is found no earlier than before, and a template's result needs the same brand to nest.
- **Build-time includes** of `.html` partials. The pages stay plain HTML, but composing a frame around a chapter would need a build step, escaping would still be done by whoever writes the data, and nothing would be typed.
- **Solid's own string rendering, or a template or JSX library.** The first drags the SSR build and hydration markup into pages that are plain text, and a library is a new dependency for a few hundred lines.
