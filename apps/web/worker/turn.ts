// Short-lived TURN credentials from Cloudflare Realtime (decision 0022). The API token stays a
// Worker secret; browsers only ever see a username and password that expire.

export interface TurnEnv {
  /** The TURN key's id, from the Cloudflare dashboard (Realtime → TURN Server). */
  TURN_KEY_ID?: string
  /** The TURN key's API token, a Worker secret. */
  TURN_KEY_API_TOKEN?: string
}

export interface IceServer {
  urls: string[]
  username?: string
  credential?: string
}

/** How long a credential lasts. A tab asks again each time it joins a room. */
export const TURN_TTL_SECONDS = 24 * 60 * 60

/** Browsers stall on port 53 (DNS), so Cloudflare advises leaving those addresses out. */
const usable = (url: string) => !/:53(\?|$)/.test(url)

const json = (body: unknown, status: number, maxAge = 0) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': maxAge > 0 ? `private, max-age=${maxAge}` : 'no-store',
    },
  })

/** Answers `GET /api/turn` with `{ iceServers }`, or an error the client treats as "no TURN". */
export async function handleTurn(
  request: Request,
  env: TurnEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405)
  // Only Pigeon's own pages ask; a browser says where a request comes from.
  const site = request.headers.get('sec-fetch-site')
  if (site !== null && site !== 'same-origin') return json({ error: 'forbidden' }, 403)
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return json({ error: 'not configured' }, 503)

  const upstream = await fetchImpl(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
    },
  )
  if (!upstream.ok) return json({ error: 'upstream failed' }, 502)
  const { iceServers } = (await upstream.json()) as { iceServers?: IceServer[] }
  const servers = (iceServers ?? [])
    .map((server) => ({ ...server, urls: [server.urls].flat().filter(usable) }))
    .filter((server) => server.urls.length > 0)
  // Cached a little less than an hour, well inside the credential's life.
  return json({ iceServers: servers }, 200, 50 * 60)
}
