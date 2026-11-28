import { describe, expect, it } from 'vitest'
import { HELP_HOME, HELP_PAGES } from './help-pages.ts'

const links = (source: string) =>
  [...source.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((match) => match[1] ?? '')

// That every page is valid PigeonHTML, fits the budget and links to pages that exist is checked
// for every bundled page at once, in app/bundled-pages.test.ts.
describe('HELP_PAGES', () => {
  it('has a contents page, the guide, and every address under pigeon://help/', () => {
    expect(HELP_PAGES.get(HELP_HOME)?.title).toBe('Pigeon Help')
    expect(HELP_PAGES.has('pigeon://help/how/')).toBe(true)
    for (const address of HELP_PAGES.keys()) expect(address).toMatch(/^pigeon:\/\/help\//)
  })

  it.each([...HELP_PAGES])('%s has a title', (_, page) => {
    expect(page.title).not.toBe('')
  })

  it('reaches every page from the contents', () => {
    const seen = new Set([HELP_HOME])
    const queue = [HELP_HOME]
    for (let address = queue.pop(); address !== undefined; address = queue.pop()) {
      for (const href of links(HELP_PAGES.get(address)?.source ?? '')) {
        if (!seen.has(href)) {
          seen.add(href)
          queue.push(href)
        }
      }
    }
    expect([...seen].sort()).toEqual([...HELP_PAGES.keys()].sort())
  })
})
