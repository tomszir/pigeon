# PigeonHTML

The 2000s-only subset of HTML and CSS that Pigeonweb pages may use, and how it is enforced.

## Why

Pages should look like they were made in 2003, because in Pigeon's world they were. Limiting the language does that better than any filter, and it also makes pages safe to render: no scripts, no network, nothing modern to abuse.

## The subset

- **HTML**: HTML 4.01 Transitional elements, including `font`, `center`, `marquee`, `blink` (rendered by Explorer), tables and image maps. No `script`, `iframe`, `object`, `embed`, `canvas`, `svg`, `video`, `audio`, `form` posting anywhere, or any HTML5 element. Framesets and forms are deferred (below).
- **Attributes**: the HTML 4.01 presentational set (`bgcolor`, `background`, `text`, `link`, `vlink`, `align`, `valign`, `border`, `cellpadding`, `cellspacing`, `width`, `height`, `color`, `face`, `size`, ...), plus `href`, `src`, `alt`, `title`. No `on*` handlers, `style` limited to the CSS below.
- **CSS**: CSS 2.1 properties only. No flexbox, grid, `border-radius`, `box-shadow`, gradients, transforms, transitions, `var()`, `calc()`, `@font-face`, `@import` or media queries beyond `screen`/`print`.
- **Fonts**: the web-safe families of the era, each mapped to a bundled free clone: Tahoma, Verdana, Arial, Helvetica, Geneva and Trebuchet MS to the Wine Tahoma clone, and Courier New, Courier, Lucida Console and Monaco to Bitstream Vera Sans Mono. Anything else falls back to the default, Tahoma. The sanitizer keeps `face` and `font-family` as written, and Explorer does the mapping.
- **Images**: GIF, JPEG and PNG, animated GIFs allowed, from the page's own files only.
- **Size**: a dial-up budget, 100 KB per page including images. Explorer shows "Loading 12 KB of 40 KB" while it streams from a mirror.

## Widgets

Interactive bits are server-side-include comments that Explorer draws, so pages never need scripts:

```html
<!--#include widget="counter" -->
<!--#include widget="guestbook" -->
<!--#include widget="webring" ring="pigeon-ring" -->
```

## Enforcement

`@pigeon/pigeonhtml` holds the allowlists as tables in `src/allowlists.ts` and exposes `sanitize` and `validate` ([0032](decisions/0032-explorer-on-this-computer-first.md)).

- `sanitize(source, urls)` returns `{ html, title, bytes, removed }`: the page with everything off the lists dropped (never escaped and kept), its title, its size in UTF-8 bytes to hold against the 100 KB budget, and what was taken out. `urls` belongs to whoever shows the page. `urls.image(src)` gives the URL to load an image from and `urls.link(href)` the address a link goes to, and either can return nothing, which drops the image or the link (keeping its text).
- `validate(source)` returns the problems, each with the line and column where it starts, and is empty for a valid page.

It parses with parse5, which reads a page as the browser that renders it will. The page builder validates as you type and offers a "Valid PigeonHTML 1.0!" badge. Explorer and the Lighthouse sanitize every page before rendering or mirroring it, pages bundled with Pigeon included. Pages render without a doctype (quirks mode, on purpose) in an iframe with `sandbox="allow-same-origin"` and never `allow-scripts`, written into the frame's blank document rather than given as `srcdoc`, since an `srcdoc` document is always in standards mode, under a CSP that allows inline styles, only the page's own images (each by its exact URL) and the two bundled fonts, and nothing else (`default-src 'none'`). A base stylesheet comes first, so the page's own styles win: it maps the font names above with `@font-face`, sets monospace elements in Courier New, draws images pixelated, and makes `blink` blink (held still under reduced motion). After it comes the stylesheet for Explorer's view: One Column stacks a page's tables to the frame's width, and Text Size zooms it ([0033](decisions/0033-one-column-on-the-pocket.md)). Neither changes the page. Explorer reads link clicks from the frame and navigates itself. It refuses a page whose source is over the budget with its own error page; a bundled page's images aren't counted yet.

Modern engines won't reproduce IE6's exact bugs; quirks mode plus the subset gets the feel, and that is the goal.

### What the sanitizer does

- **Output**: `<html><head>` with the title and the head's `<style>` elements, then `<body>` with its attributes and content (a `<style>` in the body stays where it is). No doctype, no comments. It's written out from the parsed tree, never copied from the source, and every text and attribute value is escaped. The output is then sanitized again until it reads back as itself, because dropping tags can leave markup the parser would rebuild differently. What those passes drop is reported too, and output that hasn't settled after four of them isn't returned. So what's returned parses back to exactly the tree that was checked, and sanitizing it again with URL functions that pass their own outputs through changes nothing.
- **Elements** off the list lose their tags and keep their content, except the ones that hold no page text or read differently in the sandbox: `script`, `iframe`, `frame`, `frameset`, `noframes`, `object`, `embed`, `applet`, `base`, `meta`, `link`, `template`, `noscript`, `noembed`, `textarea`, `xmp`, `plaintext`, `listing`, form controls, media, and all foreign content (`svg`, `math`). Those go with everything inside them. `form` and `button` lose their tags and keep their text. Elements nested more than 256 deep are dropped, so no page can exhaust the stack.
- **Attributes**: `id`, `class`, `title`, `lang`, `dir` and `style` everywhere, plus each element's presentational set. `on*` handlers, `target` and everything else are dropped. `img` has no `name`, because a named image would shadow a property of the frame's `document`, which Explorer reads. A page's `id`s still add names to the frame's `window`, so whoever shows a page reads only its document and the window's own methods, never a global a page could have made.
- **URLs**: only `href` (on `a` and `area`) goes through `urls.link`, and only `src` (on `img`), `background` (on `body`, `table`, `tr`, `td`, `th`) and CSS `url()` go through `urls.image`. No other attribute can hold a URL: `lowsrc`, `dynsrc`, `longdesc`, `cite`, `action` and the rest are dropped. `usemap` may only name a map (`#name`). A second check runs before and after `urls`: a URL whose scheme, read as a browser reads it (ignoring controls, whitespace and case), is `javascript:`, `vbscript:` or another script scheme is always dropped, and `data:` passes only as a GIF, JPEG or PNG image.
- **CSS** is read by a small in-house tokenizer that follows CSS Syntax Level 3, so escapes, comments and strings decode the way the browser decodes them before anything is checked. Declarations keep CSS 2.1's visual properties (the aural ones are dropped), CSS 2.1's units, and the functions `rgb`, `rect`, `counter`, `counters`, `attr` and `url`. `display` and `position` keep only CSS 2.1's keywords, and `position` never `fixed`, which would let a page pin a layer over the whole frame and catch every click. `z-index` is `auto`, `inherit` or a whole number from -100 to 100. `url()` is allowed only in the background, list-style and content properties; not in `cursor`, since a cursor image can paint past the frame's edge. Two words or numbers that only a comment kept apart (`100/**/vw`) drop their declaration, since written side by side they'd read back as one. Rules keep CSS 2.1 selectors (one-colon pseudo-classes, `[attr]`, `=`, `~=` and `|=`), and `@media` only for `screen`, `print` and `all`. Every other at-rule (`@import`, `@font-face`, `@charset`, `@page`, ...) is dropped. The CSS is written back out from the tokens, so it never holds an escape outside a string or a `<`, and can't close its `<style>`. Names that only an escape could make are dropped.
- **Title**: the first `<title>`, as text with whitespace collapsed, or undefined. Later ones are dropped.
- **Removed** entries name the element, attribute, CSS property or URL. A comment is `#comment`, a dropped at-rule is its name (`@import`), and a rule whose selector isn't CSS 2.1 is `selector`.

`validate` reports what `sanitize` would take out, at the element, attribute or CSS token where it starts (what only the settling passes find is reported at line 1), and a page over the budget. It doesn't report comments, since widgets are comments, or URLs, which only the page's host can judge, except those the second check always drops.

### Limits

- **The budget comes first.** A page over 100 KB isn't parsed: `sanitize` returns an empty page and `removed` says `#document`, and `validate` says only that it's over the budget.
- **At most 50,000 elements and comments per parse.** Tags left open make the parser rebuild open formatting elements again and again, so a page well under the budget could build millions of them and hang or crash the tab. Past the limit the parse stops, `sanitize` returns an empty page with `#document` removed, and `validate` says the page builds too many elements.
- `validate` finds each problem's line from offsets worked out once per text node, so a long stylesheet costs time in proportion to its length.

### Deferred

- **Framesets** are dropped with their frames and `noframes`, since each frame is another page to load and sandbox. They can come with M5's hosting.
- **Forms** lose their tags and controls. Guestbooks and the like are widgets.
- **Widgets**: the sanitizer drops every comment, widget ones included. Drawing them is M5's.
