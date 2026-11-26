// A Lighthouse's limits, counted per address range: an IPv4 address, or an
// IPv6 /64, since anyone with one IPv6 address has the 2^64 around it. Counts live in memory
// only; addresses are never written to storage. A cap per IPv6 /48, on everyone together, and on
// how many ranges are tracked at once, keeps someone with a whole IPv6 block from getting round
// them.

export interface Limits {
  /**
   * Frames an address range may send in a minute, of any kind, counted before anything is
   * parsed, hashed or signed. A connection whose range goes past it is closed unanswered.
   */
  readonly framesPerMinute: number
  /** Frames an IPv6 /48 may send in a minute, however many /64s they come from. */
  readonly framesPerMinutePer48: number
  /** Puts an address range may make in an hour. High enough for carriers' shared addresses. */
  readonly putsPerHour: number
  /** Bytes an address range may put in an hour. */
  readonly bytesPerHour: number
  /** Blobs an address range may put under one tag in a day, so nobody fills a tag for all. */
  readonly blobsPerTagPerDay: number
  /** Hellos, lists, gets and drops an address range may make in a minute. */
  readonly readsPerMinute: number
  /** Hellos, lists, gets and drops an IPv6 /48 may make in a minute, from any of its /64s. */
  readonly readsPerMinutePer48: number
  /** Puts an IPv6 /48 may make in an hour, however many /64s it puts from. */
  readonly putsPerHourPer48: number
  /**
   * Puts from everyone together in an hour. Past it nobody can put until the hour turns: it
   * protects the store and the bill, and someone who trips it on purpose shuts everyone out
   * for that hour: the price of a Lighthouse that can't be filled.
   */
  readonly totalPutsPerHour: number
  /** Address ranges tracked at once; past it, new ones are refused until the window turns. */
  readonly maxRanges: number
  /** Range and tag pairs tracked in a day, for blobsPerTagPerDay. */
  readonly maxTagCounts: number
  /** What the store may hold, each blob costing its bytes and its record (see `blobCost`). */
  readonly maxBytes: number
  /** Connections open at once from one address range. */
  readonly connectionsPerRange: number
  /** Connections open at once from one IPv6 /48, however many /64s they come from. */
  readonly connectionsPer48: number
  /** Connections open at once from everyone together. */
  readonly maxConnections: number
  /** Seconds a connection may send nothing before it's closed, freeing its place. */
  readonly idleSeconds: number
}

export const DEFAULT_LIMITS: Limits = {
  framesPerMinute: 1200,
  framesPerMinutePer48: 4800,
  putsPerHour: 2000,
  bytesPerHour: 64 * 1024 * 1024,
  blobsPerTagPerDay: 200,
  readsPerMinute: 600,
  readsPerMinutePer48: 2400,
  putsPerHourPer48: 8000,
  totalPutsPerHour: 200_000,
  maxRanges: 50_000,
  maxTagCounts: 1_000_000,
  maxBytes: 1024 * 1024 * 1024,
  connectionsPerRange: 128,
  connectionsPer48: 512,
  maxConnections: 10_000,
  // Pigeon looks for mail every 30 seconds while an invite of yours waits and every 10 minutes
  // otherwise (and, at most every 5 seconds, when you come back to it or send), and opens a new connection when its last one was closed: two minutes keeps the
  // socket between quick checks and lets it go between slow ones.
  idleSeconds: 120,
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

/** An IPv6 range's /48, which puts, reads and frames also count against; undefined for IPv4. */
export function wideRange(range: string): string | undefined {
  if (!range.endsWith('::/64')) return undefined
  return `${range.split(':').slice(0, 3).join(':')}::/48`
}

/** Connections open now: everyone's, the new one's range's, and its /48's (0 for IPv4). */
export interface OpenConnections {
  readonly total: number
  readonly range: number
  readonly wide: number
}

/** Whether one more connection fits beside those open, in total, from its range and its /48. */
export const roomForConnection = (limits: Limits, open: OpenConnections): boolean =>
  open.total < limits.maxConnections &&
  open.range < limits.connectionsPerRange &&
  open.wide < limits.connectionsPer48

export interface LimitCounter {
  /** Counts one frame from this range, of any kind; false when it's over its limit. */
  allowFrame(range: string, now: number): boolean
  /** Counts a put of `bytes` by this range under this tag; false when it's over a limit. */
  allowPut(range: string, tag: string, bytes: number, now: number): boolean
  /**
   * Takes back a put `allowPut` counted at `now` that stored nothing new, such as a sender's
   * retry of mail already held. Nothing happens once the window it was counted in has passed,
   * since that count is forgotten already.
   */
  refundPut(range: string, tag: string, bytes: number, now: number): void
  /** Counts a hello, list, get or drop by this range; false when it's over its limit. */
  allowRead(range: string, now: number): boolean
}

type Counts = Map<string | number, number>

/** A count per key in fixed windows, forgotten as each window passes. */
function windowed(length: number) {
  let window = -1
  let counts: Counts = new Map()
  return {
    at(now: number): Counts {
      const current = Math.floor(now / length)
      if (current !== window) {
        window = current
        counts = new Map()
      }
      return counts
    },
    /** This window's counts while `now` is still in it, without starting a new one. */
    still(now: number): Counts | undefined {
      return Math.floor(now / length) === window ? counts : undefined
    },
  }
}

/** Takes `by` off a count, forgetting it at nothing, so its place is free again. */
function lower(counts: Counts | undefined, key: string | number, by = 1) {
  const count = counts?.get(key)
  if (counts === undefined || count === undefined) return
  if (count <= by) counts.delete(key)
  else counts.set(key, count - by)
}

/**
 * A short keyed hash of a range and tag: a whole number under 2^30. The pairs counted for
 * blobsPerTagPerDay can run to a million a day, and a number that small is kept inside the map
 * itself, where the pair's text would take several times the memory a Worker has. Two pairs
 * that land on the same number share a count, which only makes their limit a little tighter;
 * the random key keeps anyone from choosing pairs that land on someone else's.
 */
function pairKey(seeds: readonly [number, number], range: string, tag: string): number {
  let a = seeds[0]
  let b = seeds[1]
  const text = `${range} ${tag}`
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    a = Math.imul(a ^ code, 2654435761)
    b = Math.imul(b ^ code, 1597334677)
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
  return ((a ^ b) >>> 2) & 0x3fffffff
}

export function createLimitCounter(limits: Limits): LimitCounter {
  const puts = windowed(HOUR)
  const wide = windowed(HOUR)
  const bytes = windowed(HOUR)
  const perTag = windowed(DAY)
  let total = { hour: -1, count: 0 }
  // Clients never learn these, so they can't aim their pairs at another's count.
  const seeds = [Math.floor(Math.random() * 2 ** 32), Math.floor(Math.random() * 2 ** 32)] as const
  /** A key not seen this window may only start being counted while there's room. */
  const room = (counts: Counts, key: string | number, cap = limits.maxRanges) =>
    counts.has(key) || counts.size < cap

  /**
   * One count a minute per range, and per /48 for IPv6. The /48 is checked first, so one past
   * its limit adds none of its /64s to what's tracked: a single /48 can't fill maxRanges with
   * fresh /64s and lock everyone else out.
   */
  const perMinute = (perRange: number, per48: number) => {
    const ranges = windowed(MINUTE)
    const wider = windowed(MINUTE)
    return (range: string, now: number): boolean => {
      const counts = ranges.at(now)
      const wideCounts = wider.at(now)
      const wideKey = wideRange(range)
      const fromWider = wideKey === undefined ? 0 : (wideCounts.get(wideKey) ?? 0)
      if (wideKey !== undefined && (fromWider >= per48 || !room(wideCounts, wideKey))) return false
      const made = counts.get(range) ?? 0
      if (!room(counts, range) || made >= perRange) return false
      counts.set(range, made + 1)
      if (wideKey !== undefined) wideCounts.set(wideKey, fromWider + 1)
      return true
    }
  }

  return {
    allowFrame: perMinute(limits.framesPerMinute, limits.framesPerMinutePer48),
    allowRead: perMinute(limits.readsPerMinute, limits.readsPerMinutePer48),
    allowPut(range, tag, size, now) {
      const hour = Math.floor(now / HOUR)
      if (total.hour !== hour) total = { hour, count: 0 }
      const putCounts = puts.at(now)
      const byteCounts = bytes.at(now)
      const tagCounts = perTag.at(now)
      const key = pairKey(seeds, range, tag)
      const wider = wideRange(range)
      const wideCounts = wide.at(now)
      const fromWider = wider === undefined ? 0 : (wideCounts.get(wider) ?? 0)
      const made = putCounts.get(range) ?? 0
      const sent = byteCounts.get(range) ?? 0
      const onTag = tagCounts.get(key) ?? 0
      if (
        total.count >= limits.totalPutsPerHour ||
        (wider !== undefined && fromWider >= limits.putsPerHourPer48) ||
        !room(putCounts, range) ||
        !room(tagCounts, key, limits.maxTagCounts) ||
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
    refundPut(range, tag, size, now) {
      if (total.hour === Math.floor(now / HOUR) && total.count > 0) total.count -= 1
      const wider = wideRange(range)
      if (wider !== undefined) lower(wide.still(now), wider)
      lower(puts.still(now), range)
      lower(bytes.still(now), range, size)
      lower(perTag.still(now), pairKey(seeds, range, tag))
    },
  }
}
