/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { devPort } from './ports.ts'
import { siteHeaders } from './site-headers.ts'
import { readVersion, versionFile } from './version-file.ts'

/** The version release-please keeps in the root package.json. */
const version = readVersion()
/** The commit Cloudflare Workers Builds is building, when it is; empty locally. */
const commit = (process.env['WORKERS_CI_COMMIT_SHA'] ?? '').slice(0, 7)
/**
 * Where the dev server gets TURN credentials: the live site's /api/turn, so a
 * phone on mobile data can reach a dev tab. PIGEON_TURN_FROM=off leaves dev on STUN alone.
 */
const turnFrom = process.env['PIGEON_TURN_FROM'] ?? 'https://pigeon.tomszir.com'

/**
 * Pages written as typed string JSX (`*.pigeon.tsx`, and their tests) are not Solid components:
 * their `@jsxImportSource @pigeon/pigeonhtml` makes elements call the PigeonHTML runtime, which
 * builds text. Solid's plugin would compile them to DOM code instead.
 */
const PIGEON_PAGES = /\.pigeon\.(test\.)?tsx$/

export default defineConfig({
  plugins: [solid({ exclude: PIGEON_PAGES }), versionFile()],
  // Vite follows tsconfig's `jsx: preserve` (Solid's), which would leave a PigeonHTML page's JSX
  // in place. Whatever Solid doesn't compile is lowered here instead, to the automatic runtime of
  // the page's own `@jsxImportSource`.
  oxc: { jsx: { runtime: 'automatic' } },
  build: { target: 'es2023' },
  // A port of this checkout's own (ports.ts). Strict, so a clash fails loudly instead of moving
  // to another origin, which would be a different dev identity.
  server: {
    port: devPort,
    strictPort: true,
    // The production headers (public/_headers) in development too, its Content Security Policy
    // included, so nothing that only works without it gets far.
    headers: siteHeaders(),
    proxy:
      turnFrom === 'off'
        ? {}
        : { '/api/turn': { target: turnFrom, changeOrigin: true, secure: true } },
  },
  preview: { headers: siteHeaders() },
  define: {
    __PIGEON_VERSION__: JSON.stringify(version),
    __PIGEON_COMMIT__: JSON.stringify(commit),
  },
  test: {
    environment: 'happy-dom',
    include: [
      'src/**/*.test.{ts,tsx}',
      'worker/**/*.test.ts',
      'site-headers.test.ts',
      'version-file.test.ts',
    ],
    setupFiles: ['src/test-setup.ts'],
  },
})
