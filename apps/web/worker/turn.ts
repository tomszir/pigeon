// Short-lived TURN credentials from Cloudflare Realtime. The API token stays a
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

/**
 * How long a credential lasts: short, so one that leaks can't be used for long. A tab asks again
 * each time it joins a room; a room joined earlier keeps the credential it joined with.
 */
export const TURN_TTL_SECONDS = 4 * 60 * 60

/** The header Pigeon's pages send with `GET /api/turn`, set to `1`. */
export const TURN_REQUEST_HEADER = 'x-pigeon-turn'

/**
 * A tag for TURN analytics, so one visitor using a lot of relay stands out: the country and a
 * keyed hash of the address. The hash can't be turned back into the address without the secret.
 */
export async function visitorTag(request: Request, secret: string): Promise<string> {
  const address = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const country = (request as { cf?: { country?: unknown } }).cf?.country
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(address)))
  const hex = Array.from(mac.slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${typeof country === 'string' ? country : 'XX'}-${hex}`
}

/** Browsers stall on port 53 (DNS), so Cloudflare advises leaving those addresses out. */
const usable = (url: string) => !/:53(\?|$)/.test(url)

/**
 * What the site's static files get from public/_headers, which Cloudflare doesn't add to a
 * Worker's own responses: JSON is only ever JSON, and loads nothing if opened as a page.
 */
const SAFE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
}

const json = (body: unknown, status: number, maxAge = 0) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...SAFE_HEADERS,
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
  // Only Pigeon's own pages ask. They send a header of their own, which a page on another site
  // can't add without a CORS preflight this route never answers, and which a bare script such as
  // curl doesn't send. Old Safari sends no Sec-Fetch-Site, so that header only counts when sent.
  const site = request.headers.get('sec-fetch-site')
  if (request.headers.get(TURN_REQUEST_HEADER) !== '1' || (site !== null && site !== 'same-origin'))
    return json({ error: 'forbidden' }, 403)
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return json({ error: 'not configured' }, 503)

  const token = env.TURN_KEY_API_TOKEN
  const generate = (body: object) =>
    fetchImpl(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
  const customIdentifier = await visitorTag(request, token)
  let upstream = await generate({ ttl: TURN_TTL_SECONDS, customIdentifier })
  // Cloudflare documents the tag on its plain generate call; if this one refuses it, go untagged
  // rather than leave the visitor without TURN.
  if (upstream.status === 400) upstream = await generate({ ttl: TURN_TTL_SECONDS })
  if (!upstream.ok) return json({ error: 'upstream failed' }, 502)
  const { iceServers } = (await upstream.json()) as { iceServers?: IceServer[] }
  const servers = (iceServers ?? [])
    .map((server) => ({ ...server, urls: [server.urls].flat().filter(usable) }))
    .filter((server) => server.urls.length > 0)
  // Cached a little less than an hour, well inside the credential's life.
  return json({ iceServers: servers }, 200, 50 * 60)
}
