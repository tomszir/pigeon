import { beforeEach, describe, expect, it, vi } from 'vitest'

const joinRoom = vi.fn()
vi.mock('trystero', () => ({ joinRoom: (...args: unknown[]) => joinRoom(...args) }))

const { createBrowserTransport } = await import('./browser-transport.ts')

const room = {
  makeAction: () => ({ send: vi.fn(), onMessage: vi.fn() }),
  getPeers: () => ({}),
  onPeerJoin: vi.fn(),
  onPeerLeave: vi.fn(),
  leave: vi.fn(),
}
const turn = [{ urls: 'turn:turn.example:3478', username: 'u', credential: 'c' }]

beforeEach(() => {
  joinRoom.mockReset()
  joinRoom.mockReturnValue(room)
})

describe('the browser transport', () => {
  it('locks a room with its password, and goes through the relay only when asked', async () => {
    const transport = createBrowserTransport(async () => turn)
    await transport.join('pair:abc', { password: 'secret', relayOnly: true })
    expect(joinRoom.mock.calls[0]?.[0]).toMatchObject({
      password: 'secret',
      rtcConfig: { iceTransportPolicy: 'relay' },
      turnConfig: turn,
    })
    await transport.join('invite:abc')
    const plain = joinRoom.mock.calls[1]?.[0]
    expect(plain).not.toHaveProperty('password')
    expect(plain).not.toHaveProperty('rtcConfig')
  })

  it('says so when relay-only has no relay, and still doesn’t connect directly', async () => {
    const onNoRelay = vi.fn()
    const transport = createBrowserTransport(async () => [], onNoRelay)
    await transport.join('pair:abc', { relayOnly: true })
    expect(onNoRelay).toHaveBeenCalledTimes(1)
    expect(joinRoom.mock.calls[0]?.[0]).toMatchObject({
      rtcConfig: { iceTransportPolicy: 'relay' },
    })
    await transport.join('pair:abc')
    expect(onNoRelay).toHaveBeenCalledTimes(1)
  })
})
