// @vitest-environment node
// The Worker runs on Cloudflare, not in a page, so these run in Node.
import { describe, expect, it, vi } from 'vitest'
import { handleTurn, TURN_TTL_SECONDS, visitorTag } from './turn.ts'

const env = { TURN_KEY_ID: 'key-id', TURN_KEY_API_TOKEN: 'secret-token' }
const get = (
  headers: Record<string, string> = {
    'sec-fetch-site': 'same-origin',
    'cf-connecting-ip': '203.0.113.7',
  },
) => new Request('https://pigeon.test/api/turn', { headers })

const cloudflare = () =>
  vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          iceServers: [
            {
              urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'],
            },
            {
              urls: [
                'turn:turn.cloudflare.com:3478?transport=udp',
                'turn:turn.cloudflare.com:53?transport=udp',
                'turns:turn.cloudflare.com:443?transport=tcp',
              ],
              username: 'user',
              credential: 'pass',
            },
          ],
        }),
      ),
  )

describe('handleTurn', () => {
  it('asks Cloudflare with the secret token and leaves out port 53', async () => {
    const fetchImpl = cloudflare()
    const response = await handleTurn(get(), env, fetchImpl)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toMatch(/^private/)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(
      'https://rtc.live.cloudflare.com/v1/turn/keys/key-id/credentials/generate-ice-servers',
    )
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret-token')
    expect(TURN_TTL_SECONDS).toBe(4 * 60 * 60)
    expect(JSON.parse(String(init.body))).toEqual({
      ttl: TURN_TTL_SECONDS,
      customIdentifier: await visitorTag(get(), 'secret-token'),
    })
    const body = await response.json()
    expect(body).toEqual({
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478'] },
        {
          urls: [
            'turn:turn.cloudflare.com:3478?transport=udp',
            'turns:turn.cloudflare.com:443?transport=tcp',
          ],
          username: 'user',
          credential: 'pass',
        },
      ],
    })
    expect(JSON.stringify(body)).not.toContain('secret-token')
  })

  it('sends the safe headers the static files get, refusals included', async () => {
    for (const response of [
      await handleTurn(get(), env, cloudflare()),
      await handleTurn(get(), {}, cloudflare()),
    ]) {
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('content-security-policy')).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      )
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    }
  })

  it('refuses other sites, other methods, and says when it is not set up', async () => {
    const fetchImpl = cloudflare()
    expect((await handleTurn(get({ 'sec-fetch-site': 'cross-site' }), env, fetchImpl)).status).toBe(
      403,
    )
    const post = new Request('https://pigeon.test/api/turn', { method: 'POST' })
    expect((await handleTurn(post, env, fetchImpl)).status).toBe(405)
    expect((await handleTurn(get(), {}, fetchImpl)).status).toBe(503)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('tags each visitor by a keyed hash of their address, never the address itself', async () => {
    const tag = await visitorTag(get(), 'secret-token')
    expect(tag).toMatch(/^XX-[0-9a-f]{16}$/)
    expect(tag).not.toContain('203.0.113.7')
    expect(await visitorTag(get(), 'secret-token')).toBe(tag)
    const other = get({ 'cf-connecting-ip': '198.51.100.1' })
    expect(await visitorTag(other, 'secret-token')).not.toBe(tag)
    expect(await visitorTag(get(), 'another-secret')).not.toBe(tag)
  })

  it('asks again without the tag if Cloudflare refuses it', async () => {
    const ok = await cloudflare()()
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('bad field', { status: 400 }))
      .mockResolvedValueOnce(ok)
    const response = await handleTurn(get(), env, fetchImpl)
    expect(response.status).toBe(200)
    const retry = fetchImpl.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(String(retry[1].body))).toEqual({ ttl: TURN_TTL_SECONDS })
  })

  it('reports a failed upstream without passing its body on', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 }))
    const response = await handleTurn(get(), env, fetchImpl)
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('nope')
  })
})
