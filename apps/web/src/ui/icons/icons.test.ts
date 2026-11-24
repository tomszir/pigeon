import { describe, expect, it } from 'vitest'
import { BRAND_ICONS, brand, brandIcon, TANGO_ICONS, tango } from './icons.ts'

describe('icons', () => {
  it.each(TANGO_ICONS)('tango %s is vendored at 16, 22 and 32 px', (name) => {
    for (const size of [16, 22, 32] as const) expect(tango(name, size)).toMatch(/\.png/)
  })

  it.each(BRAND_ICONS)('brand %s is vendored', (name) => {
    expect(brand(name)).toMatch(/\.png/)
  })

  it('reads the drawn size from a brand name', () => {
    expect(brandIcon('pigeon-32').size).toBe(32)
    expect(brandIcon('presence-16-online').size).toBe(16)
  })
})
