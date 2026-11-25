// A Lighthouse's address: its key, its name and where to reach it, written as
// pigeon://lighthouse/<id>?url=wss://...&name=...[&pass=...]. The key is what Pigeon checks every
// reply against, so an address names one Lighthouse however its server is reached.
import { isPeerId, type PeerId } from '../identity/identity.ts'
import { err, ok, type Result } from '../result/result.ts'

export interface LighthouseAddress {
  readonly id: PeerId
  /** Its operator's name for it, shown beside its fingerprint. */
  readonly name: string
  /** A WebSocket URL: wss://, or ws:// for a Lighthouse on this computer. */
  readonly url: string
  /** A personal Lighthouse's pass; without it, it answers nothing. */
  readonly pass?: string
}

const PREFIX = 'pigeon://lighthouse/'
export const MAX_LIGHTHOUSE_NAME_LENGTH = 64

/**
 * wss:// anywhere; ws:// only to this computer, for running one locally. Core has no URL parser,
 * so this is a strict pattern: a host, an optional port and path, nothing else.
 */
const SOCKET_URL =
  /^(wss|ws):\/\/((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[[0-9a-f:]+\])(:\d{1,5})?(\/[A-Za-z0-9._~/-]*)?$/i
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]'])

function isSocketUrl(text: string): boolean {
  const match = SOCKET_URL.exec(text)
  if (match === null || text.length > 256) return false
  const scheme = (match[1] ?? '').toLowerCase()
  return scheme === 'wss' || LOCAL.has((match[2] ?? '').toLowerCase())
}

/** `a=1&b=2` with each value percent-encoded, in the order given. */
const encodeQuery = (pairs: readonly (readonly [string, string])[]) =>
  pairs.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&')

function decodeQuery(text: string): Map<string, string> | undefined {
  const out = new Map<string, string>()
  for (const part of text.split('&')) {
    const equals = part.indexOf('=')
    if (equals < 0) return undefined
    const name = part.slice(0, equals)
    // One of each: with two, which one counts would be a guess.
    if (out.has(name)) return undefined
    try {
      out.set(name, decodeURIComponent(part.slice(equals + 1)))
    } catch {
      return undefined
    }
  }
  return out
}

export function isLighthouseAddress(value: unknown): value is LighthouseAddress {
  if (typeof value !== 'object' || value === null) return false
  const fields = value as Record<string, unknown>
  const { id, name, url, pass } = fields
  return (
    typeof id === 'string' &&
    isPeerId(id) &&
    typeof name === 'string' &&
    name.trim() !== '' &&
    // Shown beside the fingerprint: nothing that could hide or reorder what's around it.
    !/[\p{Cc}\p{Cf}]/u.test(name) &&
    name.length <= MAX_LIGHTHOUSE_NAME_LENGTH &&
    typeof url === 'string' &&
    isSocketUrl(url) &&
    (pass === undefined || (typeof pass === 'string' && pass !== '' && pass.length <= 128))
  )
}

export function formatLighthouseAddress(address: LighthouseAddress): string {
  const pairs: [string, string][] = [
    ['url', address.url],
    ['name', address.name],
  ]
  if (address.pass !== undefined) pairs.push(['pass', address.pass])
  return `${PREFIX}${address.id}?${encodeQuery(pairs)}`
}

/** Reads an address someone pasted, trimmed, in the form `formatLighthouseAddress` writes. */
export function parseLighthouseAddress(text: string): Result<LighthouseAddress, 'malformed'> {
  const trimmed = text.trim()
  if (!trimmed.startsWith(PREFIX)) return err('malformed')
  const rest = trimmed.slice(PREFIX.length)
  const mark = rest.indexOf('?')
  if (mark < 0) return err('malformed')
  const id = rest.slice(0, mark).toLowerCase()
  const query = decodeQuery(rest.slice(mark + 1))
  if (query === undefined) return err('malformed')
  const pass = query.get('pass') ?? null
  const address = {
    id,
    name: (query.get('name') ?? '').trim(),
    url: query.get('url') ?? '',
    ...(pass === null ? {} : { pass }),
  }
  return isLighthouseAddress(address) ? ok(address) : err('malformed')
}
