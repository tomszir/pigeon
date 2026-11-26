# Stack

Tools, libraries and versions, and why each one is here.

## Toolchain

- **mise** pins Node 24, pnpm and lefthook, and the Rust toolchain below, and holds the tasks (`setup`, `dev`, `check`, `build`, `test`). `mise run check` is the one gate; CI runs it too.
- **Rust** (pinned in `mise.toml`, with the `wasm32-unknown-unknown` target, rustfmt and Clippy), **wasm-pack** and the **wasm-bindgen** CLI build `packages/crypto-wasm`, the one Rust crate, to WebAssembly. It holds only protocols taken from maintained Rust libraries, SPAKE2 and Argon2id for now, and only short-lived secrets; long-lived keys stay in WebCrypto. The wasm-bindgen CLI's version must equal the `wasm-bindgen` crate's in `crate/Cargo.toml`, and wasm-pack runs with `--mode no-install --no-opt`, so a build fetches no tools of its own: change both versions together. The app loads the module, as a `.wasm` file in `dist/` beside its glue, the first time a code is exchanged or a passphrase is stretched, once per page. `pnpm --filter @pigeon/crypto-wasm build` writes the module and its glue to the git-ignored `packages/crypto-wasm/pkg/`; the web app's `dev`, `build` and the package's `typecheck` and `test` run it first. Its `lint` script is `cargo fmt --check` and Clippy with warnings as errors, for the host and for WebAssembly, and `mise run check` runs it.
- **pnpm** workspaces (`apps/*`, `packages/*`) with exact versions (`savePrefix: ""`).
- **TypeScript** strict, from `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noPropertyAccessFromIndexSignature`.
- **Biome**: format and lint. Two spaces, width 100, single quotes, no semicolons, no `any`, no `!`.
- **lefthook**: Biome on pre-commit; the Conventional Commit and no-AI-attribution check on commit-msg (`scripts/check-commit-msg.ts`, also run on PR titles in CI); `scripts/check-docs` on pre-push.
- **CSS Modules**: Vite's built-in support. `scripts/css-module-types.mjs` writes each module's exact class names as a git-ignored declaration before `typecheck`, `dev` and `build`.
- **Vendoring**: `scripts/vendor.mjs` copies fonts, icons and wallpapers from pinned, sha512-checked sources (`mise run fonts:vendor`, `icons:vendor`, `wallpapers:vendor`); see [vendor/VENDOR.md](../vendor/VENDOR.md).

## Libraries

| Library                                     | Where                                   | Why                                                                                                                                                                                          |
| ------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| solid-js                                    | apps/web                                | UI components and fine-grained reactive state                                                                                                                                                |
| vite, vite-plugin-solid                     | apps/web                                | dev server and static build                                                                                                                                                                  |
| vitest, happy-dom, @solidjs/testing-library | tests                                   | unit and component tests                                                                                                                                                                     |
| fast-check                                  | packages/core tests                     | property tests: random device-log histories, copies and merge orders checked against the merge rules' invariants (`device-log.property.test.ts`); one dependency (pure-rand), MIT            |
| @playwright/test                            | apps/web e2e                            | multi-context end-to-end tests: two people pairing and chatting over the real relays                                                                                                         |
| trystero                                    | apps/web platform                       | signaling over Nostr + WebRTC data channels, behind the `Transport` interface so it can be replaced; its own identities are off, Pigeon signs everything                                     |
| ws, @types/ws                               | apps/lighthouse                         | the Node Lighthouse's WebSocket server: clients reach Lighthouses over WebSocket only; no dependencies, MIT                                                                                  |
| wrangler                                    | apps/web deploy, apps/lighthouse-worker | deploys `apps/web/dist` to Cloudflare Workers static assets, and the Worker Lighthouse with its Durable Object; its esbuild and workerd install scripts are allowed in `pnpm-workspace.yaml` |
| uqr                                         | apps/web messenger                      | encodes invite links as QR codes (no dependencies, MIT); Pigeon draws the modules itself as whole-pixel SVG squares                                                                          |
| parse5                                      | packages/pigeonhtml                     | parses pages as the browser that renders them will, for the PigeonHTML sanitizer and validator; one dependency (entities), MIT                                                               |
| spake2 (Rust)                               | packages/crypto-wasm                    | SPAKE2 on Ed25519, RustCrypto's, the implementation magic-wormhole.rs uses; its known-answer vectors, shared with python-spake2, run in `cargo test`. MIT or Apache-2.0                      |
| argon2 (Rust)                               | packages/crypto-wasm                    | Argon2id (RFC 9106) from RustCrypto, which stretches the passphrase of a sealed file; checked against OpenSSL's Argon2id in tests. MIT or Apache-2.0                                         |
| wasm-bindgen, getrandom, rand_core (Rust)   | packages/crypto-wasm                    | the JavaScript glue for the crate's exports, and randomness from `crypto.getRandomValues`; already what spake2 depends on, made direct so the WebAssembly build can choose its source        |
| zeroize (Rust)                              | packages/crypto-wasm                    | RustCrypto's wiping, which the crate's allocator runs over every block it frees so secrets don't linger in WebAssembly memory                                                                |

No CRDT library (everything Pigeon shares is append-only, so signed logs are enough), no CSS framework, no router (Back is a small stack over `history`), no state library. WebCrypto and IndexedDB are used directly, and the Node Lighthouse keeps its mail in `node:sqlite`. Adding any library is asked first (AGENTS.md).

## Hosting

Static build deployed to Cloudflare Workers static assets at `pigeon.tomszir.com` by Workers Builds, Cloudflare's Git integration, on each release: release-please moves the `release` branch to the released commit. The `pigeon` Worker's build settings in the dashboard:

| Setting        | Value                                                                    |
| -------------- | ------------------------------------------------------------------------ |
| Git repository | `tomszir/pigeon`, production branch `release`                            |
| Root directory | `apps/web`                                                               |
| Build command  | see below                                                                |
| Deploy command | `pnpm exec wrangler deploy`                                              |
| Variables      | `NODE_VERSION` = `24` (build only)                                       |
| Preview builds | other branches, deploy command `npx wrangler versions upload` (optional) |

The build needs Rust and wasm-pack for `packages/crypto-wasm`, which Cloudflare's build image doesn't have, so the build command installs the repository's mise tools first, mise itself coming from npm at a pinned version. The build image also lists tools of its own for mise, in its home directory and its global config, and some of them can't be installed, so the command has mise read only the repository's `mise.toml`: it stops mise's search for config at the repository's parent folder, and points the global and system config at files that don't exist.

```sh
export MISE_CEILING_PATHS="$(dirname "$(cd ../.. && pwd)")" MISE_GLOBAL_CONFIG_FILE=/nonexistent/mise.toml MISE_SYSTEM_CONFIG_FILE=/nonexistent/mise.toml && npx --yes @jdxcode/mise@2026.11.6 trust ../../mise.toml && npx --yes @jdxcode/mise@2026.11.6 install && npx --yes @jdxcode/mise@2026.11.6 exec -- sh -c 'pnpm install --frozen-lockfile && pnpm build'
```

`apps/web/wrangler.jsonc` is the Worker: static assets from `dist`, the custom domain route, and `worker/`, whose one route, `/api/turn`, hands out 4-hour Cloudflare TURN credentials, tagged per visitor for the analytics, and only to requests carrying Pigeon's own `X-Pigeon-Turn: 1` header (which a page on another site can't add without a CORS preflight the route never answers) and no `Sec-Fetch-Site` other than `same-origin`, so curl and other sites get 403. A script that sends the header gets through; the WAF rate limit and the credentials' short life are the guards that count. It needs the TURN key from Realtime → TURN Server: its id is `TURN_KEY_ID` under `vars` in `wrangler.jsonc` (a dashboard-only variable would be wiped by the next deploy), and its API token is the runtime secret `TURN_KEY_API_TOKEN`, which deploys keep. Build variables don't reach the running Worker, so the token can't go there; if the dashboard refuses to add a secret, `pnpm --filter web exec wrangler secret put TURN_KEY_API_TOKEN` sets it. Without both the route answers 503 and peers use STUN alone. `mise run deploy` does the same by hand, after `wrangler login`. Merging the release PR, and so deploying, is the maintainer's call, never an agent's.

`apps/web/public/_headers` gives every static file its response headers, which Cloudflare reads from `dist` and doesn't serve: a Content Security Policy, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`. The policy loads nothing by default and allows scripts, styles, fonts and the manifest from the site itself, compiling WebAssembly (`'wasm-unsafe-eval'`, for the crypto crate's module, which still allows no JavaScript `eval`), inline styles (Explorer's page frame inherits the policy, and pages are inline styles), images from the site and `data:` (avatars, inlined icons, the CRT's displacement map), and connections to the site, any `wss://` host (Nostr relays and Lighthouses) and `ws:` (a Lighthouse on this computer: browsers block `ws://` to any other host from an https page, and a policy can't name `[::1]`). It forbids plugins, `<base>`, form posts and being framed. The file's comments say why each source is there. `_headers` doesn't reach what the Worker answers, so `/api/turn` sets `nosniff`, `no-referrer` and a policy that loads nothing itself. Vite's dev and preview servers send the same `/*` headers (`apps/web/site-headers.ts`), so development and the end-to-end tests run under the production policy; `site-headers.test.ts` holds the directives that must not loosen. Anything that loads from a new place has to be added to `_headers` first.

The Worker Lighthouse (`apps/lighthouse-worker`, see [lighthouse.md](lighthouse.md#as-a-cloudflare-worker)) is a second Worker, `pigeon-lighthouse`, deployed the same way on each release to `lighthouse.pigeon.tomszir.com`. Its build settings in the dashboard:

| Setting        | Value                                                                 |
| -------------- | --------------------------------------------------------------------- |
| Git repository | `tomszir/pigeon`, production branch `release`                         |
| Root directory | `apps/lighthouse-worker`                                              |
| Build command  | `pnpm install --frozen-lockfile`                                      |
| Deploy command | `pnpm exec wrangler deploy --var PIGEON_BUILD:$WORKERS_CI_COMMIT_SHA` |
| Variables      | `NODE_VERSION` = `24` (build only)                                    |
| Watch paths    | include `*`                                                           |
| Preview builds | off: a preview would share the one Durable Object's mail              |

`PIGEON_BUILD` makes the Lighthouse say in its hello which commit it was built from. Its key is the runtime secret `LIGHTHOUSE_KEY` (Settings, Variables and Secrets), which deploys keep. Keep a copy of it somewhere safe: a secret can't be read back, and a new key is a new Lighthouse that everyone must add again. A WAF rate limit on its hostname is what keeps its limits in force, since the Durable Object's memory, where they're counted, resets when Cloudflare evicts it.

The version lives in the root `package.json` and is shown in About and Read Me, and Changelog.txt's newest section must match it (`__PIGEON_VERSION__`, with the build's commit as `__PIGEON_COMMIT__`). release-please (`release-please-config.json`, `.release-please-manifest.json`) keeps a release PR open on main; the workflow drafts Changelog.txt's section for it on the PR's branch (`scripts/release-notes.ts`); merging it tags `v<version>`, writes the GitHub release, and moves `release`. WebRTC and WebCrypto need a secure page, which the HTTPS site and `localhost` both are.
