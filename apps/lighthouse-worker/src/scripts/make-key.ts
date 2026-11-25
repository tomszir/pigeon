// Makes a key for a Worker Lighthouse and prints it, with the address it gives, once:
//   pnpm --filter lighthouse-worker make-key
// Then `wrangler secret put LIGHTHOUSE_KEY` and paste it. Keep a copy somewhere safe: the key is
// the Lighthouse's identity, and a new one is a new Lighthouse friends must add again.
import { formatLighthouseAddress } from '@pigeon/core'
import { signerFromKey } from '../platform/worker-crypto.ts'

const ED25519 = { name: 'Ed25519' } as const
const pair = (await crypto.subtle.generateKey(ED25519, true, ['sign', 'verify'])) as CryptoKeyPair
const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString(
  'base64',
)
const signer = await signerFromKey(pkcs8)
console.log(`LIGHTHOUSE_KEY (secret, keep a copy):\n${pkcs8}\n`)
console.log(
  `Address:\n${formatLighthouseAddress({ id: signer.id, name: 'Loft', url: 'wss://lighthouse.pigeon.tomszir.com/' })}`,
)
