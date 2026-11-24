// @vitest-environment node
// The Worker runs on Cloudflare, not in a page, so these run in Node.
import { describe, expect, it, vi } from 'vitest'
import { handleTurn, TURN_TTL_SECONDS } from './turn.ts'

const env = { TURN_KEY_ID: 'key-id', TURN_KEY_API_TOKEN: 'secret-token' }
const get = (headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' }) =>
  new Request('https://pigeon.test/api/turn', { headers })

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
    expect(JSON.parse(String(init.body))).toEqual({ ttl: TURN_TTL_SECONDS })
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

  it('reports a failed upstream without passing its body on', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 }))
    const response = await handleTurn(get(), env, fetchImpl)
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('nope')
  })
})
