import { beforeEach, describe, expect, it, vi } from 'vitest'

const joinRoom = vi.fn()
vi.mock('trystero', () => ({ joinRoom: (...args: unknown[]) => joinRoom(...args) }))

const { connectionBinding, createBrowserTransport, sdpFingerprint } = await import(
  './browser-transport.ts'
)

const sdp = (hex: string) =>
  `v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\na=fingerprint:sha-256 ${hex.match(/../g)?.join(':')}\r\n`
const local = 'AB'.repeat(32)
/** The remote certificate as DTLS reports it: its SHA-256 is what the remote SDP names. */
const certificate = new Uint8Array([1, 2, 3]).buffer
const remote = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
const channel = (state: string, certificates: ArrayBuffer[] = [certificate], named = remote) =>
  ({
    localDescription: { sdp: sdp(local) },
    remoteDescription: { sdp: sdp(named) },
    sctp: { transport: { state, getRemoteCertificates: () => certificates } },
  }) as unknown as RTCPeerConnection
const connection = channel('connected')
let peers: Record<string, { connection: RTCPeerConnection | null; direct: boolean }> = {}
const action = { send: vi.fn(async () => undefined), onMessage: vi.fn() }
const room = {
  makeAction: () => action,
  getPeers: () => peers,
  onPeerJoin: vi.fn(),
  onPeerLeave: vi.fn(),
  leave: vi.fn(),
}
const turn = [{ urls: 'turn:turn.example:3478', username: 'u', credential: 'c' }]

beforeEach(() => {
  peers = {}
  action.send.mockReset()
  action.send.mockImplementation(async () => undefined)
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
    await transport.join('invite/v2:abcd')
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

  it('binds a direct connection to both certificates, and nothing else', async () => {
    const binding = { local: 'ab'.repeat(32), remote }
    expect(await connectionBinding(connection)).toEqual(binding)
    const joined = await createBrowserTransport(async () => turn).join('pair:abc')
    peers = {
      direct: { connection, direct: true },
      carried: { connection: null, direct: false },
    }
    expect(await joined.binding('direct')).toEqual(binding)
    expect(await joined.binding('carried')).toBeUndefined()
    expect(await joined.binding('gone')).toBeUndefined()
  })

  it('binds to the certificate DTLS checked, not to a description sent later', async () => {
    // A renegotiation names another certificate while the old channel still runs.
    expect(await connectionBinding(channel('connected', [certificate], 'ee'.repeat(32)))).toBe(
      undefined,
    )
    expect(await connectionBinding(channel('connecting'))).toBeUndefined()
    expect(await connectionBinding(channel('connected', []))).toBeUndefined()
    const noTransport = { ...connection, sctp: null } as unknown as RTCPeerConnection
    expect(await connectionBinding(noTransport)).toBeUndefined()
  })

  it('reads one SHA-256 fingerprint from an SDP, or none when it’s unclear', () => {
    expect(sdpFingerprint(sdp(local))).toBe('ab'.repeat(32))
    // The same certificate named at the session and at the media level is still one.
    expect(sdpFingerprint(sdp(local) + sdp(local))).toBe('ab'.repeat(32))
    expect(sdpFingerprint(sdp(local) + sdp(remote))).toBeUndefined()
    expect(sdpFingerprint(sdp(local).replace('sha-256', 'sha-1'))).toBeUndefined()
    // Any other fingerprint beside it, in another hash or another spelling, leaves it unclear
    // which one DTLS checks.
    expect(
      sdpFingerprint(`${sdp(local)}a=fingerprint:sha-384 ${'ee:'.repeat(47)}ee\r\n`),
    ).toBeUndefined()
    expect(sdpFingerprint(sdp(local).replace('sha-256 ', 'sha-256\t'))).toBeUndefined()
    expect(sdpFingerprint(sdp(local).replace('sha-256', 'SHA-256'))).toBeUndefined()
    expect(sdpFingerprint(sdp('ab'.repeat(20)))).toBeUndefined()
    expect(sdpFingerprint(undefined)).toBeUndefined()
  })

  it('sends to a peer in order, so a small message never overtakes a large one', async () => {
    // Trystero sends a large message in chunks once the peer is ready; the first is still going.
    let finish: () => void = () => undefined
    const order: number[] = []
    action.send.mockImplementationOnce((async (message: Uint8Array) => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      order.push(message.length)
    }) as never)
    action.send.mockImplementation((async (message: Uint8Array) => {
      order.push(message.length)
    }) as never)
    const joined = await createBrowserTransport(async () => turn).join('pair:abc')
    joined.send('peer', new Uint8Array(40_000))
    joined.send('peer', new Uint8Array(10))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(order).toEqual([])
    finish()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(order).toEqual([40_000, 10])
  })
})
