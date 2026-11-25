// A Lighthouse's limits (decision 0037), counted per address range: an IPv4 address, or an
// IPv6 /64, since anyone with one IPv6 address has the 2^64 around it. Counts live in memory
// only; addresses are never written to storage. A cap on everyone together, and on how many
// ranges are tracked at once, keeps someone with a whole IPv6 block from getting round them.

export interface Limits {
  /** Puts an address range may make in an hour. High enough for carriers' shared addresses. */
  readonly putsPerHour: number
  /** Bytes an address range may put in an hour. */
  readonly bytesPerHour: number
  /** Blobs an address range may put under one tag in a day, so nobody fills a tag for all. */
  readonly blobsPerTagPerDay: number
  /** Lists, gets and drops an address range may make in a minute. */
  readonly readsPerMinute: number
  /** Puts an IPv6 /48 may make in an hour, however many /64s it puts from. */
  readonly putsPerHourPer48: number
  /**
   * Puts from everyone together in an hour. Past it nobody can put until the hour turns: it
   * protects the store and the bill, and someone who trips it on purpose shuts everyone out
   * for that hour, which 0037 accepts.
   */
  readonly totalPutsPerHour: number
  /** Address ranges tracked at once; past it, new ones are refused until the window turns. */
  readonly maxRanges: number
  /** Range and tag pairs tracked in a day, for blobsPerTagPerDay. */
  readonly maxTagCounts: number
  /** What the store may hold, each blob costing its bytes and its record (see `blobCost`). */
  readonly maxBytes: number
}

export const DEFAULT_LIMITS: Limits = {
  putsPerHour: 2000,
  bytesPerHour: 64 * 1024 * 1024,
  blobsPerTagPerDay: 200,
  readsPerMinute: 600,
  putsPerHourPer48: 8000,
  totalPutsPerHour: 200_000,
  maxRanges: 50_000,
  maxTagCounts: 1_000_000,
  maxBytes: 1024 * 1024 * 1024,
}

/** What a blob costs to keep: its bytes, plus its id, tag and drop hashes and a record's room. */
export const blobCost = (size: number, drops: number): number => size + 52 * (2 + drops) + 64

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Expands an IPv6 address to its eight groups (as numbers), or undefined if it isn't one. */
function ipv6Groups(text: string): number[] | undefined {
  let address = text.replace(/^\[|\]$/g, '').split('%')[0] ?? ''
  if (!address.includes(':')) return undefined
  // A dotted IPv4 tail (::ffff:1.2.3.4) is two groups written another way.
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address)
  if (dotted !== null) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number]
    if ([a, b, c, d].some((byte) => byte > 255)) return undefined
    address = `${address.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const halves = address.split('::')
  if (halves.length > 2) return undefined
  const part = (half: string | undefined) =>
    half === undefined || half === '' ? [] : half.split(':')
  const head = part(halves[0])
  const tail = part(halves[1])
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  return groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))
    ? groups.map((group) => Number.parseInt(group, 16))
    : undefined
}

/** The range limits count an address under: the address for IPv4, the /64 for IPv6. */
export function addressRange(address: string): string {
  const trimmed = address.trim()
  if (trimmed === '') return 'unknown'
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(trimmed))
    return trimmed
      .split('.')
      .map((part) => String(Number(part)))
      .join('.')
  const groups = ipv6Groups(trimmed)
  if (groups === undefined) return trimmed
  // An IPv4 address mapped into IPv6 (::ffff:a.b.c.d, in any spelling) is that IPv4 address.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const [high = 0, low = 0] = groups.slice(6)
    return [high >> 8, high & 255, low >> 8, low & 255].join('.')
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`
}

/** An IPv6 range's /48, which puts also count against; undefined for IPv4. */
export function wideRange(range: string): string | undefined {
  if (!range.endsWith('::/64')) return undefined
  return `${range.split(':').slice(0, 3).join(':')}::/48`
}

export interface LimitCounter {
  /** Counts a put of `bytes` by this range under this tag; false when it's over a limit. */
  allowPut(range: string, tag: string, bytes: number, now: number): boolean
  /** Counts a list, get or drop by this range; false when it's over its limit. */
  allowRead(range: string, now: number): boolean
}

/** A count per key in fixed windows, forgotten as each window passes. */
function windowed(length: number) {
  let window = -1
  let counts = new Map<string, number>()
  return {
    at(now: number) {
      const current = Math.floor(now / length)
      if (current !== window) {
        window = current
        counts = new Map()
      }
      return counts
    },
  }
}

export function createLimitCounter(limits: Limits): LimitCounter {
  const puts = windowed(HOUR)
  const wide = windowed(HOUR)
  const bytes = windowed(HOUR)
  const perTag = windowed(DAY)
  const reads = windowed(MINUTE)
  let total = { hour: -1, count: 0 }
  /** A range not seen this window may only start being counted while there's room. */
  const room = (counts: Map<string, number>, key: string, cap = limits.maxRanges) =>
    counts.has(key) || counts.size < cap
  return {
    allowPut(range, tag, size, now) {
      const hour = Math.floor(now / HOUR)
      if (total.hour !== hour) total = { hour, count: 0 }
      const putCounts = puts.at(now)
      const byteCounts = bytes.at(now)
      const tagCounts = perTag.at(now)
      const key = `${range} ${tag}`
      const wider = wideRange(range)
      const wideCounts = wide.at(now)
      const fromWider = wider === undefined ? 0 : (wideCounts.get(wider) ?? 0)
      const made = putCounts.get(range) ?? 0
      const sent = byteCounts.get(range) ?? 0
      const onTag = tagCounts.get(key) ?? 0
      if (
        total.count >= limits.totalPutsPerHour ||
        !room(putCounts, range) ||
        !room(tagCounts, key, limits.maxTagCounts) ||
        (wider !== undefined && fromWider >= limits.putsPerHourPer48) ||
        made >= limits.putsPerHour ||
        sent + size > limits.bytesPerHour ||
        onTag >= limits.blobsPerTagPerDay
      )
        return false
      total.count += 1
      if (wider !== undefined) wideCounts.set(wider, fromWider + 1)
      putCounts.set(range, made + 1)
      byteCounts.set(range, sent + size)
      tagCounts.set(key, onTag + 1)
      return true
    },
    allowRead(range, now) {
      const counts = reads.at(now)
      const made = counts.get(range) ?? 0
      if (!room(counts, range) || made >= limits.readsPerMinute) return false
      counts.set(range, made + 1)
      return true
    },
  }
}
