import { describe, expect, it } from 'vitest'
import { addressRange, createLimitCounter, DEFAULT_LIMITS, type Limits } from './limits.ts'

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
})
