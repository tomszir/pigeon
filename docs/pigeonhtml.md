# PigeonHTML

The 2000s-only subset of HTML and CSS that Pigeonweb pages may use, and how it is enforced.

## Why

Pages should look like they were made in 2003, because in Pigeon's world they were. Limiting the language does that better than any filter, and it also makes pages safe to render: no scripts, no network, nothing modern to abuse.

## The subset

- **HTML**: HTML 4.01 Transitional elements, including `font`, `center`, `marquee`, `blink` (rendered by Explorer), tables, framesets and image maps. No `script`, `iframe`, `object`, `embed`, `canvas`, `svg`, `video`, `audio`, `form` posting anywhere, or any HTML5 element.
- **Attributes**: the HTML 4.01 presentational set (`bgcolor`, `background`, `text`, `link`, `vlink`, `align`, `valign`, `border`, `cellpadding`, `cellspacing`, `width`, `height`, `color`, `face`, `size`, ...), plus `href`, `src`, `alt`, `title`. No `on*` handlers, `style` limited to the CSS below.
- **CSS**: CSS 2.1 properties only. No flexbox, grid, `border-radius`, `box-shadow`, gradients, transforms, transitions, `var()`, `calc()`, `@font-face`, `@import` or media queries beyond `screen`/`print`.
- **Fonts**: the web-safe families of the era, each mapped to a bundled free clone. Anything else falls back to the default.
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

`@pigeon/pigeonhtml` holds the allowlists as tables and exposes `sanitize` and `validate`. The page builder validates as you type and offers a "Valid PigeonHTML 1.0!" badge; Explorer and the Lighthouse sanitize every snapshot before rendering or mirroring it. Pages render without a doctype (quirks mode, on purpose) inside a sandboxed iframe with no scripts and a CSP that allows only the page's own images.

Modern engines won't reproduce IE6's exact bugs; quirks mode plus the subset gets the feel, and that is the goal.
