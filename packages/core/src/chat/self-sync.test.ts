// Your shared log in the self room: each device sends its summary after its hello and answers
// another's with what that device lacks, only on a connection proven by another of your devices.
import { describe, expect, it } from 'vitest'
import type { Json } from '../encoding/canonical.ts'
import type { Signer } from '../identity/crypto.ts'
import type { PeerId } from '../identity/identity.ts'
import type { SyncSummaryBody } from '../messages/envelope.ts'
import {
  createMemoryNetwork,
  fakeCrypto,
  fakeSealCrypto,
  fakeSigner,
  flush,
} from '../testing/testing.ts'
import type { Transport } from '../transport/transport.ts'
import { startPairSession } from './pair-session.ts'

const rook = fakeSigner('self-sync:rook')
const rookPhone = fakeSigner('self-sync:rook-phone')
const thief = fakeSigner('self-sync:thief')
const { random } = fakeSealCrypto(11)
const ROOM = 'self:test'

async function device(
  transport: Transport,
  signer: Signer,
  own: readonly PeerId[],
  held: Json[],
  behind = false,
) {
  const taken: { from: PeerId; entries: readonly Json[] }[] = []
  const asked: PeerId[] = []
  const session = startPairSession({
    crypto: fakeCrypto,
    signer,
    friend: rook.id,
    chat: ROOM,
    rooms: [await transport.join(ROOM)],
    handle: () => 'Rook',
    presence: () => ({ status: 'online', message: '' }),
    log: { id: ROOM, entries: [] },
    now: () => 1,
    random,
    onEvent: () => undefined,
    accepts: (id) => (own.includes(id) ? 'friend' : undefined),
    sync: {
      summary: async (): Promise<SyncSummaryBody> => ({
        [signer.id]: { n: held.length, digest: 'd' },
      }),
      missing: async (from) => {
        asked.push(from)
        return held.length === 0 ? [] : [held]
      },
      take: async (from, entries) => void taken.push({ from, entries }),
      behind: async () => behind,
    },
  })
  return { session, taken, asked }
}

describe('your shared log in the self room', () => {
  it('passes what the other lacks once each has proved it is yours', async () => {
    const network = createMemoryNetwork()
    const laptop = await device(network.transport(), rook, [rookPhone.id], [{ n: 1 }])
    const phone = await device(network.transport(), rookPhone, [rook.id], [])
    await flush(400)
    expect(laptop.asked).toEqual([rookPhone.id])
    expect(phone.taken).toEqual([{ from: rook.id, entries: [{ n: 1 }] }])
    // A change later is said again.
    laptop.session.announceSync()
    await flush(400)
    expect(phone.asked).toEqual([rook.id, rook.id])
  })

  it('answers a summary with its own when the other holds something it lacks', async () => {
    const network = createMemoryNetwork()
    const laptop = await device(network.transport(), rook, [rookPhone.id], [{ n: 1 }])
    const phone = await device(network.transport(), rookPhone, [rook.id], [], true)
    await flush(400)
    laptop.session.announceSync()
    await flush(400)
    // The phone answered the laptop's news with its own summary, and was sent what it lacks.
    expect(laptop.asked.length).toBeGreaterThan(1)
    expect(phone.taken.length).toBeGreaterThan(1)
  })

  it('answers nobody that isn’t one of your devices', async () => {
    const network = createMemoryNetwork()
    const laptop = await device(network.transport(), rook, [rookPhone.id], [{ n: 1 }])
    const stranger = await device(network.transport(), thief, [rook.id], [{ forged: true }])
    await flush(400)
    expect(laptop.asked).toEqual([])
    expect(laptop.taken).toEqual([])
    expect(stranger.taken).toEqual([])
  })
})
