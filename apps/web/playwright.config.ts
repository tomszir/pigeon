// End-to-end tests: real browsers, real Trystero over public Nostr relays (docs/README.md).
import { defineConfig, devices } from '@playwright/test'
import { e2ePort } from './ports.ts'

/** This checkout's own (ports.ts), so reusing a running server only ever reuses ours. */
const PORT = e2ePort

export default defineConfig({
  testDir: 'e2e',
  // Relays and ICE take their time; a pairing over the internet can need tens of seconds.
  timeout: 180_000,
  expect: { timeout: 60_000 },
  retries: process.env['CI'] === undefined ? 0 : 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    // Builds packages/crypto-wasm first: the dev server serves its WebAssembly from pkg/.
    command: `pnpm --filter @pigeon/crypto-wasm build && pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: process.env['CI'] === undefined,
  },
})
