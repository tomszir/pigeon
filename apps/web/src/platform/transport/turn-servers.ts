// TURN servers from the site's own Worker, for when two peers can't reach each
// other directly, as on mobile data. Without them Pigeon still tries STUN alone.

export interface TurnServer {
  urls: string | string[]
  username?: string
  credential?: string
}

/** Re-asked after this, well inside the credential's 4 hours. */
const FRESH_MS = 50 * 60 * 1000
/** A slow or missing endpoint (offline, or the dev server with PIGEON_TURN_FROM=off) must not hold up joining. */
const TIMEOUT_MS = 3000

const isServer = (value: unknown): value is TurnServer => {
  if (typeof value !== 'object' || value === null) return false
  const { urls, username, credential } = value as Record<string, unknown>
  const urlsOk =
    typeof urls === 'string' || (Array.isArray(urls) && urls.every((u) => typeof u === 'string'))
  return (
    urlsOk &&
    (username === undefined || typeof username === 'string') &&
    (credential === undefined || typeof credential === 'string')
  )
}

/** Returns a getter that fetches `/api/turn` once and reuses the answer while it's fresh. */
export function turnServers(
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  now: () => number = Date.now,
  url = '/api/turn',
): () => Promise<TurnServer[]> {
  let cached: { at: number; servers: TurnServer[] } | undefined
  let pending: Promise<TurnServer[]> | undefined

  const load = async (): Promise<TurnServer[]> => {
    try {
      // The route only answers requests carrying this header (see worker/turn.ts).
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'x-pigeon-turn': '1' },
      })
      if (!response.ok) return []
      const body = (await response.json()) as { iceServers?: unknown }
      const servers = Array.isArray(body.iceServers) ? body.iceServers.filter(isServer) : []
      cached = { at: now(), servers }
      return servers
    } catch {
      return []
    }
  }

  return () => {
    if (cached !== undefined && now() - cached.at < FRESH_MS) return Promise.resolve(cached.servers)
    pending ??= load().finally(() => {
      pending = undefined
    })
    return pending
  }
}
