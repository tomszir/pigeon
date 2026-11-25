import { describe, expect, it } from 'vitest'
import {
  addressRange,
  createLimitCounter,
  DEFAULT_LIMITS,
  type Limits,
  roomForConnection,
} from './limits.ts'

describe('address ranges', () => {
  it('count IPv4 by address and IPv6 by its /64', () => {
    expect(addressRange('203.0.113.7')).toBe('203.0.113.7')
    expect(addressRange('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64')
    expect(addressRange('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64')
    expect(addressRange('[2001:db8::1]')).toBe('2001:db8:0:0::/64')
    expect(addressRange('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
    expect(addressRange('010.002.3.4')).toBe('10.2.3.4')
    expect(addressRange('')).toBe('unknown')
  })

  it('take an IPv4 address mapped into IPv6 as that IPv4 address, however it is spelled', () => {
    for (const spelling of ['::ffff:203.0.113.7', '0:0:0:0:0:ffff:203.0.113.7', '::ffff:cb00:7107'])
      expect(addressRange(spelling)).toBe('203.0.113.7')
  })
})

const limits = (extra: Partial<Limits>): Limits => ({ ...DEFAULT_LIMITS, ...extra })
const HOUR = 60 * 60 * 1000

describe('the limit counter', () => {
  it('stops a range after its puts for the hour, then lets it go on', () => {
    const counter = createLimitCounter(limits({ putsPerHour: 2 }))
    expect(counter.allowPut('a', 't1', 1, 0)).toBe(true)
    expect(counter.allowPut('a', 't2', 1, 1)).toBe(true)
    expect(counter.allowPut('a', 't3', 1, 2)).toBe(false)
    expect(counter.allowPut('b', 't3', 1, 3)).toBe(true)
    expect(counter.allowPut('a', 't3', 1, HOUR)).toBe(true)
  })

  it('caps the bytes a range puts in an hour', () => {
    const counter = createLimitCounter(limits({ bytesPerHour: 100 }))
    expect(counter.allowPut('a', 't1', 60, 0)).toBe(true)
    expect(counter.allowPut('a', 't2', 60, 1)).toBe(false)
    expect(counter.allowPut('a', 't2', 40, 2)).toBe(true)
  })

  it('caps what one range puts under one tag, not what everyone does', () => {
    const counter = createLimitCounter(limits({ blobsPerTagPerDay: 1 }))
    expect(counter.allowPut('a', 'tag', 1, 0)).toBe(true)
    expect(counter.allowPut('a', 'tag', 1, 1)).toBe(false)
    expect(counter.allowPut('b', 'tag', 1, 2)).toBe(true)
  })

  it('caps everyone together, and how many ranges it tracks', () => {
    const total = createLimitCounter(limits({ totalPutsPerHour: 2 }))
    expect(total.allowPut('a', 't', 1, 0)).toBe(true)
    expect(total.allowPut('b', 't', 1, 0)).toBe(true)
    expect(total.allowPut('c', 't', 1, 0)).toBe(false)
    const ranges = createLimitCounter(limits({ maxRanges: 2 }))
    expect(ranges.allowRead('a', 0)).toBe(true)
    expect(ranges.allowRead('b', 0)).toBe(true)
    expect(ranges.allowRead('c', 0)).toBe(false)
    expect(ranges.allowRead('a', 1)).toBe(true)
  })

  it('counts IPv6 puts against their /48 too, however many /64s they come from', () => {
    const counter = createLimitCounter(limits({ putsPerHourPer48: 2 }))
    expect(counter.allowPut('2001:db8:1:1::/64', 't', 1, 0)).toBe(true)
    expect(counter.allowPut('2001:db8:1:2::/64', 't', 1, 0)).toBe(true)
    expect(counter.allowPut('2001:db8:1:3::/64', 't', 1, 0)).toBe(false)
    expect(counter.allowPut('2001:db8:2:1::/64', 't', 1, 0)).toBe(true)
    expect(counter.allowPut('203.0.113.7', 't', 1, 0)).toBe(true)
  })

  it('tracks many more range and tag pairs than ranges', () => {
    const counter = createLimitCounter(limits({ maxRanges: 2, maxTagCounts: 10 }))
    expect(counter.allowPut('a', 't1', 1, 0)).toBe(true)
    expect(counter.allowPut('a', 't2', 1, 0)).toBe(true)
    expect(counter.allowPut('a', 't3', 1, 0)).toBe(true)
  })

  it('counts lists, gets and drops per minute', () => {
    const counter = createLimitCounter(limits({ readsPerMinute: 1 }))
    expect(counter.allowRead('a', 0)).toBe(true)
    expect(counter.allowRead('a', 1)).toBe(false)
    expect(counter.allowRead('a', 60_000)).toBe(true)
  })

  it('caps IPv6 reads per /48, before tracking any more of its /64s', () => {
    const counter = createLimitCounter(limits({ readsPerMinutePer48: 2, maxRanges: 4 }))
    expect(counter.allowRead('2001:db8:1:1::/64', 0)).toBe(true)
    expect(counter.allowRead('2001:db8:1:2::/64', 0)).toBe(true)
    // A /48 past its cap takes up no more places with fresh /64s...
    for (let n = 3; n < 20; n++) expect(counter.allowRead(`2001:db8:1:${n}::/64`, 0)).toBe(false)
    // ...so everyone else still finds room.
    expect(counter.allowRead('2001:db8:2:1::/64', 0)).toBe(true)
    expect(counter.allowRead('203.0.113.7', 0)).toBe(true)
    expect(counter.allowRead('2001:db8:1:3::/64', 60_000)).toBe(true)
  })

  it('counts every frame per minute, per range and per IPv6 /48', () => {
    const counter = createLimitCounter(limits({ framesPerMinute: 2, framesPerMinutePer48: 3 }))
    expect(counter.allowFrame('a', 0)).toBe(true)
    expect(counter.allowFrame('a', 1)).toBe(true)
    expect(counter.allowFrame('a', 2)).toBe(false)
    expect(counter.allowFrame('a', 60_000)).toBe(true)
    expect(counter.allowFrame('2001:db8:1:1::/64', 0)).toBe(true)
    expect(counter.allowFrame('2001:db8:1:1::/64', 0)).toBe(true)
    expect(counter.allowFrame('2001:db8:1:2::/64', 0)).toBe(true)
    expect(counter.allowFrame('2001:db8:1:3::/64', 0)).toBe(false)
  })

  it('takes back a put that stored nothing, but only in the window it was counted in', () => {
    const counter = createLimitCounter(
      limits({ putsPerHour: 1, bytesPerHour: 10, blobsPerTagPerDay: 1, totalPutsPerHour: 1 }),
    )
    expect(counter.allowPut('a', 't', 10, 0)).toBe(true)
    counter.refundPut('a', 't', 10, 0)
    expect(counter.allowPut('a', 't', 10, 1)).toBe(true)
    expect(counter.allowPut('a', 't', 10, 2)).toBe(false)
    // A refund after the hour turned changes nothing of the new hour's counts.
    expect(counter.allowPut('b', 'u', 1, HOUR)).toBe(true)
    counter.refundPut('a', 't', 10, 2)
    expect(counter.allowPut('c', 'v', 1, HOUR + 1)).toBe(false)
  })

  it('keeps per-tag counts apart however many pairs it tracks', () => {
    const counter = createLimitCounter(limits({ blobsPerTagPerDay: 1 }))
    for (let n = 0; n < 200; n++) expect(counter.allowPut(`r${n}`, `t${n}`, 1, 0)).toBe(true)
    expect(counter.allowPut('r1', 't1', 1, 0)).toBe(false)
  })
})

describe('connection room', () => {
  it('caps connections in total, per range and per IPv6 /48', () => {
    const caps = limits({ maxConnections: 10, connectionsPerRange: 2, connectionsPer48: 4 })
    expect(roomForConnection(caps, { total: 0, range: 0, wide: 0 })).toBe(true)
    expect(roomForConnection(caps, { total: 9, range: 1, wide: 3 })).toBe(true)
    expect(roomForConnection(caps, { total: 10, range: 0, wide: 0 })).toBe(false)
    expect(roomForConnection(caps, { total: 3, range: 2, wide: 2 })).toBe(false)
    expect(roomForConnection(caps, { total: 4, range: 1, wide: 4 })).toBe(false)
  })
})
