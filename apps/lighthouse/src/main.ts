// A Pigeon Lighthouse: node src/main.ts --config lighthouse.json
// Holds sealed mail for anyone who uses it, says its address on start, and sweeps out expired
// mail every hour.
import { readFileSync } from 'node:fs'
import { formatLighthouseAddress } from '@pigeon/core'
import { createLighthouse } from '@pigeon/lighthouse'
import { readConfig } from './config/config.ts'
import { createNodeCrypto, loadSigner } from './platform/node-crypto.ts'
import { startServer } from './server/server.ts'
import { createSqliteStore } from './store/sqlite-store.ts'

const HOUR = 60 * 60 * 1000
/** Pigeon's version, which the Lighthouse is released with; the image's commit, when built. */
const VERSION = (
  JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version
const BUILD = process.env['PIGEON_BUILD']

const at = process.argv.indexOf('--config')
const config = await readConfig(at < 0 ? 'lighthouse.json' : (process.argv[at + 1] ?? ''))
const signer = await loadSigner(config.keyFile)
const store = createSqliteStore(config.database)
const lighthouse = createLighthouse({
  signer,
  crypto: createNodeCrypto(),
  store,
  now: Date.now,
  name: config.name,
  // The Lighthouse's own claim: nothing relies on it, but it says which build this is.
  software: {
    name: 'pigeon-lighthouse',
    version: VERSION,
    ...(BUILD === undefined || BUILD === '' ? {} : { build: BUILD }),
  },
  pass: config.pass,
  limits: config.limits,
})
const address = formatLighthouseAddress({
  id: signer.id,
  name: config.name,
  url: config.url,
  ...(config.pass === undefined ? {} : { pass: config.pass }),
})
const server = await startServer({
  lighthouse,
  host: config.host,
  port: config.port,
  trustForwardedFor: config.trustForwardedFor,
  address,
})
console.log(`${config.name} is listening on ${config.host}:${server.port}.\n${address}`)

await lighthouse.sweep()
const sweeping = setInterval(() => void lighthouse.sweep(), HOUR)
const stop = () => {
  clearInterval(sweeping)
  void server.close().then(() => {
    store.close()
    process.exit(0)
  })
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
