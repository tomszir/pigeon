# Stack

Tools, libraries and versions, and why each one is here.

## Toolchain

- **mise** pins Node 24, pnpm and lefthook, and holds the tasks (`setup`, `dev`, `check`, `build`, `test`). `mise run check` is the one gate; CI runs it too.
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
| @playwright/test                            | apps/web e2e                            | multi-context end-to-end tests: two people pairing and chatting over the real relays                                                                                                         |
| trystero                                    | apps/web platform                       | signaling over Nostr + WebRTC data channels, behind the `Transport` interface so it can be replaced; its own identities are off, Pigeon signs everything                                     |
| ws, @types/ws                               | apps/lighthouse                         | the Node Lighthouse's WebSocket server: clients reach Lighthouses over WebSocket only; no dependencies, MIT                                                                                  |
| wrangler                                    | apps/web deploy, apps/lighthouse-worker | deploys `apps/web/dist` to Cloudflare Workers static assets, and the Worker Lighthouse with its Durable Object; its esbuild and workerd install scripts are allowed in `pnpm-workspace.yaml` |
| uqr                                         | apps/web messenger                      | encodes invite links as QR codes (no dependencies, MIT); Pigeon draws the modules itself as whole-pixel SVG squares                                                                          |
| parse5                                      | packages/pigeonhtml                     | parses pages as the browser that renders them will, for the PigeonHTML sanitizer and validator; one dependency (entities), MIT                                                               |

No CRDT library (everything Pigeon shares is append-only, so signed logs are enough), no CSS framework, no router (Back is a small stack over `history`), no state library. WebCrypto and IndexedDB are used directly, and the Node Lighthouse keeps its mail in `node:sqlite`. Adding any library is asked first (AGENTS.md).

## Hosting

Static build deployed to Cloudflare Workers static assets at `pigeon.tomszir.com` by Workers Builds, Cloudflare's Git integration, on each release: release-please moves the `release` branch to the released commit. The `pigeon` Worker's build settings in the dashboard:

| Setting        | Value                                                                    |
| -------------- | ------------------------------------------------------------------------ |
| Git repository | `tomszir/pigeon`, production branch `release`                            |
| Root directory | `apps/web`                                                               |
| Build command  | `pnpm install --frozen-lockfile && pnpm build`                           |
| Deploy command | `pnpm exec wrangler deploy`                                              |
| Variables      | `NODE_VERSION` = `24` (build only)                                       |
| Preview builds | other branches, deploy command `npx wrangler versions upload` (optional) |

`apps/web/wrangler.jsonc` is the Worker: static assets from `dist`, the custom domain route, and `worker/`, whose one route, `/api/turn`, hands out 4-hour Cloudflare TURN credentials, tagged per visitor for the analytics. It needs the TURN key from Realtime → TURN Server: its id is `TURN_KEY_ID` under `vars` in `wrangler.jsonc` (a dashboard-only variable would be wiped by the next deploy), and its API token is the runtime secret `TURN_KEY_API_TOKEN`, which deploys keep. Build variables don't reach the running Worker, so the token can't go there; if the dashboard refuses to add a secret, `pnpm --filter web exec wrangler secret put TURN_KEY_API_TOKEN` sets it. Without both the route answers 503 and peers use STUN alone. `mise run deploy` does the same by hand, after `wrangler login`. Merging the release PR, and so deploying, is the maintainer's call, never an agent's.

`apps/web/public/_headers` gives every static file its response headers, which Cloudflare reads from `dist` and doesn't serve: a Content Security Policy, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`. The policy loads nothing by default and allows scripts, styles, fonts and the manifest from the site itself, inline styles (Explorer's page frame inherits the policy, and pages are inline styles), images from the site and `data:` (avatars, inlined icons, the CRT's displacement map), and connections to the site, any `wss://` host (Nostr relays and Lighthouses) and `ws:` (a Lighthouse on this computer: browsers block `ws://` to any other host from an https page, and a policy can't name `[::1]`). It forbids plugins, `<base>`, form posts and being framed. The file's comments say why each source is there. `_headers` doesn't reach what the Worker answers, so `/api/turn` sets `nosniff`, `no-referrer` and a policy that loads nothing itself. Vite's dev and preview servers send the same `/*` headers (`apps/web/site-headers.ts`), so development and the end-to-end tests run under the production policy; `site-headers.test.ts` holds the directives that must not loosen. Anything that loads from a new place has to be added to `_headers` first.

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
