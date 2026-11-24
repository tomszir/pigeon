/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { devPort } from './ports.ts'

/** The version release-please keeps in the root package.json (decision 0021). */
const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string }
/** The commit Cloudflare Workers Builds is building, when it is; empty locally. */
const commit = (process.env['WORKERS_CI_COMMIT_SHA'] ?? '').slice(0, 7)
/**
 * Where the dev server gets TURN credentials (decision 0022): the live site's /api/turn, so a
 * phone on mobile data can reach a dev tab. PIGEON_TURN_FROM=off leaves dev on STUN alone.
 */
const turnFrom = process.env['PIGEON_TURN_FROM'] ?? 'https://pigeon.tomszir.com'

export default defineConfig({
  plugins: [solid()],
  build: { target: 'es2023' },
  // A port of this checkout's own (ports.ts). Strict, so a clash fails loudly instead of moving
  // to another origin, which would be a different dev identity.
  server: {
    port: devPort,
    strictPort: true,
    proxy:
      turnFrom === 'off'
        ? {}
        : { '/api/turn': { target: turnFrom, changeOrigin: true, secure: true } },
  },
  define: {
    __PIGEON_VERSION__: JSON.stringify(version),
    __PIGEON_COMMIT__: JSON.stringify(commit),
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}', 'worker/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
  },
})
