import { PAGE_BUDGET_BYTES, type PageUrls, sanitize, validate } from '@pigeon/pigeonhtml'
import { describe, expect, it } from 'vitest'
import { linkTarget } from '../apps/explorer/explorer/address.ts'
import { localPageFinder } from '../apps/explorer/local-pages/local-pages.ts'
import { BUNDLED_PAGES } from './bundled-pages.ts'

/** Addresses a bundled page names on purpose and nobody hosts, to show "page not hosted". */
const NOT_HOSTED_ON_PURPOSE = new Set(['pigeon://mika'])

const find = localPageFinder(...BUNDLED_PAGES)
const pages = BUNDLED_PAGES.flatMap((set) => [...set])

const bytes = (text: string) => new TextEncoder().encode(text).length

/** The `href` of every link and image-map area in sanitized HTML, which writes them double-quoted. */
const links = (html: string) =>
  [...html.matchAll(/<(?:a|area)\s[^>]*?\bhref="([^"]*)"/g)].map((match) =>
    (match[1] ?? '').replaceAll('&amp;', '&'),
  )

describe('every page that comes with Pigeon', () => {
  it('is more than the start page', () => {
    expect(pages.length).toBeGreaterThan(20)
    expect(find('pigeon://home')).toBeDefined()
    expect(find('pigeon://help/')).toBeDefined()
  })

  it.each(pages)(
    '%s is valid, loses nothing to sanitize, fits the budget and links to pages that exist',
    (address, page) => {
      // The same URL rules Explorer gives its sanitizer, so a link that goes nowhere in-world or an
      // image the page doesn't bundle is reported as removed.
      const urls: PageUrls = {
        image: (src) => page.images?.[src],
        link: (href) => linkTarget(href, address),
      }
      expect(validate(page.source)).toEqual([])

      const sanitized = sanitize(page.source, urls)
      expect(sanitized.removed).toEqual([])
      expect(sanitized.bytes).toBe(bytes(page.source))
      expect(sanitized.bytes).toBeLessThanOrEqual(PAGE_BUDGET_BYTES)

      for (const href of links(sanitized.html)) {
        if (href.startsWith('#') || NOT_HOSTED_ON_PURPOSE.has(href)) continue
        expect(href, `a link on ${address}`).toMatch(/^pigeon:\/\//)
        expect(find(href), `${href}, linked from ${address}`).toBeDefined()
      }
    },
  )

  it('serves each page at its own address, none hidden behind another set', () => {
    for (const [address, page] of pages) expect(find(address), address).toBe(page)
  })
})
