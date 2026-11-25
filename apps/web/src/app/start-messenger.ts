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
import { keepStorage } from '../platform/storage/browser-storage.ts'
import type { Store } from '../platform/storage/storage.ts'
import { createBrowserTransport } from '../platform/transport/browser-transport.ts'

export const IDENTITY = 'identity'
/** Set once Pigeon has asked the browser to keep its storage, so it asks only once. */
const ASKED_TO_KEEP = 'askedToKeepStorage'

export type StartResult =
  | { readonly ok: true; readonly messenger: Messenger; readonly persistent: boolean }
  | { readonly ok: false; readonly problem: string }

export async function startMessenger(
  events: MessengerEvents,
  { store, persistent }: { readonly store: Store; readonly persistent: boolean },
  /** Relay-only is on, but the relay can't be reached. */
  onNoRelay?: () => void,
  /** What My Devices calls this device: "Firefox on Linux". */
  deviceName?: string,
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
  // Asked when the identity is made, and once for identities made before Pigeon asked.
  if (persistent && (await store.get(ASKED_TO_KEEP)) !== true) {
    await store.set(ASKED_TO_KEEP, true)
    void keepStorage()
  }
  const messenger = await createMessenger({
    crypto: createBrowserCrypto(),
    signer: signerFor(identity as Parameters<typeof signerFor>[0]),
    store,
    transport: createBrowserTransport(undefined, onNoRelay),
    clock: browserClock,
    random: randomBytes,
    inviteBase: `${location.origin}${location.pathname}`,
    ...(deviceName === undefined ? {} : { deviceName }),
    events,
  })
  return { ok: true, messenger, persistent }
}
