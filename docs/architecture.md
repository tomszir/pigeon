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
      transport/  the Transport and Room interfaces, so the network library can be
                  swapped; a join can carry a room password and ask for relay-only connections.
      messages/   signed envelopes: body types, shape checks, the 64 KB limit.
      chat/       signed append-only chat logs and the pair session that syncs them,
                  across however many pair rooms the friend is in.
      pairing/    invite codes and links, the invite handshake, pair rooms named
                  from the pair secret and the UTC day, and linking a new device
                  (link.ts).
      devices/    the signed device log that ties several devices to one identity.
      pake/       Pake, the interface to a password-authenticated key exchange
                  (SPAKE2 in the browser): a one-use start whose finish gives a
                  32-byte key, or undefined for a malformed message, or which is
                  abandoned.
      mail/       mail sealed to devices: mail tags from the pair or self secret and
                  the UTC date, sealing keys bound to their devices, sealMail and
                  openMail, and SealCrypto and Sealer, the HPKE, ECDH, HKDF and AES-GCM
                  the platform implements (HPKE with @hpke/core).
      lighthouse/ what a Pigeon and a Lighthouse say: plain requests,
                  replies signed by the Lighthouse over the request number, blob ids
                  from their content, pigeon://lighthouse addresses, and client.ts, a
                  Pigeon's side of one Lighthouse over a socket the platform opens: a
                  fresh nonce per connection, one checked reply per request.
      windows/    window-manager state.
      back/       the back stack: what the browser's Back closes next, kept in step
                  with the browser's history through a small port.
      result/     the Result type.
      testing/    fakes for tests everywhere: fakeCrypto, fakeSigner, fakePake and
                  an in-memory network. Never used outside tests.
  lighthouse/   @pigeon/lighthouse: a Lighthouse's mailbox with no platform in it.
                lighthouse/ answers each connection's request frames
                with signed replies; store/ is the MailStore interface, a memory store,
                and store-contract.ts, the tests every store runs (exported as
                @pigeon/lighthouse/testing), and sql-store.ts, the MailStore over a
                one-call SqlDatabase that both runners hand their SQLite in as; limits/
                counts puts per IPv4 address or IPv6 /64, in memory only.
  crypto-wasm/  @pigeon/crypto-wasm: protocols from maintained Rust libraries, built
                to WebAssembly. crate/ is the Rust crate (pigeon-crypto): pake.rs is
                SPAKE2 from RustCrypto's spake2, alloc.rs the global allocator that wipes
                every block it frees, lib.rs scrubStack, which wipes the stack after a
                call, and tests/ the crate's tests and spake2's known-answer vectors.
                wasm-pack builds it into pkg/ (git-ignored). src/ is the TypeScript
                side: spake2/ is core's Pake over the module, which it imports and
                instantiates on the first start. Only short-lived secrets go in;
                long-lived keys stay in WebCrypto.
  pigeonhtml/   @pigeon/pigeonhtml: the PigeonHTML allowlists, sanitizer and validator.
                Pure; used by the web app and the Lighthouse. allowlists.ts holds the
                tables, sanitize.ts walks parse5's tree, css.ts is the CSS tokenizer and
                allowlist, urls.ts the scheme check, and testing/ the tests' re-parse
                audit and URL functions (docs/pigeonhtml.md).
apps/
  web/          The site (Vite + Solid), served by a Cloudflare Worker.
    worker/     The Worker: static assets, and /api/turn, which hands out short-lived
                TURN credentials. Holds no user data.
    src/
      platform/ The only code that touches browser APIs, one folder per concern:
                crypto/ (WebCrypto keys behind core's Crypto and Signer, a device's
                sealing key and core's SealCrypto, sealing with a passphrase, and
                createWasmPake, core's Pake from packages/crypto-wasm), files/
                (saving and opening text files), storage/
                (a key-value Store over IndexedDB, plus a memory one), transport/
                (Trystero, with TURN servers from /api/turn), clock/, clipboard/,
                lighthouse/ (the WebSocket core's Lighthouse client talks over),
                tab-lock/ (one tab at a time, with Web Locks and a BroadcastChannel)
                and back/ (core's back stack over `history`). Each is an interface
                plus a browser implementation.
      ui/       The Pigeon UI kit (Window, Button, Menu, ...), one folder per component,
                and tokens.css, the only global stylesheet. back/ is the context that
                hands the back stack to whatever Back can close.
      shell/    Stage and scaling, desktop, taskbar, Pigeon menu, tray and balloons,
                the window layer and the phone layout (shell/phone-shell/, the
                Kestrel Pocket; Today itself comes from apps/messenger/today/).
                createShell() returns the ShellApi that app/ hands to programs.
      apps/     One folder per app (messenger, network, reader, explorer, help, about),
                each holding one folder per component: apps/<app>/<component>/. The
                Messenger's state lives in messenger/service/: it loads friends and
                chats from the Store, runs a core pair session per friend, hosts and
                answers invites, and exposes Solid state the windows draw;
                service/devices.ts keeps your device log and friends', and says who
                a device is. service/mailbox.ts is mail through Lighthouses: an outbox
                put again until each device's receipt comes, and fetching from a
                cursor, taking each letter once. messenger/devices/ draws Link a Device, Link to My
                Other Device and My Devices. network/ is Network, the Lighthouses and the relay setting. reader/ is
                Pigeon Reader with the texts it opens: readme/ and changelog/
                (Changelog.txt, the release notes). explorer/ is
                Pigeon Explorer: explorer/ (the window, history.ts
                and address.ts for pigeon:// addresses), address-bar/, page-frame/
                (the sandboxed frame, its CSP and base stylesheet), error-page/
                ("page not hosted" and "too big"), and local-pages/, the pages
                bundled with Pigeon as maps from address to page, looked up in
                order. Bundled pages are PigeonHTML in .html files, which Biome
                leaves alone since they're written for 2003. help/ is
                in-world Help, the PigeonHTML pages Explorer serves at
                pigeon://help, with no window of its own:
                help-pages/ exports HELP_PAGES, every page by address, which app/
                hands to Explorer after the start page, and Help in the Pigeon
                menu opens; how-pigeon-works/ is the hand-written guide;
                protocol-spec/ builds "The Pigeon Protocol" from docs/protocol.md,
                flows.md and glossary.md, imported with ?raw, so it can't drift;
                markdown/ is the small converter it uses, and page/ the parts
                every page shares.
      app/      The composition root: builds platform implementations, creates the
                shell, and wires the desktop, menu and windows to the apps
                (app/programs.tsx). start-messenger.ts makes or loads the identity and this device's sealing key
                and builds the Messenger; address-invite.ts reads an invite link
                from the address bar once and removes it; official-lighthouses.ts lists the Lighthouses a new Pigeon
                leaves its mail at; whats-new.ts decides
                whether this visit says Pigeon was updated.
  lighthouse/   The Node Lighthouse (docs/lighthouse.md): @pigeon/lighthouse
                run from one config file. config/ reads and checks it; platform/ is core's
                Crypto and the Lighthouse's key file over Node's WebCrypto; store/ the
                MailStore in SQLite (node:sqlite); server/ the WebSocket server (ws), one
                connection per client, each frame one request. main.ts starts it.
                Dockerfile builds it from the repository root.
  lighthouse-worker/
                The Worker Lighthouse (docs/lighthouse.md): index.ts sends
                every request, with the client's address, to the one Durable Object;
                object/ is that Durable Object, the mailbox on its SQLite with hibernating
                WebSockets and an hourly sweep; platform/ is core's Crypto on the Workers
                runtime and the few runtime types it uses, written out; scripts/make-key.ts
                makes its key.
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
- Folders by feature, never one flat directory: in a package, `src/<feature>/`; in the web app, the layer folders above and one folder per component.
- In the web app every component is a folder named after it: `window/window.tsx`, `window/window.module.css`, `window/window.test.tsx`, plus any helper only it uses. Styles are CSS Modules with camelCase classes, typed by `scripts/css-module-types.mjs`; join them with `ui/classes/classes.ts`. Reach an element from outside its component by a `data-` attribute, not a class.
- Tests sit beside the file they test (`name.test.ts`) and go at the lowest level that fails for the reason they guard. Playwright e2e lives in `apps/web/e2e/`.
- Rules a peer settles alone, where an attacker picks the inputs and their order, also get property tests (`name.property.test.ts`, with fast-check): random histories and copies, merged in random orders, checked against what the rules promise rather than against hand-picked cases. Each run picks new cases; a failure prints the seed and the smallest case fast-check found.
