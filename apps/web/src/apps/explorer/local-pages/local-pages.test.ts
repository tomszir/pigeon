import { PAGE_BUDGET_BYTES } from '@pigeon/pigeonhtml'
import { describe, expect, it } from 'vitest'
import { findLocalPage, type LocalPages, localPageFinder, START_PAGES } from './local-pages.ts'

describe('local pages', () => {
  it('serves the start page at pigeon://home, however it is spelled', () => {
    expect(findLocalPage('pigeon://home')?.title).toBe('Pigeon Home')
    expect(findLocalPage('pigeon://HOME/')).toBe(findLocalPage('pigeon://home'))
    expect(findLocalPage('pigeon://mika')).toBeUndefined()
  })

  it('takes more sets of pages, the first one winning', () => {
    const help: LocalPages = new Map([
      ['pigeon://help', { title: 'Help', source: '<p>Help</p>' }],
      ['pigeon://home', { title: 'Not home', source: '' }],
    ])
    const find = localPageFinder(START_PAGES, help)
    expect(find('pigeon://help')?.title).toBe('Help')
    expect(find('pigeon://home')?.title).toBe('Pigeon Home')
  })

  it('keeps the start page inside the dial-up budget, with its images there to load', () => {
    const home = findLocalPage('pigeon://home')
    expect(new TextEncoder().encode(home?.source).length).toBeLessThan(PAGE_BUDGET_BYTES)
    const sources = [...(home?.source ?? '').matchAll(/src="([^"]+)"/g)].map((match) => match[1])
    expect(sources.length).toBeGreaterThan(0)
    for (const src of sources) expect(home?.images?.[src ?? '']).toBeTruthy()
    expect(home?.source.toLowerCase()).not.toContain('<script')
  })
})
