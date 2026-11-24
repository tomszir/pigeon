// Builds the Messenger from the browser's platform: the stored identity (made on first visit),
// the Store main.tsx opened, WebCrypto and Trystero.
import {
  createMessenger,
  type Messenger,
  type MessengerEvents,
} from '../apps/messenger/service/service.ts'
import { browserClock } from '../platform/clock/browser-clock.ts'
import {
  createBrowserCrypto,
  generateIdentity,
  isStoredIdentity,
  randomBytes,
  signerFor,
} from '../platform/crypto/browser-crypto.ts'
import type { Store } from '../platform/storage/storage.ts'
import { createBrowserTransport } from '../platform/transport/browser-transport.ts'

export const IDENTITY = 'identity'

export type StartResult =
  | { readonly ok: true; readonly messenger: Messenger; readonly persistent: boolean }
  | { readonly ok: false; readonly problem: string }

export async function startMessenger(
  events: MessengerEvents,
  { store, persistent }: { readonly store: Store; readonly persistent: boolean },
): Promise<StartResult> {
  if (globalThis.crypto?.subtle === undefined || typeof RTCPeerConnection === 'undefined')
    return {
      ok: false,
      problem: 'This browser can’t run Pigeon: it needs WebCrypto and WebRTC on a secure page.',
    }
  let identity = await store.get(IDENTITY)
  if (!isStoredIdentity(identity)) {
    identity = await generateIdentity()
    await store.set(IDENTITY, identity)
  }
  const messenger = await createMessenger({
    crypto: createBrowserCrypto(),
    signer: signerFor(identity as Parameters<typeof signerFor>[0]),
    store,
    transport: createBrowserTransport(),
    clock: browserClock,
    random: randomBytes,
    inviteBase: `${location.origin}${location.pathname}`,
    events,
  })
  return { ok: true, messenger, persistent }
}
