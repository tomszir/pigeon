// `version.json`, the file a running Pigeon fetches to learn whether a newer one has been
// deployed (src/app/update-check.ts). It holds the same version as `__PIGEON_VERSION__` and
// nothing else, so it says nothing about who asks for it.
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

/** The version in the root package.json, which release-please keeps. Read fresh on each call. */
export const readVersion = (): string =>
  (
    JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      version: string
    }
  ).version

/** The file's text: `{"version":"0.8.2"}`. */
export const versionJson = (version: string): string => `${JSON.stringify({ version })}\n`

/**
 * Writes `version.json` next to the bundle when building, and serves it from the dev and preview
 * servers' root. The dev server reads package.json on each request, so changing the version there
 * and focusing a tab shows the update balloon without restarting the server.
 */
export function versionFile(): Plugin {
  return {
    name: 'pigeon-version-file',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: versionJson(readVersion()),
      })
    },
    configureServer(server) {
      server.middlewares.use('/version.json', (_request, response) => {
        response.setHeader('Content-Type', 'application/json')
        response.setHeader('Cache-Control', 'no-store')
        response.end(versionJson(readVersion()))
      })
    },
  }
}
