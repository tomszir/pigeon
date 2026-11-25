import { describe, expect, it } from 'vitest'
import {
  canGoBack,
  canGoForward,
  currentAddress,
  goBack,
  goForward,
  startHistory,
  visit,
} from './history.ts'

describe('history', () => {
  it('walks back and forward through visited pages', () => {
    const seen = visit(visit(startHistory('a'), 'b'), 'c')
    expect(currentAddress(seen)).toBe('c')
    expect(canGoForward(seen)).toBe(false)
    const back = goBack(goBack(seen))
    expect(currentAddress(back)).toBe('a')
    expect(canGoBack(back)).toBe(false)
    expect(goBack(back)).toBe(back)
    expect(currentAddress(goForward(back))).toBe('b')
  })

  it('forgets what was ahead when a new page is opened', () => {
    const branched = visit(goBack(visit(startHistory('a'), 'b')), 'c')
    expect(branched.entries).toEqual(['a', 'c'])
    expect(canGoForward(branched)).toBe(false)
  })

  it("doesn't add the page that's already showing", () => {
    const history = startHistory('a')
    expect(visit(history, 'a')).toBe(history)
  })
})
