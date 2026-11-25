import { describe, expect, it } from 'vitest'
import { OFFICIAL_LIGHTHOUSES } from './official-lighthouses.ts'

describe('the official Lighthouses', () => {
  it('are three, each reached over wss with a key of its own', () => {
    expect(OFFICIAL_LIGHTHOUSES.map((address) => address.name)).toEqual([
      'Loft',
      'Dovecote',
      'Perch',
    ])
    expect(new Set(OFFICIAL_LIGHTHOUSES.map((address) => address.id)).size).toBe(3)
    for (const address of OFFICIAL_LIGHTHOUSES) expect(address.url).toMatch(/^wss:\/\//)
  })
})
