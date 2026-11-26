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

/**
 * Whether a Lighthouse URL is wss:// to a host somewhere on the public internet. Loopback, private,
 * link-local, shared (carrier-grade NAT), multicast and other special-use addresses aren't (the
 * IANA special-purpose registries), nor are `localhost`, single-label names and names under
 * suffixes used only inside a network (`.local`, `.internal`, `.home.arpa`, ...). A host that
 * ends in a number is read as an IPv4 address the way a browser reads it, so `127.1`,
 * `0x7f.0.0.1` and `2130706433` all count as 127.0.0.1. A name is taken as it's written: one that
 * a DNS server answers with a private address can't be told apart here.
 */
export function isPublicLighthouseUrl(url: string): boolean {
  const match = SOCKET_URL.exec(url)
  // ws:// is for a Lighthouse on this computer, so never public.
  if (match === null || url.length > 256 || (match[1] ?? '').toLowerCase() !== 'wss') return false
  const host = (match[2] ?? '').toLowerCase()
  if (host.startsWith('[')) {
    const groups = parseIpv6(host.slice(1, -1))
    return groups !== undefined && isPublicIpv6(groups)
  }
  const labels = host.split('.')
  if (endsInNumber(labels[labels.length - 1] ?? '')) {
    const ip = parseIpv4(labels)
    return ip !== undefined && isPublicIpv4(ip)
  }
  if (labels.length < 2) return false
  return !LOCAL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
}

/** Names that mean nothing on the public internet's DNS (RFC 6761, 6762, 7686, 8375, 9476). */
const LOCAL_SUFFIXES = [
  'localhost',
  'local',
  'localdomain',
  'internal',
  'intranet',
  'home.arpa',
  'home',
  'lan',
  'corp',
  'private',
  'test',
  'invalid',
  'example',
  'onion',
  'alt',
]

/** The WHATWG URL standard's "ends in a number": its last label is all digits, or 0x and hex. */
const endsInNumber = (label: string) => /^(\d+|0x[0-9a-f]*)$/.test(label)

/** One part of an IPv4 host as the URL standard reads it: 0x hex, 0 octal, else decimal. */
function ipv4Part(part: string): number | undefined {
  if (/^0x[0-9a-f]*$/.test(part)) return part === '0x' ? 0 : Number.parseInt(part.slice(2), 16)
  if (/^0[0-7]+$/.test(part)) return Number.parseInt(part, 8)
  if (/^(0|[1-9]\d*)$/.test(part)) return Number.parseInt(part, 10)
  return undefined
}

/** The URL standard's IPv4 parser: up to four parts, the last filling what the rest leave. */
function parseIpv4(labels: readonly string[]): number | undefined {
  if (labels.length > 4) return undefined
  const parts = labels.map(ipv4Part)
  if (parts.some((part) => part === undefined)) return undefined
  const numbers = parts as number[]
  const last = numbers[numbers.length - 1] ?? 0
  const head = numbers.slice(0, -1)
  if (head.some((part) => part > 255) || last >= 256 ** (5 - numbers.length)) return undefined
  return head.reduce((sum, part, i) => sum + part * 256 ** (3 - i), 0) + last
}

/** Not public: this network, private, shared, loopback, link-local, documentation, multicast... */
const IPV4_SPECIAL: readonly (readonly [number, number])[] = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
]

const isPublicIpv4 = (ip: number) =>
  !IPV4_SPECIAL.some(
    ([base, bits]) => Math.floor(ip / 2 ** (32 - bits)) === base / 2 ** (32 - bits),
  )

/** Eight 16-bit groups, from hex groups with at most one `::`. */
function parseIpv6(text: string): number[] | undefined {
  const halves = text.split('::')
  if (halves.length > 2) return undefined
  const read = (half: string) => (half === '' ? [] : half.split(':'))
  const front = read(halves[0] ?? '')
  const back = halves.length === 2 ? read(halves[1] ?? '') : []
  const missing = 8 - front.length - back.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return undefined
  const groups = [...front, ...Array<string>(missing).fill('0'), ...back]
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined
  return groups.map((group) => Number.parseInt(group, 16))
}

/**
 * Only global unicast (2000::/3) is public, less IETF protocol assignments (2001::/23),
 * documentation (2001:db8::/32, 3fff::/20) and 6to4 around a
 * private IPv4 address. Loopback, unique-local, link-local, multicast, and IPv4-mapped and NAT64
 * forms fall outside it, so they're refused with the rest.
 */
function isPublicIpv6(groups: readonly number[]): boolean {
  const [first = 0, second = 0, third = 0] = groups
  if ((first & 0xe000) !== 0x2000) return false
  // IETF protocol assignments (Teredo, benchmarking, ORCHID...) and documentation.
  if (first === 0x2001 && second < 0x0200) return false
  if (first === 0x2001 && second === 0x0db8) return false
  if (first === 0x3fff && second < 0x1000) return false
  if (first === 0x2002) return isPublicIpv4(second * 0x10000 + third)
  return true
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
