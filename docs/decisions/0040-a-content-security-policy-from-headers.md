# 0040: A Content Security Policy, sent as headers in production and in development

The site is served with a Content Security Policy and the usual safety headers from one `_headers` file, which Cloudflare applies in production and Vite's dev and preview servers apply too.

- Status: accepted
- Date: 2026-11-25

## Context

Pigeon keeps every key in IndexedDB on the site's origin, and Explorer renders other people's pages in a frame that shares that origin (`sandbox="allow-same-origin"`, written into `about:blank`), so Explorer can write the page and read its clicks. The PigeonHTML sanitizer was the only thing between a page and those keys: one sanitizer bug that let a script through would have reached them. The site sent no Content Security Policy, no frame protection, no `nosniff` and no referrer policy (GitHub issue #89).

What the app loads: one bundled module script and stylesheet (Vite emits no inline script; its module preload helper is in the bundle), same-origin images and fonts, `data:` images (avatars are `data:image/svg+xml`, small icons are inlined into the stylesheet, the CRT filter's displacement map is a canvas `data:` PNG), `fetch('/api/turn')`, and WebSockets to public Nostr relays and to Lighthouses at any `wss://` host or at `ws://` on this computer. No workers, no service worker, no wasm, no eval, no media. Downloads are `blob:` links, which a policy doesn't govern; neither does WebRTC.

A frame's `about:blank` document inherits its parent's policy, so the app's policy also covers every Explorer page, on top of the frame's own meta policy. Pages are inline `<style>` and style attributes.

## Decision

- `apps/web/public/_headers` holds, for `/*`: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss: ws:; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`, plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`. Vite copies it into `dist`; Cloudflare's static assets read it and don't serve it.
- `style-src` allows inline styles because Explorer's pages need them under the inherited policy. With scripts limited to the site's own bundle, an injected style can change how something looks but can't run anything.
- `connect-src` allows the `ws:` scheme rather than naming `localhost`, `127.0.0.1` and `[::1]`, because Chromium rejects an IPv6 literal as a policy source, and a Lighthouse at `ws://[::1]` is a valid address. An https page can't open `ws://` to any other host anyway, since browsers block that as mixed content. `upgrade-insecure-requests` is left out: it would rewrite those addresses to `wss://`.
- `Referrer-Policy: no-referrer`: Pigeon has no use for telling the sites it links to where a click came from. Invite secrets sit after the `#`, which a referrer never carries anyway.
- The `/api/turn` route, which Cloudflare's `_headers` doesn't reach because the Worker answers it, sends `nosniff`, `no-referrer` and a policy that loads nothing.
- Vite's dev and preview servers read the same file and send its `/*` headers, so development and the end-to-end tests run under the production policy. HMR keeps working: its socket is same-origin and its styles are inline. A unit test pins the directives that must not loosen, and the end-to-end tests fail on any message about a refused load.

## Consequences

A sanitizer bug that let a `<script>` or an `on*` attribute into a page no longer runs it: the frame inherits `script-src 'self'`, which allows no inline script. Nobody can frame Pigeon to trick clicks out of it.

Anything new that loads from somewhere else (a font CDN, an image host, an analytics script, a worker, wasm) fails in development at once and has to change `_headers` deliberately. A peer page whose images come from `blob:` URLs would need `blob:` added to `img-src`.

`style-src 'unsafe-inline'` stays as long as pages are rendered in a same-origin `about:blank` frame. Rendering them from another origin would let the app's own policy drop it, at the cost of Explorer no longer reading the frame directly.
