import { describe, expect, it } from 'vitest'
import { CHANGELOG_TEXT, versionsIn } from './changelog.ts'

describe('Changelog.txt', () => {
  it('opens with the version being built', () => {
    // A release PR whose notes weren't drafted fails here.
    expect(versionsIn(CHANGELOG_TEXT)[0]).toBe(__PIGEON_VERSION__)
  })

  it('lists each version once, newest first', () => {
    const versions = versionsIn(CHANGELOG_TEXT)
    const sorted = [...versions].sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
    expect(versions).toEqual(sorted)
    expect(new Set(versions).size).toBe(versions.length)
  })

  it('fits the reader’s 46 columns', () => {
    const wide = CHANGELOG_TEXT.split('\n').filter((line) => line.length > 46)
    expect(wide).toEqual([])
  })
})
