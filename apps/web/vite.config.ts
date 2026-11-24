/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

/** The version release-please keeps in the root package.json (decision 0021). */
const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string }
/** The commit Cloudflare Workers Builds is building, when it is; empty locally. */
const commit = (process.env['WORKERS_CI_COMMIT_SHA'] ?? '').slice(0, 7)

export default defineConfig({
  plugins: [solid()],
  build: { target: 'es2023' },
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
