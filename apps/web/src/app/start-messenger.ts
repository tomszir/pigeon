// Builds the Messenger from the browser's platform: the stored identity (made on first visit),
// the Store main.tsx opened, WebCrypto and Trystero.
import { createLighthouseClient } from '@pigeon/core'
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
  NoEd25519Error,
  randomBytes,
  signerFor,
} from '../platform/crypto/browser-crypto.ts'
import {
  createWebSealCrypto,
  generateSealingKey,
  isStoredSealingKey,
  type StoredSealingKey,
  sealerFor,
} from '../platform/crypto/seal-crypto.ts'
import { createWasmPake } from '../platform/crypto/wasm-pake.ts'
import { openBrowserSocket } from '../platform/lighthouse/browser-socket.ts'
import { keepStorage } from '../platform/storage/browser-storage.ts'
import type { Store } from '../platform/storage/storage.ts'
import { createBrowserTransport } from '../platform/transport/browser-transport.ts'
import { OFFICIAL_LIGHTHOUSES } from './official-lighthouses.ts'

export const IDENTITY = 'identity'
/** This device's sealing key, made beside its signing key and as unreadable. */
export const SEALING_KEY = 'sealingKey'
/** Set once Pigeon has asked the browser to keep its storage, so it asks only once. */
const ASKED_TO_KEEP = 'askedToKeepStorage'
/** Said where a new identity can't be made. Nothing is stored, so updating the browser is enough. */
export const NO_ED25519 =
  'This browser is too old to make a Pigeon identity: it can’t sign with Ed25519. Update it (Chrome and Edge 137, Firefox 129 and Safari 17 have it) or open Pigeon in another browser.'

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
    try {
      identity = await generateIdentity()
    } catch (error) {
      if (!(error instanceof NoEd25519Error)) throw error
      // Identities made where a browser lacked Ed25519 still work; new ones need it.
      return { ok: false, problem: NO_ED25519 }
    }
    await store.set(IDENTITY, identity)
  }
  let sealing = await store.get(SEALING_KEY)
  if (!isStoredSealingKey(sealing)) {
    sealing = await generateSealingKey()
    await store.set(SEALING_KEY, sealing)
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
    pake: createWasmPake(),
    inviteBase: `${location.origin}${location.pathname}`,
    ...(deviceName === undefined ? {} : { deviceName }),
    events,
    seal: { crypto: createWebSealCrypto(), sealer: sealerFor(sealing as StoredSealingKey) },
    lighthouses: OFFICIAL_LIGHTHOUSES,
    lighthouseClient: (address) =>
      createLighthouseClient({
        address,
        crypto: createBrowserCrypto(),
        open: openBrowserSocket(),
        random: randomBytes,
        sleep: browserClock.sleep,
      }),
  })
  return { ok: true, messenger, persistent }
}
