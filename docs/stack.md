# Stack

Tools, libraries and versions, and why each one is here.

## Toolchain

- **mise** pins Node 24, pnpm and lefthook, and holds the tasks (`setup`, `dev`, `check`, `build`, `test`). `mise run check` is the one gate; CI runs it too.
- **pnpm** workspaces (`apps/*`, `packages/*`) with exact versions (`savePrefix: ""`).
- **TypeScript** strict, from `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noPropertyAccessFromIndexSignature`.
- **Biome**: format and lint. Two spaces, width 100, single quotes, no semicolons, no `any`, no `!`.
- **lefthook**: Biome on pre-commit; the Conventional Commit and no-AI-attribution check on commit-msg (`scripts/check-commit-msg.ts`, also run on PR titles in CI); agent-base's `scripts/check-docs` on pre-push.
- **CSS Modules**: Vite's built-in support. `scripts/css-module-types.mjs` writes each module's exact class names as a git-ignored declaration before `typecheck`, `dev` and `build` ([0010](decisions/0010-component-folders-and-css-modules.md)).
- **Vendoring**: `scripts/vendor.mjs` copies fonts, icons and wallpapers from pinned, sha512-checked sources (`mise run fonts:vendor`, `icons:vendor`, `wallpapers:vendor`); see [vendor/VENDOR.md](../vendor/VENDOR.md).

## Libraries

| Library                                     | Where                         | Why                                                                                                                                                                                                  |
| ------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| solid-js                                    | apps/web                      | UI, as in the author's other web projects                                                                                                                                                            |
| vite, vite-plugin-solid                     | apps/web                      | dev server and static build                                                                                                                                                                          |
| vitest, happy-dom, @solidjs/testing-library | tests                         | unit and component tests                                                                                                                                                                             |
| @playwright/test                            | apps/web e2e                  | multi-context end-to-end tests: two people pairing and chatting over the real relays                                                                                                                 |
| trystero                                    | apps/web platform, lighthouse | signaling over Nostr + WebRTC data channels, behind the `Transport` interface ([0002](decisions/0002-trystero-behind-a-transport-interface.md)); its own identities are off, Pigeon signs everything |
| wrangler                                    | apps/web deploy               | deploys `apps/web/dist` to Cloudflare Workers static assets, as tomszir.com does; its esbuild and workerd install scripts are allowed in `pnpm-workspace.yaml`                                       |
| uqr                                         | apps/web messenger            | encodes invite links as QR codes (no dependencies, MIT); Pigeon draws the modules itself as whole-pixel SVG squares                                                                                  |

No Yjs ([0003](decisions/0003-signed-append-only-logs-not-yjs.md)), no CSS framework, no router, no state library. WebCrypto and IndexedDB are used directly. Adding any library is asked first (AGENTS.md).

## Hosting

Static build deployed to Cloudflare Workers static assets at `pigeon.tomszir.com` ([0005](decisions/0005-cloudflare-at-pigeon-tomszir-com.md)) by Workers Builds, Cloudflare's Git integration, on every push to `main` ([0017](decisions/0017-deploy-from-cloudflare-workers-builds.md)). The `pigeon` Worker's build settings in the dashboard:

| Setting        | Value                                          |
| -------------- | ---------------------------------------------- |
| Git repository | `tomszir/pigeon`, production branch `main`     |
| Root directory | `apps/web`                                     |
| Build command  | `pnpm install --frozen-lockfile && pnpm build` |
| Deploy command | `pnpm exec wrangler deploy`                    |
| Variables      | `NODE_VERSION` = `24`                          |

`apps/web/wrangler.jsonc` is the Worker: static assets from `dist`, no Worker code, and the custom domain route. `mise run deploy` does the same from the author's machine. Merging to main, and so deploying, is the author's call, never an agent's. WebRTC and WebCrypto need a secure page, which the HTTPS site and `localhost` both are.
