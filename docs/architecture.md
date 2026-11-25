# Architecture

The pnpm monorepo, its layers, and the import rules Biome enforces.

## Layout

```
packages/
  core/         @pigeon/core: pure TypeScript, no browser or Node APIs. One folder
                per feature under src/, each holding its files and their tests:
      encoding/   UTF-8, base32, hex and canonical JSON.
      identity/   PeerId, fingerprints, the old pair-room name (now the chat's id),
                  and the Crypto and Signer interfaces the platform implements.
      transport/  the Transport and Room interfaces (decision 0002); a join can
                  carry a room password and ask for relay-only connections.
      messages/   signed envelopes: body types, shape checks, the 64 KB limit.
      chat/       signed append-only chat logs and the pair session that syncs them,
                  across however many pair rooms the friend is in.
      pairing/    invite codes and links, the invite handshake, pair rooms named
                  from the pair secret and the UTC day (decision 0026), and linking
                  a new device (link.ts, decision 0024).
      devices/    the signed device log that ties several devices to one identity
                  (decision 0024).
      windows/    window-manager state.
      result/     the Result type.
      testing/    fakes for tests everywhere: fakeCrypto, fakeSigner and an
                  in-memory network. Never used outside tests.
                Letter rules and pigeon:// resolution arrive as their own folders.
  pigeonhtml/   @pigeon/pigeonhtml: the PigeonHTML allowlists, sanitizer and validator.
                Pure; used by the web app and the Lighthouse.
apps/
  web/          The site (Vite + Solid), served by a Cloudflare Worker.
    worker/     The Worker: static assets, and /api/turn, which hands out short-lived
                TURN credentials (decision 0022). Holds no user data.
    src/
      platform/ The only code that touches browser APIs, one folder per concern:
                crypto/ (WebCrypto keys behind core's Crypto and Signer), storage/
                (a key-value Store over IndexedDB, plus a memory one), transport/
                (Trystero, with TURN servers from /api/turn), clock/, clipboard/, tab-lock/ (one tab at a time, with Web
                Locks and a BroadcastChannel; decision 0028). Each is an interface plus a
                browser implementation; audio and files come later.
      ui/       The Pigeon UI kit (Window, Button, Menu, ...), one folder per component,
                and tokens.css, the only global stylesheet.
      shell/    Stage and scaling, desktop, taskbar, Pigeon menu, tray and balloons,
                the window layer and the phone layout (shell/phone-shell/, the
                Kestrel Pocket; Today itself comes from apps/messenger/today/).
                createShell() returns the
                ShellApi that app/ hands to programs.
      apps/     One folder per app (messenger, reader, explorer, builder, letters, files), each
                holding one folder per component: apps/<app>/<component>/. The
                Messenger's state lives in messenger/service/: it loads friends and
                chats from the Store, runs a core pair session per friend, hosts and
                answers invites, and exposes Solid state the windows draw;
                service/devices.ts keeps your device log and friends', and says who
                a device is. messenger/devices/ draws Link a Device, Link to My
                Other Device and My Devices. reader/ is
                Pigeon Reader with the texts it opens: readme/ and changelog/
                (Changelog.txt, the release notes, decision 0025).
      app/      The composition root: builds platform implementations, creates the
                shell, and wires the desktop, menu and windows to the apps
                (app/programs.tsx). start-messenger.ts makes or loads the identity
                and builds the Messenger; address-invite.ts reads an invite link
                from the address bar once and removes it; whats-new.ts decides
                whether this visit says Pigeon was updated.
  lighthouse/   The always-on Node peer: holds sealed mail, carries letters, mirrors pages.
                Reuses @pigeon/core with Node implementations of the platform interfaces.
```

## Import rules

| Layer          | May import                                                          |
| -------------- | ------------------------------------------------------------------- |
| `packages/*`   | each other, nothing from `apps/`, no `solid-js`                     |
| `platform/`    | `packages/*`                                                        |
| `ui/`          | `solid-js`, `packages/*`; not `platform/`, `shell/`, `apps/`        |
| `shell/`       | `ui/`, `packages/*`, platform interfaces                            |
| `apps/<name>/` | itself, `ui/`, `packages/*`, platform interfaces; never another app |
| `app/`         | everything                                                          |

Biome's `noRestrictedImports` overrides in `biome.json` enforce every row. An app importing a sibling (`../other-app/...`) is caught by pattern, so apps keep their files flat. A platform interface is passed in from `app/`, never imported as an implementation, so tests can stand a fake in.

## Shell and windows

The window-manager state (open windows, bounds, z-order, focus, minimise and maximise) lives in `@pigeon/core` as pure functions (`windows/window-manager.ts`). The shell keeps one `Desktop` value in a Solid signal and replaces it through those functions. `ui/window.tsx` draws a frame at the bounds it is given and reports drags, clicks and keys; it never moves itself. Windows stay in opening order in the DOM and stack by `z-index`, so raising a window never re-parents it mid-drag.

The shell reads the browser only through `ShellEnv` (viewport, reduced motion, clock, outside links), which `app/browser-env.ts` builds, so shell tests can pass fakes.

## Patterns

- Functions over classes. Errors as values (`{ ok: true, value } | { ok: false, error }`); `throw` only for bugs.
- The caller passes time and randomness in; `core` has no module-level state.
- Content and numbers live in tables, not branches.
- Kebab-case files, PascalCase components, no barrel files except each package's `index.ts`.
- Folders by feature, never one flat directory: in a package, `src/<feature>/` ([0015](decisions/0015-feature-folders-everywhere.md)); in the web app, the layer folders above and one folder per component.
- In the web app every component is a folder named after it: `window/window.tsx`, `window/window.module.css`, `window/window.test.tsx`, plus any helper only it uses ([0010](decisions/0010-component-folders-and-css-modules.md)). Styles are CSS Modules with camelCase classes, typed by `scripts/css-module-types.mjs`; join them with `ui/classes/classes.ts`. Reach an element from outside its component by a `data-` attribute, not a class.
- Tests sit beside the file they test (`name.test.ts`) and go at the lowest level that fails for the reason they guard. Playwright e2e lives in `apps/web/e2e/`.
