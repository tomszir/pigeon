// Linking a new device to an identity, in person. The existing device waits in
// `link:<code>` and shows the code as a QR code and in letters; the new device joins and sends
// a signed link-request. The existing device answers link-offer with whose it is, and both show
// the same 6-digit check made from the code and both device keys. Only when you confirm on the
// existing device does it put the new one on its device log and send link-accept with what the
// new device needs (the bundle, which the app defines). A code links once.
import { speakerIdentity } from '../devices/device-log.ts'
import { utf8Encode } from '../encoding/bytes.ts'
import type { Json } from '../encoding/canonical.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import { fingerprint, type PeerId } from '../identity/identity.ts'
import { type Body, openEnvelope, type Speaker, sealEnvelope } from '../messages/envelope.ts'
import type { ConnectionId, Room, Transport } from '../transport/transport.ts'

export const linkRoom = (code: string): `link:${string}` => `link:${code}`

/** "482 913": the same on both screens when they're talking to each other and nobody else. */
export async function linkCheck(
  crypto: Crypto,
  code: string,
  existing: PeerId,
  added: PeerId,
): Promise<string> {
  const digest = await crypto.sha256(utf8Encode(`pigeon/link/v1\n${code}\n${existing}\n${added}`))
  const number =
    (((digest[0] ?? 0) << 24) |
      ((digest[1] ?? 0) << 16) |
      ((digest[2] ?? 0) << 8) |
      (digest[3] ?? 0)) >>>
    0
  const six = String(number % 1_000_000).padStart(6, '0')
  return `${six.slice(0, 3)} ${six.slice(3)}`
}

interface Common {
  readonly crypto: Crypto
  readonly signer: Signer
  readonly transport: Transport
  readonly now: () => number
}

const listen = (
  crypto: Crypto,
  room: Room,
  handle: (from: ConnectionId, sender: PeerId, body: Body) => void,
) =>
  room.onMessage((from, bytes) => {
    void openEnvelope(crypto, room.name, bytes).then((opened) => {
      if (opened.ok) handle(from, opened.value.from, opened.value.body)
    })
  })

/** Someone asking to be linked, as the existing device shows them. */
export interface LinkRequest {
  /** The new device's key. */
  readonly device: PeerId
  readonly check: string
  /** Sends the bundle once the new device is on the log; resolves once it's sent. */
  accept(bundle: Json): Promise<void>
}

export interface HostLinkOptions extends Common {
  readonly code: string
  readonly handle: string
  /** Who this device speaks for, when it isn't its identity's first device. */
  readonly speaker?: (() => Speaker | undefined) | undefined
  readonly sleep: (ms: number) => Promise<void>
  readonly onRequest: (request: LinkRequest) => void
}

/** Waits for one new device to ask. The returned function stops waiting. */
export async function hostLink(options: HostLinkOptions): Promise<() => Promise<void>> {
  const { code, signer, crypto } = options
  const room = await options.transport.join(linkRoom(code))
  const send = async (to: ConnectionId, body: Body) =>
    room.send(to, await sealEnvelope(signer, room.name, options.now(), body))
  let asked = false
  let done = false
  const off = listen(crypto, room, (from, sender, body) => {
    if (done || asked || sender === signer.id) return
    if (body.type !== 'link-request' || body.code !== code) return
    asked = true
    void (async () => {
      await send(from, {
        type: 'link-offer',
        code,
        handle: options.handle,
        ...(options.speaker?.() ?? {}),
      })
      options.onRequest({
        device: sender,
        check: await linkCheck(crypto, code, signer.id, sender),
        async accept(bundle) {
          done = true
          await send(from, { type: 'link-accept', code, bundle })
          // Give the accept a moment to leave before the room goes.
          void options.sleep(2000).then(stop)
        },
      })
    })()
  })
  const stop = async () => {
    done = true
    off()
    await room.leave()
  }
  return stop
}

/** The existing device, as the new one shows it while you confirm over there. */
export interface LinkOffer {
  readonly identity: PeerId
  readonly handle: string
  readonly check: string
  /** Resolves with the bundle once you confirm on the other device, or false if `until` gives up. */
  accepted(until: Promise<void>): Promise<Json | false>
  cancel(): Promise<void>
}

export interface OpenLinkOptions extends Common {
  readonly code: string
  /** The identity's fingerprint, from the link; a typed code has none. */
  readonly fingerprint?: string | undefined
  readonly until: Promise<void>
}

export type OpenLinkResult =
  | { readonly ok: true; readonly offer: LinkOffer }
  | { readonly ok: false; readonly error: 'stopped' | 'impostor' }

/** Asks the device that showed `code` to link this one. Nothing changes until it's confirmed. */
export async function openLink(options: OpenLinkOptions): Promise<OpenLinkResult> {
  const { code, signer, crypto } = options
  const room = await options.transport.join(linkRoom(code))
  const send = async (to: ConnectionId, body: Body) =>
    room.send(to, await sealEnvelope(signer, room.name, options.now(), body))
  const request = (to: ConnectionId) => void send(to, { type: 'link-request', code })

  let impostor = false
  let resolveOffer: ((result: OpenLinkResult) => void) | undefined
  const offered = new Promise<OpenLinkResult>((resolve) => {
    resolveOffer = resolve
  })
  let onAccept: ((sender: PeerId, bundle: Json) => void) | undefined

  const off = listen(crypto, room, (_from, sender, body) => {
    if (sender === signer.id || !('code' in body) || body.code !== code) return
    if (body.type === 'link-accept') {
      onAccept?.(sender, body.bundle)
      return
    }
    if (body.type !== 'link-offer') return
    void (async () => {
      const identity = await speakerIdentity(crypto, sender, body)
      if (identity === undefined) return
      const print = await fingerprint(crypto, identity)
      if (options.fingerprint !== undefined && print !== options.fingerprint) {
        impostor = true
        return
      }
      resolveOffer?.({
        ok: true,
        offer: {
          identity,
          handle: body.handle,
          check: await linkCheck(crypto, code, sender, signer.id),
          async accepted(until) {
            const bundle = await new Promise<Json | false>((resolve) => {
              onAccept = (who, sent) => {
                if (who === sender) resolve(sent)
              }
              void until.then(() => resolve(false))
            })
            await leave()
            return bundle
          },
          cancel: () => leave(),
        },
      })
    })()
  })
  const offJoin = room.onPeerJoin(request)
  for (const peer of room.peers()) request(peer)

  let left = false
  const leave = async () => {
    if (left) return
    left = true
    off()
    offJoin()
    await room.leave()
  }
  void options.until.then(() =>
    resolveOffer?.({ ok: false, error: impostor ? 'impostor' : 'stopped' }),
  )
  const result = await offered
  if (!result.ok) await leave()
  else offJoin()
  return result
}
