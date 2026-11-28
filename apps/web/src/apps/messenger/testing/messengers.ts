// The Messenger as tests run it: whole Pigeons in memory, with a fake clock, a real Lighthouse
// reached over an in-memory socket, and the steps most tests start from (two friends, a laptop
// and its linked phone, two people who share only a Lighthouse). Shared by the service's test
// files.
import {
  createLighthouseClient,
  createMemoryNetwork,
  decodeDeviceLink,
  decodeInvite,
  fakeCrypto,
  fakePake,
  fakeSealCrypto,
  fakeSigner,
  flush,
  type LighthouseAddress,
  type LighthouseClient,
} from '@pigeon/core'
import {
  createLighthouse,
  createMemoryStore as createMailStore,
  type LighthouseConnection,
  type MailStore,
} from '@pigeon/lighthouse'
import { createRoot } from 'solid-js'
import { expect } from 'vitest'
import type { Clock } from '../../../platform/clock/clock.ts'
import { createMemoryStore } from '../../../platform/storage/memory-storage.ts'
import type { Store } from '../../../platform/storage/storage.ts'
import type { Wake } from '../../../platform/wake/wake.ts'
import type { FriendView, MessengerEvents } from '../service/messenger.ts'
import { createMessenger } from '../service/service.ts'

export const NOON = Date.parse('2026-11-24T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

export const never = new Promise<void>(() => undefined)
/** Every test Pigeon's random draws so far, so no two draws are the same. */
let draws = 0

export function fakeClock(start = 1_000_000): Clock & { tick(ms: number): Promise<void> } {
  let time = start
  let timers: { at: number; resolve: () => void }[] = []
  return {
    now: () => time,
    sleep: (ms) => new Promise((resolve) => timers.push({ at: time + ms, resolve })),
    async tick(ms) {
      time += ms
      const due = timers.filter((timer) => timer.at <= time)
      timers = timers.filter((timer) => timer.at > time)
      for (const timer of due) timer.resolve()
      await flush()
    },
  }
}

export type Network = ReturnType<typeof createMemoryNetwork>

export function messenger(
  network: Network,
  name: string,
  options: {
    store?: Store
    clock?: Clock
    wake?: Wake
    events?: MessengerEvents
    seed?: number
    lighthouses?: readonly LighthouseAddress[]
    lighthouse?: TestLighthouse
    /** More Lighthouses after `lighthouse`, each reached through its own client. */
    more?: readonly TestLighthouse[]
    /** The official Lighthouses, when not every one of `lighthouse` and `more`. */
    official?: readonly LighthouseAddress[]
  } = {},
) {
  const transport = network.transport()
  const store = options.store ?? createMemoryStore()
  return createRoot(async () => ({
    store,
    transport,
    messenger: await createMessenger({
      crypto: fakeCrypto,
      signer: fakeSigner(name),
      store,
      transport,
      clock: options.clock ?? fakeClock(),
      ...(options.wake === undefined ? {} : { wake: options.wake }),
      // Known bytes, but a new draw each time, even after a restart, as ids taken once need.
      random: (length) => {
        const bytes = new Uint8Array(length).fill(options.seed ?? name.length)
        draws += 1
        bytes[0] = draws % 256
        bytes[1] = Math.floor(draws / 256) % 256
        return bytes
      },
      inviteBase: 'https://pigeon.test/',
      pake: fakePake(),
      // Each device's own sealing key, the same across its restarts, as a stored one would be.
      seal: { crypto: fakeSealCrypto(), sealer: fakeSealCrypto().sealer(name) },
      ...(options.lighthouses === undefined ? {} : { lighthouses: options.lighthouses }),
      ...(options.lighthouse === undefined
        ? {}
        : (() => {
            const all = [options.lighthouse, ...(options.more ?? [])]
            return {
              lighthouses: options.official ?? all.map((one) => one.address),
              lighthouseClient: (address: LighthouseAddress) =>
                (all.find((one) => one.address.id === address.id) ?? all[0])?.client(
                  address,
                ) as LighthouseClient,
            }
          })()),
      ...(options.events === undefined ? {} : { events: options.events }),
    }),
  }))
}

export interface TestLighthouse {
  readonly address: LighthouseAddress
  readonly client: (address: LighthouseAddress) => LighthouseClient
  /** While down, it closes every connection and takes no new one. */
  down(value: boolean): void
  /** While set, it keeps what's put unclaimed, as a Lighthouse from before claims does. */
  unclaimed(value: boolean): void
  /** A connection of someone else's, from `address`, frames in and replies out. */
  connect(address: string): LighthouseConnection
  /** The `seq` of the last blob it stored: a cursor past everything it holds now. */
  lastSeq(): number
  /** The lease of every wait sent to it, in seconds, in the order they came. */
  leases(): readonly number[]
  /** Waits standing at it now: sent, unanswered, on a connection still open. */
  standing(): number
}

/** A real Lighthouse in memory, reached over a socket that carries frames straight to it. */
export function testLighthouse(
  clock: Clock,
  name = 'test-lighthouse',
  options: {
    /** Its connections can hold a wait and answer it later, as a runner's do. */
    readonly waits?: boolean
  } = {},
): TestLighthouse {
  const signer = fakeSigner(name)
  const url = name === 'test-lighthouse' ? 'wss://lighthouse.test/' : `wss://${name}.test/`
  const inner = createMailStore()
  let unclaimed = false
  let stored = 0
  const store: MailStore = {
    ...inner,
    put: async (blob, now) => {
      const outcome = await inner.put(unclaimed ? { ...blob, owner: undefined } : blob, now)
      if (outcome === 'stored') stored += 1
      return outcome
    },
  }
  const lighthouse = createLighthouse({
    signer,
    crypto: fakeCrypto,
    store,
    now: clock.now,
    name: 'Test Lighthouse',
    software: { name: 'pigeon-lighthouse', version: '0.0.0' },
    // A put's wakes as soon as its reply is out, which a test's fake clock never holds back.
    defer: (run) => queueMicrotask(run),
  })
  let n = 0
  let sockets = 0
  let isDown = false
  const leases: number[] = []
  const open = new Set<() => void>()
  /** Each standing wait, as its connection and request number. */
  const waiting = new Set<string>()
  return {
    down(value) {
      isDown = value
      if (value) for (const close of [...open]) close()
    },
    unclaimed(value) {
      unclaimed = value
    },
    connect: (address) => lighthouse.connect(address),
    lastSeq: () => stored,
    leases: () => leases,
    standing: () => waiting.size,
    address: { id: signer.id, name: 'Test Lighthouse', url },
    client: () =>
      createLighthouseClient({
        address: { id: signer.id, name: 'Test Lighthouse', url },
        crypto: fakeCrypto,
        random: (length) => new Uint8Array(length).fill(++n % 250),
        sleep: () => new Promise(() => undefined),
        open: (_url, events) => {
          if (isDown) {
            void Promise.resolve().then(() => events.onClose())
            return { send: () => undefined, close: () => undefined }
          }
          const socket = ++sockets
          const answered = (frame: string) => {
            const req = (JSON.parse(frame) as { req?: unknown }).req
            waiting.delete(`${socket} ${req}`)
          }
          const close = () => {
            for (const key of [...waiting]) if (key.startsWith(`${socket} `)) waiting.delete(key)
            if (open.delete(close)) events.onClose()
          }
          const connection = lighthouse.connect(
            '203.0.113.7',
            undefined,
            options.waits === true
              ? {
                  push: (frame) => {
                    answered(frame)
                    events.onMessage(frame)
                  },
                  close: () => close(),
                  heard: () => clock.now(),
                }
              : undefined,
          )
          open.add(close)
          void Promise.resolve().then(events.onOpen)
          return {
            send: (text) => {
              const sent = JSON.parse(text) as {
                req?: number
                request?: { type?: string; seconds?: number }
              }
              if (sent.request?.type === 'wait') {
                leases.push(sent.request.seconds ?? 0)
                waiting.add(`${socket} ${sent.req}`)
              }
              void connection.receive(text).then((reply) => {
                if (reply === undefined) close()
                else if (reply !== null) {
                  answered(reply)
                  events.onMessage(reply)
                }
              })
            },
            close,
          }
        },
      }),
  }
}

export async function pair(
  network: Network,
  events: { a?: MessengerEvents; b?: MessengerEvents } = {},
  by: 'link' | 'code' = 'link',
  clock = fakeClock(),
) {
  const a = await messenger(network, 'rook', { clock, ...(events.a ? { events: events.a } : {}) })
  const b = await messenger(network, 'mika', { clock, ...(events.b ? { events: events.b } : {}) })
  await pairWith(a, b, by)
  return { a, b, clock }
}

/** Rook (`a`) invites Mika (`b`), who agrees: friends, through the invite handshake. */
export async function pairWith(
  a: Awaited<ReturnType<typeof messenger>>,
  b: Awaited<ReturnType<typeof messenger>>,
  by: 'link' | 'code' = 'link',
) {
  await a.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
  await b.messenger.setProfile({ handle: 'Mika', status: 'away', message: 'brb' })
  await a.messenger.newInvite()
  const link = a.messenger.inviteLink() ?? ''
  expect(link).toMatch(/^https:\/\/pigeon\.test\/#i\/[a-z2-7]{39}$/)
  expect(a.messenger.inviteCode()).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{3}-[A-Z2-7]{3}$/)
  const invite = decodeInvite(by === 'link' ? link : (a.messenger.inviteCode() ?? ''))
  if (!invite.ok) throw new Error('bad invite')
  const opened = await b.messenger.open(invite.value, never)
  if (!opened.ok) throw new Error(opened.error)
  expect(opened.offer.friend.handle).toBe('Rook')
  expect(opened.offer.checked).toBe(by === 'link')
  // Nobody is a friend until Mika asks and Rook adds her.
  expect(a.messenger.friends()).toEqual([])
  const confirmed = opened.offer.confirm(never)
  await flush()
  const ask = only(a.messenger.codeAsks())
  expect(ask).toMatchObject({ id: b.messenger.self, handle: 'Mika' })
  expect(a.messenger.friends()).toEqual([])
  expect(await a.messenger.approveAsk(ask.key)).toBe(true)
  expect(await confirmed).toBe(true)
  await flush()
}

export const only = <T = FriendView>(list: readonly T[]): T => {
  expect(list).toHaveLength(1)
  return list[0] as T
}

/** Links a fresh device called `name` to `from`'s identity, and starts it as that identity. */
export async function linkDevice(
  network: Network,
  from: Awaited<ReturnType<typeof messenger>>,
  name: string,
  clock: Clock,
  lighthouse?: TestLighthouse,
  device?: Awaited<ReturnType<typeof messenger>>,
) {
  const options = { clock, ...(lighthouse === undefined ? {} : { lighthouse }) }
  const fresh = device ?? (await messenger(network, name, options))
  const linking = await from.messenger.startLink()
  if (linking === undefined) throw new Error('could not start linking')
  const target = decodeDeviceLink(linking.link)
  if (!target.ok) throw new Error('bad link')
  const joined = await fresh.messenger.joinIdentity(target.value, never)
  if (!joined.ok) throw new Error(joined.error)
  expect(joined.offer.checked).toBe(true)
  expect(joined.offer.identityFingerprint).toBe(from.messenger.selfFingerprint)
  const confirmed = joined.offer.confirmed(never)
  await flush()
  const request = from.messenger.linking()?.request
  expect(request?.fingerprint).toBe(joined.offer.fingerprint)
  expect(request?.device).toBe(fresh.messenger.device)
  const status = await from.messenger.confirmLink(name)
  expect(await confirmed).toBe(true)
  await fresh.messenger.close()
  await flush()
  // Started again, this browser is the identity it was linked to.
  const started = await messenger(network, name, { ...options, store: fresh.store })
  await flush()
  return { device: started, status }
}

/** Rook's laptop and phone, linked, both leaving and fetching mail at one Lighthouse. */
export async function laptopAndPhone() {
  const network = createMemoryNetwork()
  const clock = fakeClock(NOON)
  const lighthouse = testLighthouse(clock)
  const laptop = await messenger(network, 'rook', { clock, lighthouse })
  await laptop.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
  const { device: phone } = await linkDevice(network, laptop, 'rook-phone', clock, lighthouse)
  await flush()
  return { network, clock, lighthouse, laptop, phone }
}

/** The phone's Pigeon closes and its network goes: it meets nobody until it opens again. */
export async function away(device: Awaited<ReturnType<typeof messenger>>) {
  await device.messenger.close()
  device.transport.disconnect()
  await flush()
}

/** Rook and Mika on networks of their own: they never meet, and share only a Lighthouse. */
export async function apart() {
  const clock = fakeClock(NOON)
  const lighthouse = testLighthouse(clock)
  const rook = await messenger(createMemoryNetwork(), 'rook', { clock, lighthouse })
  const mika = await messenger(createMemoryNetwork(), 'mika', { clock, lighthouse })
  await rook.messenger.setProfile({ handle: 'Rook', status: 'online', message: '' })
  await mika.messenger.setProfile({ handle: 'Mika', status: 'online', message: '' })
  return { clock, lighthouse, rook, mika }
}

/** A link `who` made, for five people over a week unless `options` say otherwise. */
export async function made(
  who: Awaited<ReturnType<typeof messenger>>,
  options = { lifetime: 7 * DAY, uses: 5 },
) {
  const result = await who.messenger.makeInviteLink(options)
  if (!result.ok) throw new Error(result.error)
  expect(result.link.url).toMatch(/^https:\/\/pigeon\.test\/#b\/[a-z2-7]{86}(\?l=\S+)?$/)
  return result.link
}

/** `who` opens `url` and asks through it. */
export async function asks(who: Awaited<ReturnType<typeof messenger>>, url: string) {
  const opened = await who.messenger.openInviteLink(url)
  if (!opened.ok) throw new Error(opened.error)
  expect(await who.messenger.askThroughLink(opened)).toBe('sent')
  return opened
}
