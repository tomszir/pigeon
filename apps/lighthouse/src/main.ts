// A Pigeon Lighthouse (decision 0037): node src/main.ts --config lighthouse.json
// Holds sealed mail for anyone who uses it, says its address on start, and sweeps out expired
// mail every hour.
import { formatLighthouseAddress } from '@pigeon/core'
import { createLighthouse } from '@pigeon/lighthouse'
import { readConfig } from './config/config.ts'
import { createNodeCrypto, loadSigner } from './platform/node-crypto.ts'
import { startServer } from './server/server.ts'
import { createSqliteStore } from './store/sqlite-store.ts'

export const VERSION = '0.1.0'
const HOUR = 60 * 60 * 1000

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
  software: { name: 'pigeon-lighthouse', version: VERSION },
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
