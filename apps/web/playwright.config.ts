// End-to-end tests: real browsers, real Trystero over public Nostr relays (docs/README.md).
import { defineConfig, devices } from '@playwright/test'

const PORT = 5199

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
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: process.env['CI'] === undefined,
  },
})
