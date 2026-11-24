import { describe, expect, it, vi } from 'vitest'
import { turnServers } from './turn-servers.ts'

const turn = {
  urls: ['turns:turn.cloudflare.com:443?transport=tcp'],
  username: 'user',
  credential: 'pass',
}
const answer = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }))

describe('turnServers', () => {
  it('fetches once and reuses the answer while it is fresh', async () => {
    const fetchImpl = answer({ iceServers: [turn, { urls: 42 }] })
    let time = 0
    const get = turnServers(fetchImpl, () => time)
    expect(await Promise.all([get(), get()])).toEqual([[turn], [turn]])
    time = 49 * 60 * 1000
    await get()
    expect(fetchImpl).toHaveBeenCalledOnce()
    time = 51 * 60 * 1000
    await get()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('falls back to none when the endpoint is missing or down, and asks again later', async () => {
    const missing = answer({ error: 'not configured' }, 503)
    const get = turnServers(missing)
    expect(await get()).toEqual([])
    expect(await get()).toEqual([])
    expect(missing).toHaveBeenCalledTimes(2)

    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await turnServers(offline)()).toEqual([])
  })
})
