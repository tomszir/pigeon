import { PAGE_BUDGET_BYTES, sanitize } from '@pigeon/pigeonhtml'
import { describe, expect, it } from 'vitest'
import { HELP_HOME, HELP_PAGES } from './help-pages.ts'

const urls = { image: () => undefined, link: (href: string) => href }

const links = (source: string) =>
  [...source.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((match) => match[1] ?? '')

const bytes = (text: string) => new TextEncoder().encode(text).length

describe('HELP_PAGES', () => {
  it('has a contents page, both halves, and every address under pigeon://help/', () => {
    expect(HELP_PAGES.get(HELP_HOME)?.title).toBe('Pigeon Help')
    expect(HELP_PAGES.has('pigeon://help/how/')).toBe(true)
    expect(HELP_PAGES.has('pigeon://help/protocol/')).toBe(true)
    for (const address of HELP_PAGES.keys()) expect(address).toMatch(/^pigeon:\/\/help\//)
  })

  it.each([...HELP_PAGES])('%s fits the page budget', (_, page) => {
    expect(bytes(page.source)).toBeLessThan(PAGE_BUDGET_BYTES)
    expect(sanitize(page.source, urls).bytes).toBe(bytes(page.source))
  })

  it.each([...HELP_PAGES])('%s keeps everything through sanitize', (_, page) => {
    expect(sanitize(page.source, urls).removed).toEqual([])
  })

  it.each([...HELP_PAGES])('%s is PigeonHTML with no scripts', (_, page) => {
    expect(page.source).toMatch(/^<html>\n<head>\n<title>/)
    expect(page.source).not.toMatch(/<script|<!--|\son\w+=|javascript:/i)
    expect(page.title).not.toBe('')
  })

  it.each([...HELP_PAGES])('%s links only to Help pages that exist', (_, page) => {
    for (const href of links(page.source)) {
      expect(href).toMatch(/^pigeon:\/\/help\//)
      expect(HELP_PAGES.has(href), href).toBe(true)
    }
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
