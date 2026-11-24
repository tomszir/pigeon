import { expect, it } from 'vitest'
import { createMemoryNetwork, flush } from './testing.ts'

it('announces peers both ways, delivers in order, and reports leaving', async () => {
  const network = createMemoryNetwork()
  const a = await network.transport().join('lobby')
  const aSaw: string[] = []
  a.onPeerJoin((peer) => aSaw.push(`join ${peer}`))
  a.onMessage((from, message) => aSaw.push(`${from} sent ${message[0]}`))
  a.onPeerLeave((peer) => aSaw.push(`leave ${peer}`))

  const transportB = network.transport()
  const b = await transportB.join('lobby')
  const bSaw: string[] = []
  b.onPeerJoin((peer) => bSaw.push(peer))
  await flush()
  const [aId] = b.peers()
  const [bId] = a.peers()
  expect(bSaw).toEqual([aId])

  b.broadcast(Uint8Array.of(1))
  b.send(aId ?? '', Uint8Array.of(2))
  await flush()
  transportB.disconnect()
  await flush()
  expect(aSaw).toEqual([`join ${bId}`, `${bId} sent 1`, `${bId} sent 2`, `leave ${bId}`])
  expect(a.peers()).toEqual([])
})
