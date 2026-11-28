import { PAGE_BUDGET_BYTES, type PageUrls, sanitize, validate } from '@pigeon/pigeonhtml'
import { describe, expect, it } from 'vitest'
import { linkTarget } from '../apps/explorer/explorer/address.ts'
import { localPageFinder } from '../apps/explorer/local-pages/local-pages.ts'
import { BUNDLED_PAGES } from './bundled-pages.ts'

/**
 * Addresses a bundled page names on purpose and nobody hosts, by the page that names them: the
 * start page's example of a friend's homepage, which shows "page not hosted".
 */
const NOT_HOSTED_ON_PURPOSE: Readonly<Record<string, ReadonlySet<string>>> = {
  'pigeon://home': new Set(['pigeon://mika']),
}

const find = localPageFinder(...BUNDLED_PAGES)
const pages = BUNDLED_PAGES.flatMap((set) => [...set])

const bytes = (text: string) => new TextEncoder().encode(text).length

/** The `href` of every link and image-map area in sanitized HTML, which writes them double-quoted. */
const links = (html: string) =>
  [...html.matchAll(/<(?:a|area)\s[^>]*?\bhref="([^"]*)"/g)].map((match) =>
    (match[1] ?? '').replaceAll('&amp;', '&'),
  )

/** The `id` and `name` of everything in sanitized HTML, which a `#fragment` link can reach. */
const anchors = (html: string) =>
  new Set([...html.matchAll(/\s(?:id|name)="([^"]*)"/g)].map((match) => match[1] ?? ''))

/** Explorer looks a fragment up decoded, or as written when it doesn't decode. */
const fragmentNames = (fragment: string) => {
  try {
    return [decodeURIComponent(fragment), fragment]
  } catch {
    return [fragment]
  }
}

describe('every page that comes with Pigeon', () => {
  it('is more than the start page', () => {
    expect(pages.length).toBe(9)
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
      expect(bytes(page.source)).toBeLessThanOrEqual(PAGE_BUDGET_BYTES)

      const names = anchors(sanitized.html)
      for (const href of links(sanitized.html)) {
        if (href.startsWith('#')) {
          const found = fragmentNames(href.slice(1)).some((name) => names.has(name))
          expect(found, `${href} on ${address} names nothing on the page`).toBe(true)
          continue
        }
        if (NOT_HOSTED_ON_PURPOSE[address]?.has(href)) continue
        expect(href, `a link on ${address}`).toMatch(/^pigeon:\/\//)
        expect(find(href), `${href}, linked from ${address}`).toBeDefined()
      }
    },
  )

  it('serves each page at its own address, none hidden behind another set', () => {
    for (const [address, page] of pages) expect(find(address), address).toBe(page)
  })
})
